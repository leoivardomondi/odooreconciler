import fs from 'fs/promises';
import multer from 'multer';
import path from 'path';
import { NextFunction, Request, Response, Router } from 'express';
import {
  autoVerifyMpesaTransactionsByRule,
  createMpesaExtractionJob,
  createMpesaStatementBatch,
  deleteMpesaStatementBatch,
  getMpesaTransactionExplorerOptions,
  getMpesaTransactionExplorerRows,
  getMpesaStatementBatchesWithOpenReviewCounts,
  getMpesaStatementBatchById,
  getMpesaExtractionJobById,
  getMpesaTransactionsByIds,
  getMpesaTransactionsByBatchId,
  getReviewedSalaryAdvanceTransactionsByPeriod,
  getRecentMpesaStatementBatches,
  getSettings,
  replaceMpesaStatementBatchExtraction,
  markMpesaStatementBatchProcessing,
  updateMpesaTransactionAdminReviewFields,
  updateMpesaTransactions,
} from '../models/repositories';
import { MpesaTransaction, MpesaTransactionExplorerFilters } from '../models/types';
import { extractMpesaStatement } from '../services/mpesaReconciliationService';
import {
  analyzeTransportKeywords,
  categorizeBatchWithAi,
  categorizeWithAi,
  extractTransportIndicators,
  getTransportKeywordRules,
  trainMpesaCategoryFromTransaction,
  type MpesaCategory,
} from '../services/aiCategoryService';
import { OdooClient } from '../services/odooClient';
import {
  buildPayrollAdvanceRecords,
  buildPayrollPayRunName,
  createPayrollPayRun,
  sharePayrollAdvances,
} from '../services/payrollBridgeService';
import { hasOdooConfiguration, sanitizeBaseUrl } from '../utils/helpers';
import { resolveProjectFile } from '../utils/paths';
import { processMpesaPoReconciliation, processMpesaPoReconciliationByMonth } from '../services/mpesaPoReconcileService';
import { wakeMpesaExtractionJobWorker } from '../services/mpesaExtractionJobService';

const router = Router();
const uploadRoot = resolveProjectFile(process.env.UPLOAD_DIR || 'uploads', 'uploads');
const uploadDir = path.join(uploadRoot, 'mpesa');
const resolvedUploadDir = path.resolve(uploadDir);

type MpesaStatementTotalCheck = {
  key: 'paidIn' | 'withdrawn';
  label: string;
  expected: number | null;
  extracted: number;
  difference: number | null;
  status: 'match' | 'mismatch' | 'verified' | 'needs_review';
  validationMode: 'summary' | 'rows';
  validatedRows: number;
  balanceChecks: number;
  balanceMismatches: number;
  totalRows: number;
  diagnosis?: string;
};

const KNOWN_MPESA_PAYER_ALIASES = [
  {
    customerName: 'OKEVAM FURNITURE',
    payerNames: ['Kevin Okumayia Amalanda'],
  },
];

const MPESA_REVIEW_STATUSES: MpesaTransaction['reviewStatus'][] = [
  'new',
  'reviewed',
  'verified',
  'ignored',
  'needs_followup',
];

const MPESA_CATEGORY_OPTIONS = [
  ['staff_lunch_expense', 'Staff lunch'],
  ['staff_transport_expense', 'Staff transport'],
  ['staff_overtime_expense', 'Staff overtime'],
  ['advance_salary', 'Advance Salary'],
  ['staff_loan', 'Staff loan'],
  ['transport_expense', 'Transport'],
  ['office_water_expense', 'Office water'],
  ['supplier_payment', 'Supplier payment'],
  ['customer_receipt', 'Customer receipt'],
  ['mpesa_charge', 'M-Pesa charge'],
  ['cash_withdrawal', 'Cash withdrawal'],
  ['refunds', 'Refunds'],
  ['outgoing_payment', 'Outgoing payment'],
  ['bank_transfer', 'Bank transfer'],
  ['internal_transfer', 'Internal transfer'],
  ['unknown', 'Unknown'],
] as const;

const MPESA_CATEGORY_SET = new Set(MPESA_CATEGORY_OPTIONS.map(([value]) => value));

async function ensurePrivateUploadDirectory() {
  await fs.mkdir(uploadDir, { recursive: true });
  await fs.writeFile(path.join(uploadDir, '.htaccess'), 'Require all denied\n', { flag: 'wx' }).catch((error) => {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') {
      return;
    }

    throw error;
  });
}

const storage = multer.diskStorage({
  destination: async (_req, _file, callback) => {
    try {
      await ensurePrivateUploadDirectory();
      callback(null, uploadDir);
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)), uploadDir);
    }
  },
  filename: (_req, file, callback) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]+/g, '_');
    callback(null, `${Date.now()}-${safeName}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    const allowed = ['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.tif', '.tiff', '.xls', '.xlsx'];
    if (allowed.includes(extension)) {
      callback(null, true);
      return;
    }
    callback(new Error('Upload an M-Pesa statement PDF, image, or Excel file.'));
  },
});

async function buildOptionalOdooClient() {
  const settings = await getSettings();
  if (!hasOdooConfiguration(settings)) {
    return { settings, client: null };
  }

  return {
    settings,
    client: new OdooClient({
      baseUrl: sanitizeBaseUrl(settings.odoo.baseUrl),
      database: settings.odoo.database,
      username: settings.odoo.username,
      apiKey: settings.odoo.apiKey,
    }),
  };
}

async function buildPageModel(selectedBatchId: string | null) {
  let batches = await getRecentMpesaStatementBatches(12);
  let selectedBatch =
    selectedBatchId
      ? await getMpesaStatementBatchById(selectedBatchId)
      : batches[0] || null;
  let transactions: MpesaTransaction[] = [];

  if (selectedBatch) {
    await autoVerifyMpesaTransactionsByRule(selectedBatch.id);
    selectedBatch = await getMpesaStatementBatchById(selectedBatch.id);
    batches = await getRecentMpesaStatementBatches(12);
    const storedTransactions = await getMpesaTransactionsByBatchId(selectedBatch.id);
    transactions = sanitizeKnownPayerInvoiceCandidates(storedTransactions);
    const repairPatches = buildKnownPayerRepairPatches(storedTransactions, transactions);

    if (repairPatches.length > 0) {
      selectedBatch = await updateMpesaTransactions(selectedBatch.id, repairPatches);
      batches = await getRecentMpesaStatementBatches(12);
      transactions = sanitizeKnownPayerInvoiceCandidates(await getMpesaTransactionsByBatchId(selectedBatch.id));
    }
  }

  const statementTotalChecks = selectedBatch
    ? buildStatementTotalChecks(selectedBatch.rawTextPreview, transactions)
    : [];

  return { batches, selectedBatch, transactions, statementTotalChecks };
}

function normalizeSearch(value: string | null | undefined) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function hasAllSearchTokens(value: string | null | undefined, phrase: string) {
  const valueTokens = new Set(normalizeSearch(value).split(' ').filter(Boolean));
  return normalizeSearch(phrase)
    .split(' ')
    .filter(Boolean)
    .every((token) => valueTokens.has(token));
}

function findKnownPayerAliasForTransaction(transaction: MpesaTransaction) {
  const transactionText = `${transaction.counterparty || ''} ${transaction.userSupplier || ''} ${transaction.details}`;
  return KNOWN_MPESA_PAYER_ALIASES.find((alias) =>
    alias.payerNames.some((payerName) => hasAllSearchTokens(transactionText, payerName)),
  );
}

function knownPayerCandidateIsAllowed(
  candidate: MpesaTransaction['candidates'][number] | undefined,
  alias: (typeof KNOWN_MPESA_PAYER_ALIASES)[number],
) {
  return Boolean(candidate && hasAllSearchTokens(candidate.vendorName || '', alias.customerName));
}

function knownPayerSelectionIsAllowed(
  transaction: MpesaTransaction,
  selection: { matchedPoId: number | null; matchedPoName: string | null },
) {
  const alias = findKnownPayerAliasForTransaction(transaction);
  if (!alias || !selection.matchedPoId) {
    return true;
  }

  const candidate = transaction.candidates.find((entry) => entry.id === selection.matchedPoId);
  return knownPayerCandidateIsAllowed(candidate, alias);
}

function buildTrainingPayloadFromTransaction(
  transaction: MpesaTransaction,
  patch: { userCategory?: string | null; notes?: string | null },
) {
  const category = String(patch.userCategory || transaction.userCategory || '').trim();
  if (!category || !MPESA_CATEGORY_SET.has(category as (typeof MPESA_CATEGORY_OPTIONS)[number][0])) {
    return null;
  }

  return {
    category: category as MpesaCategory,
    details: transaction.details,
    counterparty: transaction.counterparty,
    direction: transaction.direction,
    paidIn: transaction.paidIn,
    withdrawn: transaction.withdrawn,
    phoneNumber: transaction.phoneNumber,
    rawDetails: typeof transaction.raw?.rawDetails === 'string' ? transaction.raw.rawDetails : undefined,
    notes: patch.notes ?? transaction.notes,
    source: 'manual' as const,
  };
}

async function trainMpesaCategoryRulesFromPatches(
  transactions: MpesaTransaction[],
  patches: Array<{
    id: string;
    userCategory?: string | null;
    notes?: string | null;
  }>,
) {
  const transactionById = new Map(transactions.map((transaction) => [transaction.id, transaction]));

  await Promise.all(
    patches
      .map((patch) => {
        const transaction = transactionById.get(patch.id);
        if (!transaction) {
          return null;
        }

        const payload = buildTrainingPayloadFromTransaction(transaction, patch);
        return payload ? trainMpesaCategoryFromTransaction(payload).catch(() => undefined) : null;
      })
      .filter((entry): entry is Promise<void> => Boolean(entry)),
  );
}

function findSelectedCandidate(
  transaction: MpesaTransaction,
  selection: { matchedPoId: number | null; matchedPoName: string | null },
) {
  return selection.matchedPoId
    ? transaction.candidates.find((candidate) => candidate.id === selection.matchedPoId) || null
    : null;
}

function normalizeInvoiceCandidateReasons(
  candidate: MpesaTransaction['candidates'][number],
  aliasReason: string,
) {
  const reasons = candidate.reasons
    .filter((reason) => !/^Invoice date is within/i.test(reason))
    .filter((reason, index, list) => list.indexOf(reason) === index);
  const withAlias = reasons.some((reason) => reason.includes('Known payer alias'))
    ? reasons
    : [aliasReason, ...reasons];

  if (candidate.dateOrder && !withAlias.some((reason) => reason.startsWith('Invoice date used:'))) {
    return [...withAlias, `Invoice date used: ${candidate.dateOrder}.`];
  }

  return withAlias;
}

function candidatesChanged(
  left: MpesaTransaction['candidates'],
  right: MpesaTransaction['candidates'],
) {
  return JSON.stringify(left) !== JSON.stringify(right);
}

function buildKnownPayerRepairPatches(
  storedTransactions: MpesaTransaction[],
  sanitizedTransactions: MpesaTransaction[],
) {
  return sanitizedTransactions
    .map((sanitized, index) => {
      const stored = storedTransactions[index];
      if (!stored || !findKnownPayerAliasForTransaction(stored)) {
        return null;
      }

      const changed =
        stored.matchedPoId !== sanitized.matchedPoId ||
        stored.matchedPoName !== sanitized.matchedPoName ||
        stored.matchConfidence !== sanitized.matchConfidence ||
        stored.reviewStatus !== sanitized.reviewStatus ||
        candidatesChanged(stored.candidates, sanitized.candidates);

      if (!changed) {
        return null;
      }

      return {
        id: sanitized.id,
        matchedPoId: sanitized.matchedPoId,
        matchedPoName: sanitized.matchedPoName,
        matchConfidence: sanitized.matchConfidence,
        candidates: sanitized.candidates,
        userCategory: sanitized.userCategory,
        userSupplier: sanitized.userSupplier,
        reviewStatus: sanitized.reviewStatus,
        notes: sanitized.notes,
      };
    })
    .filter((patch): patch is NonNullable<typeof patch> => Boolean(patch));
}

function sanitizeKnownPayerInvoiceCandidates(transactions: MpesaTransaction[]) {
  return transactions.map((transaction) => {
    if (transaction.direction !== 'in' && Number(transaction.paidIn || 0) <= 0) {
      return transaction;
    }

    const alias = findKnownPayerAliasForTransaction(transaction);
    if (!alias) {
      return transaction;
    }

    const aliasReason = `Known payer alias: ${alias.payerNames.join(', ')} pays for ${alias.customerName}.`;
    const candidates = transaction.candidates
      .filter((candidate) => knownPayerCandidateIsAllowed(candidate, alias))
      .map((candidate) => ({
        ...candidate,
        reasons: normalizeInvoiceCandidateReasons(candidate, aliasReason),
      }));
    const selectedCandidate = candidates.find((candidate) => candidate.id === transaction.matchedPoId);

    return {
      ...transaction,
      candidates,
      matchedPoId: selectedCandidate ? transaction.matchedPoId : null,
      matchedPoName: selectedCandidate ? transaction.matchedPoName : null,
      matchConfidence: selectedCandidate ? transaction.matchConfidence : null,
      reviewStatus: transaction.reviewStatus,
    };
  });
}

function asArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || ''));
  }
  if (value === undefined || value === null) {
    return [];
  }
  return [String(value)];
}

function firstString(value: unknown) {
  return asArray(value)[0] || '';
}

function parsePoSelection(value: string) {
  if (!value.trim()) {
    return { matchedPoId: null, matchedPoName: null };
  }

  const [id, ...nameParts] = value.split('|');
  const matchedPoId = Number(id);
  return {
    matchedPoId: Number.isFinite(matchedPoId) && matchedPoId !== 0 ? matchedPoId : null,
    matchedPoName: nameParts.join('|').trim() || null,
  };
}

function normalizeReviewStatus(value: string): MpesaTransaction['reviewStatus'] {
  return MPESA_REVIEW_STATUSES.includes(value as MpesaTransaction['reviewStatus'])
    ? value as MpesaTransaction['reviewStatus']
    : 'new';
}

function readTransactionExplorerFilters(source: Record<string, unknown>): MpesaTransactionExplorerFilters {
  const partyRole = firstString(source.partyRole);
  const reviewStatus = firstString(source.status);
  const month = firstString(source.month).trim();

  return {
    name: firstString(source.name).trim(),
    partyRole: partyRole === 'sender' || partyRole === 'receiver' ? partyRole : 'any',
    category: firstString(source.category).trim(),
    month: /^\d{4}-\d{2}$/.test(month) ? month : '',
    reviewStatus: MPESA_REVIEW_STATUSES.includes(reviewStatus as MpesaTransaction['reviewStatus'])
      ? reviewStatus as MpesaTransaction['reviewStatus']
      : '',
    statementId: firstString(source.statement).trim(),
  };
}

function transactionExplorerQueryString(
  filters: MpesaTransactionExplorerFilters,
  extra?: { message?: string; error?: string },
) {
  const params = new URLSearchParams();
  if (filters.name) params.set('name', filters.name);
  if (filters.partyRole !== 'any') params.set('partyRole', filters.partyRole);
  if (filters.category) params.set('category', filters.category);
  if (filters.month) params.set('month', filters.month);
  if (filters.reviewStatus) params.set('status', filters.reviewStatus);
  if (filters.statementId) params.set('statement', filters.statementId);
  if (extra?.message) params.set('message', extra.message);
  if (extra?.error) params.set('error', extra.error);
  const query = params.toString();
  return query ? `?${query}` : '';
}

function mpesaTransactionTotals(transactions: MpesaTransaction[]) {
  return transactions.reduce(
    (totals, transaction) => ({
      paidIn: roundMoney(totals.paidIn + Number(transaction.paidIn || 0)),
      withdrawn: roundMoney(totals.withdrawn + Number(transaction.withdrawn || 0)),
      net: roundMoney(totals.net + Number(transaction.paidIn || 0) - Number(transaction.withdrawn || 0)),
    }),
    { paidIn: 0, withdrawn: 0, net: 0 },
  );
}

function requireAdmin(req: Request, res: Response) {
  if (req.authUser?.role === 'admin') {
    return true;
  }

  res.status(403).render('error', {
    pageTitle: 'Access Denied',
    errorMessage: 'Only admins can open the M-Pesa transaction explorer.',
    details: [],
  });
  return false;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function parseStatementMoney(value: string) {
  const parsed = Number(value.replace(/,/g, ''));
  return Number.isFinite(parsed) ? roundMoney(parsed) : null;
}

function extractMoneyValues(value: string) {
  return (value.match(/\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2}/g) || [])
    .map(parseStatementMoney)
    .filter((entry): entry is number => typeof entry === 'number');
}

function extractStatementSummaryTotals(rawTextPreview: string | null | undefined) {
  const preview = String(rawTextPreview || '');
  const normalized = preview.replace(/\r/g, '');
  const totalLine = preview
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^Total/i.test(line));
  const totalBlock =
    totalLine ||
    normalized.match(/Total[\s\S]{0,160}?(?=Receipt\s+No|Receipt No|Completion\s+Time|$)/i)?.[0] ||
    normalized.match(/Total\s*\d[\d,]*\.\d{2}\s*\d[\d,]*\.\d{2}/i)?.[0] ||
    '';
  const values = extractMoneyValues(totalBlock);

  return {
    paidIn: values[0] ?? null,
    withdrawn: values[1] ?? null,
  };
}

function buildStatementTotalChecks(
  rawTextPreview: string | null | undefined,
  transactions: MpesaTransaction[],
): MpesaStatementTotalCheck[] {
  const expected = extractStatementSummaryTotals(rawTextPreview);
  const extracted = {
    paidIn: roundMoney(transactions.reduce((sum, transaction) => sum + Number(transaction.paidIn || 0), 0)),
    withdrawn: roundMoney(transactions.reduce((sum, transaction) => sum + Number(transaction.withdrawn || 0), 0)),
  };

  const rowChecks = transactions.reduce(
    (result, transaction, index) => {
      const hasAmount = Number(transaction.paidIn || 0) > 0 || Number(transaction.withdrawn || 0) > 0;
      if (transaction.receiptNumber && transaction.completionTime && transaction.balance !== null && hasAmount) {
        result.validatedRows += 1;
      }

      const next = transactions[index + 1];
      if (next && transaction.balance !== null && next.balance !== null && hasAmount) {
        const signedAmount = Number(transaction.paidIn || 0) - Number(transaction.withdrawn || 0);
        const expectedPreviousBalance = roundMoney(Number(transaction.balance) - signedAmount);
        result.balanceChecks += 1;
        if (Math.abs(expectedPreviousBalance - Number(next.balance)) > 0.01) {
          result.balanceMismatches += 1;
        }
      }

      return result;
    },
    { validatedRows: 0, balanceChecks: 0, balanceMismatches: 0 },
  );
  const rowsVerified = transactions.length > 0 &&
    rowChecks.validatedRows === transactions.length &&
    rowChecks.balanceChecks > 0;

  return [
    { key: 'paidIn' as const, label: 'Paid in match status', expected: expected.paidIn, extracted: extracted.paidIn },
    { key: 'withdrawn' as const, label: 'Withdrawn match status', expected: expected.withdrawn, extracted: extracted.withdrawn },
  ].map((check) => {
    const difference = check.expected === null ? null : roundMoney(check.extracted - check.expected);
    const hasSummaryValue = check.expected !== null;
    const status = !hasSummaryValue
      ? rowsVerified ? 'verified' as const : 'needs_review' as const
      : Math.abs(difference || 0) <= 0.01
        ? 'match' as const
        : 'mismatch' as const;
    return {
      ...check,
      difference,
      status,
      validationMode: hasSummaryValue ? 'summary' as const : 'rows' as const,
      validatedRows: rowChecks.validatedRows,
      balanceChecks: rowChecks.balanceChecks,
      balanceMismatches: rowChecks.balanceMismatches,
      totalRows: transactions.length,
      diagnosis:
        status === 'verified'
          ? `No summary printed. Verified ${rowChecks.validatedRows} extracted rows. Running-balance checks: ${rowChecks.balanceChecks - rowChecks.balanceMismatches} passed, ${rowChecks.balanceMismatches} flagged for review.`
          : status === 'needs_review'
            ? `No summary printed. ${rowChecks.validatedRows} of ${transactions.length} rows have complete fields; ${rowChecks.balanceMismatches} of ${rowChecks.balanceChecks} running-balance checks failed.`
          : status === 'match'
            ? 'All extracted rows reconcile to the statement summary.'
            : difference! < 0
              ? 'Extracted rows are lower than the statement. Review OCR for missing, split, or unreadable transactions.'
              : 'Extracted rows are higher than the statement. Review duplicate or incorrectly classified transactions.',
    };
  });
}

function uploadSingleFile(fieldName: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    upload.single(fieldName)(req, res, (err) => {
      if (err) {
        const batchIdParam = req.params.batchId ? `batch=${encodeURIComponent(req.params.batchId)}&` : '';
        const message = err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE'
          ? 'The statement is too large. Maximum upload size is 25 MB.'
          : err instanceof Error ? err.message : 'Upload an M-Pesa statement PDF, image, or Excel file.';
        return res.redirect(`/mpesa-reconciliation?${batchIdParam}error=${encodeURIComponent(message)}`);
      }
      next();
    });
  };
}

function resolveStoredMpesaFile(storedFilename: string) {
  const resolved = path.resolve(uploadDir, storedFilename);
  if (resolved !== resolvedUploadDir && !resolved.startsWith(`${resolvedUploadDir}${path.sep}`)) {
    throw new Error('Stored M-Pesa document path is invalid.');
  }

  return resolved;
}

function contentTypeForStatementFile(filename: string) {
  const extension = path.extname(filename).toLowerCase();
  if (extension === '.pdf') return 'application/pdf';
  if (extension === '.png') return 'image/png';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.tif' || extension === '.tiff') return 'image/tiff';
  if (extension === '.xls') return 'application/vnd.ms-excel';
  if (extension === '.xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  return 'application/octet-stream';
}

function attachmentDisposition(filename: string) {
  const fallback = path.basename(filename).replace(/["\r\n]/g, '_') || 'mpesa-statement';
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(path.basename(filename))}`;
}

function dateOnly(value: string | null) {
  if (!value) {
    return null;
  }

  const match = String(value).match(/^(\d{4}-\d{1,2}-\d{1,2})/);
  return match ? match[1] : null;
}

function salaryAdvancePeriodDefaults(transactions: MpesaTransaction[]) {
  const dates = transactions
    .map((transaction) => dateOnly(transaction.transactionDate))
    .filter((value): value is string => Boolean(value))
    .sort();

  if (!dates.length) {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    return {
      periodStart: `${year}-${String(month + 1).padStart(2, '0')}-01`,
      periodEnd: new Date(year, month + 1, 0).toISOString().slice(0, 10),
    };
  }

  const first = new Date(`${dates[0]}T00:00:00`);
  const year = first.getFullYear();
  const month = first.getMonth();
  return {
    periodStart: `${year}-${String(month + 1).padStart(2, '0')}-01`,
    periodEnd: new Date(year, month + 1, 0).toISOString().slice(0, 10),
  };
}

async function deleteStoredMpesaFile(storedFilename: string) {
  if (!storedFilename) {
    return null;
  }

  try {
    await fs.unlink(resolveStoredMpesaFile(storedFilename));
    return null;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null;
    }

    return error instanceof Error ? error.message : String(error);
  }
}

router.get('/mpesa-reconciliation', async (req, res) => {
  try {
    const model = await buildPageModel(typeof req.query.batch === 'string' ? req.query.batch : null);
    const salaryAdvanceRecords = buildPayrollAdvanceRecords(model.transactions);
    const salaryAdvancePeriod = salaryAdvancePeriodDefaults(model.transactions);
    const monthlySalaryAdvanceTransactions = await getReviewedSalaryAdvanceTransactionsByPeriod({
      periodStart: salaryAdvancePeriod.periodStart,
      periodEnd: salaryAdvancePeriod.periodEnd,
    });
    const monthlySalaryAdvanceRecords = buildPayrollAdvanceRecords(monthlySalaryAdvanceTransactions);
    res.render('mpesa-reconciliation', {
      pageTitle: 'M-Pesa Reconciliation',
      status:
        typeof req.query.message === 'string'
          ? { type: 'success', message: req.query.message }
          : typeof req.query.error === 'string'
            ? { type: 'danger', message: req.query.error }
            : null,
      extractionJobId: typeof req.query.job === 'string' ? req.query.job : '',
      salaryAdvanceShare: {
        count: salaryAdvanceRecords.length,
        total: salaryAdvanceRecords.reduce((sum, record) => sum + record.amount, 0),
        ...salaryAdvancePeriod,
      },
      generalAdvanceShare: {
        count: monthlySalaryAdvanceRecords.length,
        total: monthlySalaryAdvanceRecords.reduce((sum, record) => sum + record.amount, 0),
        statementCount: new Set(monthlySalaryAdvanceTransactions.map((transaction) => transaction.batchId)).size,
        ...salaryAdvancePeriod,
      },
      ...model,
    });
  } catch (error) {
    res.status(500).render('mpesa-reconciliation', {
      pageTitle: 'M-Pesa Reconciliation',
      status: {
        type: 'danger',
        message: error instanceof Error ? error.message : 'Could not load M-Pesa reconciliation.',
      },
      extractionJobId: typeof req.query.job === 'string' ? req.query.job : '',
      batches: [],
      selectedBatch: null,
      transactions: [],
      statementTotalChecks: [],
      salaryAdvanceShare: {
        count: 0,
        total: 0,
        periodStart: '',
        periodEnd: '',
      },
      generalAdvanceShare: {
        count: 0,
        total: 0,
        statementCount: 0,
        periodStart: '',
        periodEnd: '',
      },
    });
  }
});

router.get('/mpesa-reconciliation/review-count', async (_req, res) => {
  const batches = await getMpesaStatementBatchesWithOpenReviewCounts();
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    ok: true,
    count: batches.length,
    checkedAt: new Date().toISOString(),
  });
});

router.get('/mpesa-reconciliation/extraction-jobs/:jobId', async (req, res) => {
  if (req.authUser?.role !== 'admin') {
    return res.status(403).json({ ok: false, error: 'Admin access is required.' });
  }

  try {
    const job = await getMpesaExtractionJobById(req.params.jobId);
    const batch = await getMpesaStatementBatchById(job.batchId);
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      ok: true,
      job: {
        id: job.id,
        batchId: job.batchId,
        status: job.status,
        errorMessage: job.errorMessage,
        transactionCount: job.transactionCount,
      },
      batch: {
        id: batch.id,
        status: batch.status,
        transactionCount: batch.transactionCount,
      },
    });
  } catch (error) {
    res.status(404).json({
      ok: false,
      error: error instanceof Error ? error.message : 'M-Pesa extraction job was not found.',
    });
  }
});

router.get('/mpesa-reconciliation/transactions', async (req, res) => {
  if (!requireAdmin(req, res)) {
    return;
  }

  try {
    const filters = readTransactionExplorerFilters(req.query as Record<string, unknown>);
    await autoVerifyMpesaTransactionsByRule();
    const [transactions, filterOptions] = await Promise.all([
      getMpesaTransactionExplorerRows(filters),
      getMpesaTransactionExplorerOptions(),
    ]);

    res.render('mpesa-transactions', {
      pageTitle: 'M-Pesa Transactions',
      status:
        typeof req.query.message === 'string'
          ? { type: 'success', message: req.query.message }
          : typeof req.query.error === 'string'
            ? { type: 'danger', message: req.query.error }
            : null,
      filters,
      transactions,
      totals: mpesaTransactionTotals(transactions),
      filterOptions,
      categoryOptions: MPESA_CATEGORY_OPTIONS,
      reviewStatuses: MPESA_REVIEW_STATUSES,
      filterQueryString: transactionExplorerQueryString(filters),
    });
  } catch (error) {
    res.status(500).render('mpesa-transactions', {
      pageTitle: 'M-Pesa Transactions',
      status: {
        type: 'danger',
        message: error instanceof Error ? error.message : 'Could not load M-Pesa transactions.',
      },
      filters: readTransactionExplorerFilters({}),
      transactions: [],
      totals: { paidIn: 0, withdrawn: 0, net: 0 },
      filterOptions: { categories: [], months: [], statements: [] },
      categoryOptions: MPESA_CATEGORY_OPTIONS,
      reviewStatuses: MPESA_REVIEW_STATUSES,
      filterQueryString: '',
    });
  }
});

router.post('/mpesa-reconciliation/transactions', async (req, res) => {
  if (!requireAdmin(req, res)) {
    return;
  }

  const filters = readTransactionExplorerFilters(req.query as Record<string, unknown>);

  try {
    const ids = asArray(req.body.transactionId);
    const batchIds = asArray(req.body.batchId);
    const categories = asArray(req.body.userCategory);
    const statuses = asArray(req.body.reviewStatus);
    const notes = asArray(req.body.notes);
    const patches = ids.map((id, index) => ({
      id,
      batchId: batchIds[index] || '',
      userCategory: categories[index] || null,
      reviewStatus: normalizeReviewStatus(statuses[index] || 'new'),
      notes: notes[index]?.trim() || undefined,
    }));

    const touchedBatchCount = await updateMpesaTransactionAdminReviewFields(patches);
    const transactions = await getMpesaTransactionsByIds(patches.map((patch) => patch.id));
    await trainMpesaCategoryRulesFromPatches(transactions, patches);
    res.redirect(
      `/mpesa-reconciliation/transactions${transactionExplorerQueryString(filters, {
        message: `Saved ${patches.length} filtered transaction row(s) across ${touchedBatchCount} statement(s).`,
      })}`,
    );
  } catch (error) {
    res.redirect(
      `/mpesa-reconciliation/transactions${transactionExplorerQueryString(filters, {
        error: error instanceof Error ? error.message : 'Could not save filtered M-Pesa transactions.',
      })}`,
    );
  }
});

router.get('/mpesa-reconciliation/batches/:batchId/download', async (req, res) => {
  try {
    const batch = await getMpesaStatementBatchById(req.params.batchId);
    const storedFilePath = resolveStoredMpesaFile(batch.storedFilename);
    await fs.access(storedFilePath);
    const filename = batch.originalFilename || path.basename(batch.storedFilename);
    res.setHeader('Content-Type', contentTypeForStatementFile(filename || batch.storedFilename));
    res.setHeader('Content-Disposition', attachmentDisposition(filename));
    res.setHeader('Cache-Control', 'private, no-store');
    res.sendFile(storedFilePath);
  } catch (error) {
    res.status(404).type('text/plain').send(error instanceof Error ? error.message : 'M-Pesa document was not found.');
  }
});

router.post('/mpesa-reconciliation/upload', uploadSingleFile('file'), async (req, res) => {
  try {
    if (!req.file) {
      throw new Error('Upload an M-Pesa statement PDF, image, or Excel file.');
    }
    const batch = await createMpesaStatementBatch({
      originalFilename: req.file.originalname,
      storedFilename: req.file.filename,
      status: 'processing',
      warnings: [],
      rawTextPreview: '',
      transactions: [],
    });
    const job = await createMpesaExtractionJob({
      batchId: batch.id,
      jobType: 'upload',
      originalFilename: req.file.originalname,
      storedFilename: req.file.filename,
    });
    wakeMpesaExtractionJobWorker();

    res.redirect(
      `/mpesa-reconciliation?batch=${encodeURIComponent(batch.id)}&job=${encodeURIComponent(job.id)}&message=${encodeURIComponent(
        'M-Pesa statement uploaded. Extraction is running in the background.',
      )}`,
    );
  } catch (error) {
    if (req.file?.path) {
      await deleteStoredMpesaFile(req.file.filename).catch(() => undefined);
    }
    res.redirect(
      `/mpesa-reconciliation?error=${encodeURIComponent(
        error instanceof Error ? error.message : 'M-Pesa statement import failed.',
      )}`,
    );
  }
});

router.post('/mpesa-reconciliation/batches/:batchId/reprocess', async (req, res) => {
  const batchId = req.params.batchId;

  try {
    const batch = await getMpesaStatementBatchById(batchId);
    const storedFilePath = resolveStoredMpesaFile(batch.storedFilename);
    await fs.access(storedFilePath);

    await markMpesaStatementBatchProcessing(batch.id);
    const job = await createMpesaExtractionJob({
      batchId: batch.id,
      jobType: 'reprocess',
      originalFilename: batch.originalFilename,
      storedFilename: batch.storedFilename,
    });
    wakeMpesaExtractionJobWorker();

    res.redirect(
      `/mpesa-reconciliation?batch=${encodeURIComponent(batch.id)}&job=${encodeURIComponent(job.id)}&message=${encodeURIComponent(
        'Extraction retry started in the background.',
      )}`,
    );
  } catch (error) {
    res.redirect(
      `/mpesa-reconciliation?batch=${encodeURIComponent(batchId)}&error=${encodeURIComponent(
        error instanceof Error ? error.message : 'Could not retry extraction for this M-Pesa document.',
      )}`,
    );
  }
});

router.post('/mpesa-reconciliation/batches/:batchId/reupload', uploadSingleFile('file'), async (req, res) => {
  const batchId = req.params.batchId;

  try {
    if (req.authUser?.role !== 'admin') {
      throw new Error('Only admins can reupload M-Pesa statements.');
    }

    if (!req.file) {
      throw new Error('Upload a replacement M-Pesa statement PDF, image, or Excel file.');
    }

    const batch = await getMpesaStatementBatchById(batchId);
    await markMpesaStatementBatchProcessing(batch.id);
    const job = await createMpesaExtractionJob({
      batchId: batch.id,
      jobType: 'reupload',
      originalFilename: req.file.originalname,
      storedFilename: req.file.filename,
      previousStoredFilename: batch.storedFilename,
    });
    wakeMpesaExtractionJobWorker();

    res.redirect(
      `/mpesa-reconciliation?batch=${encodeURIComponent(batch.id)}&job=${encodeURIComponent(job.id)}&message=${encodeURIComponent(
        'Replacement statement uploaded. Extraction is running in the background.',
      )}`,
    );
  } catch (error) {
    if (req.file) {
      await deleteStoredMpesaFile(req.file.filename).catch(() => undefined);
    }

    res.redirect(
      `/mpesa-reconciliation?batch=${encodeURIComponent(batchId)}&error=${encodeURIComponent(
        error instanceof Error ? error.message : 'Could not reupload this M-Pesa document.',
      )}`,
    );
  }
});

router.get('/mpesa-reconciliation/batches/:batchId/diagnostics', async (req, res) => {
  if (req.authUser?.role !== 'admin') {
    return res.status(403).json({ ok: false, error: 'Only super admins can view diagnostic logs.' });
  }

  try {
    const batchId = req.params.batchId;
    const batch = await getMpesaStatementBatchById(batchId);
    const transactions = await getMpesaTransactionsByBatchId(batchId);
    const settings = await getSettings();
    const totalChecks = buildStatementTotalChecks(batch.rawTextPreview, transactions);

    const aiInfo = {
      provider: settings.ai.provider,
      model: settings.ai.model,
      ocrProvider: settings.ai.ocr.provider,
      ocrModel: settings.ai.ocr.model,
      ocrEnabled: settings.ai.ocr.enabled,
      geminiOAuthConnected: settings.ai.geminiOAuth.connected,
      geminiOAuthEmail: settings.ai.geminiOAuth.email || null,
      hasGeminiApiKey: Boolean(settings.ai.apiKeys.gemini),
    };

    return res.json({
      ok: true,
      batch: {
        id: batch.id,
        originalFilename: batch.originalFilename,
        storedFilename: batch.storedFilename,
        status: batch.status,
        transactionCount: batch.transactionCount,
        matchedCount: batch.matchedCount,
        warningCount: batch.warningCount,
        createdAt: batch.createdAt,
        updatedAt: batch.updatedAt,
      },
      aiInfo,
      totalChecks,
      warnings: batch.warnings || [],
      rawTextPreview: batch.rawTextPreview || '',
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Could not load diagnostic log.',
    });
  }
});

router.post('/mpesa-reconciliation/batches/:batchId/delete', async (req, res) => {
  try {
    const batch = await deleteMpesaStatementBatch(req.params.batchId);
    const fileDeleteError = await deleteStoredMpesaFile(batch.storedFilename);
    const message = fileDeleteError
      ? `Deleted ${batch.originalFilename}, but the uploaded file could not be removed: ${fileDeleteError}`
      : `Deleted ${batch.originalFilename}.`;

    res.redirect(`/mpesa-reconciliation?message=${encodeURIComponent(message)}`);
  } catch (error) {
    res.redirect(
      `/mpesa-reconciliation?batch=${encodeURIComponent(req.params.batchId)}&error=${encodeURIComponent(
        error instanceof Error ? error.message : 'Could not delete the M-Pesa document.',
      )}`,
    );
  }
});

router.post('/mpesa-reconciliation/batches/:batchId/share-salary-advances', async (req, res) => {
  const batchId = req.params.batchId;

  try {
    const periodStart = String(req.body.periodStart || '').trim();
    const periodEnd = String(req.body.periodEnd || '').trim();
    if (!periodStart || !periodEnd) {
      throw new Error('Select the payroll period before sharing salary advances.');
    }

    const transactions = await getReviewedSalaryAdvanceTransactionsByPeriod({
      periodStart,
      periodEnd,
    });
    const settings = await getSettings();
    const statementCount = new Set(transactions.map((transaction) => transaction.batchId)).size;
    const result = await sharePayrollAdvances({
      periodStart,
      periodEnd,
      transactions,
      bridge: settings.payrollBridge,
    });
    let payrollMessage = '';

    if (settings.payrollBridge.autoCreatePayRun) {
      const payRunName = buildPayrollPayRunName(
        periodStart,
        periodEnd,
        settings.payrollBridge.payRunNameTemplate,
      );
      if (!hasOdooConfiguration(settings)) {
        throw new Error('Odoo is not configured in the reconciler app settings.');
      }

      const payRunResult = await createPayrollPayRun({
        periodStart,
        periodEnd,
        payRunName,
        bridge: settings.payrollBridge,
        odooCredentials: {
          baseUrl: sanitizeBaseUrl(settings.odoo.baseUrl),
          database: settings.odoo.database,
          username: settings.odoo.username,
          apiKey: settings.odoo.apiKey,
        },
      });
      const issueCount = Array.isArray(payRunResult.issues) ? payRunResult.issues.length : 0;
      const payRunId = payRunResult.pay_run?.id ? ` #${payRunResult.pay_run.id}` : '';
      payrollMessage =
        payRunResult.status === 'ok'
          ? ` Created Odoo pay run${payRunId} (${payRunName}).`
          : ` Payroll bridge returned ${payRunResult.status || 'failed'} with ${issueCount} issue(s).`;
    }

    res.redirect(
      `/mpesa-reconciliation?batch=${encodeURIComponent(batchId)}&message=${encodeURIComponent(
        `Shared ${result.received} salary advance row(s) from ${statementCount} statement(s) for ${periodStart} to ${periodEnd}.${payrollMessage}`,
      )}`,
    );
  } catch (error) {
    res.redirect(
      `/mpesa-reconciliation?batch=${encodeURIComponent(batchId)}&error=${encodeURIComponent(
        error instanceof Error ? error.message : 'Could not share salary advances with payroll.',
      )}`,
    );
  }
});

router.post('/mpesa-reconciliation/batches/:batchId/transactions', async (req, res) => {
  const batchId = req.params.batchId;

  try {
    const ids = asArray(req.body.transactionId);
    const poSelections = asArray(req.body.poSelection);
    const categories = asArray(req.body.userCategory);
    const suppliers = asArray(req.body.userSupplier);
    const statuses = asArray(req.body.reviewStatus);
    const notes = asArray(req.body.notes);
    const existingTransactions = await getMpesaTransactionsByBatchId(batchId);
    const transactionById = new Map(existingTransactions.map((transaction) => [transaction.id, transaction]));

    const patches = ids.map((id, index) => {
      const transaction = transactionById.get(id);
      let selectedPo = parsePoSelection(poSelections[index] || '');
      let reviewStatus = normalizeReviewStatus(statuses[index] || 'new');
      let matchConfidence: number | null | undefined = transaction
        ? findSelectedCandidate(transaction, selectedPo)?.score ?? null
        : undefined;

      if (transaction && !knownPayerSelectionIsAllowed(transaction, selectedPo)) {
        selectedPo = { matchedPoId: null, matchedPoName: null };
        reviewStatus = 'needs_followup';
        matchConfidence = null;
      }

      return {
        id,
        ...selectedPo,
        matchConfidence,
        userCategory: categories[index] || null,
        userSupplier: suppliers[index] || null,
        reviewStatus,
        notes: notes[index]?.trim() || undefined,
      };
    });

    await updateMpesaTransactions(batchId, patches);
    await trainMpesaCategoryRulesFromPatches(existingTransactions, patches);
    res.redirect(
      `/mpesa-reconciliation?batch=${encodeURIComponent(batchId)}&message=${encodeURIComponent(
        'M-Pesa invoice and PO matches updated.',
      )}`,
    );
  } catch (error) {
    res.redirect(
      `/mpesa-reconciliation?batch=${encodeURIComponent(batchId)}&error=${encodeURIComponent(
        error instanceof Error ? error.message : 'Could not save M-Pesa reconciliation rows.',
      )}`,
    );
  }
});

router.post('/mpesa-reconciliation/batches/:batchId/reconcile-pos', async (req, res) => {
  const batchId = req.params.batchId;

  try {
    if (req.authUser?.role !== 'admin') {
      throw new Error('Only admins can reconcile M-Pesa transactions with Purchase Orders.');
    }

    const transactionIds = asArray(req.body.transactionId).filter(Boolean);
    const result = await processMpesaPoReconciliation(batchId, transactionIds.length > 0 ? transactionIds : undefined);

    const messageParts: string[] = [];
    if (result.processed > 0) {
      messageParts.push(`Reconciled ${result.processed} transaction(s) with POs.`);
    }
    if (result.approved.length > 0) {
      messageParts.push(`Approved: ${result.approved.join(', ')}.`);
    }
    if (result.billsCreated.length > 0) {
      messageParts.push(`Bills created: ${result.billsCreated.join(', ')}.`);
    }
    if (result.paymentsRegistered.length > 0) {
      messageParts.push(`Payments registered: ${result.paymentsRegistered.join(', ')}.`);
    }
    if (result.skipped.length > 0) {
      messageParts.push(`Skipped: ${result.skipped.join(', ')}.`);
    }
    if (result.errors.length > 0) {
      messageParts.push(`Errors: ${result.errors.join(', ')}.`);
    }

    const hasErrors = result.errors.length > 0 || (result.processed === 0 && result.skipped.length === 0);
    const message = messageParts.join(' ') || 'No matched transactions found to reconcile.';

    res.redirect(
      `/mpesa-reconciliation?batch=${encodeURIComponent(batchId)}&${
        hasErrors ? 'error' : 'message'
      }=${encodeURIComponent(message)}`,
    );
  } catch (error) {
    res.redirect(
      `/mpesa-reconciliation?batch=${encodeURIComponent(batchId)}&error=${encodeURIComponent(
        error instanceof Error ? error.message : 'Could not reconcile M-Pesa transactions with POs.',
      )}`,
    );
  }
});

router.post('/mpesa-reconciliation/reconcile-all', async (req, res) => {
  try {
    if (req.authUser?.role !== 'admin') {
      throw new Error('Only admins can reconcile M-Pesa transactions with Purchase Orders.');
    }

    const fromMonth = String(req.body.fromMonth || '2026-01').trim();
    if (!/^\d{4}-\d{2}$/.test(fromMonth)) {
      throw new Error('Enter a valid from month in YYYY-MM format.');
    }

    const result = await processMpesaPoReconciliationByMonth(fromMonth);

    const messageParts: string[] = [];
    if (result.processed > 0) {
      messageParts.push(`Reconciled ${result.processed} transaction(s) from ${fromMonth} onwards.`);
    }
    if (result.approved.length > 0) {
      messageParts.push(`Approved: ${result.approved.join(', ')}.`);
    }
    if (result.billsCreated.length > 0) {
      messageParts.push(`Bills created: ${result.billsCreated.join(', ')}.`);
    }
    if (result.paymentsRegistered.length > 0) {
      messageParts.push(`Payments registered: ${result.paymentsRegistered.join(', ')}.`);
    }
    if (result.skipped.length > 0) {
      messageParts.push(`Skipped: ${result.skipped.join(', ')}.`);
    }
    if (result.errors.length > 0) {
      messageParts.push(`Errors: ${result.errors.join(', ')}.`);
    }

    const hasErrors = result.errors.length > 0 || (result.processed === 0);
    const message = messageParts.join(' ') || 'No matched transactions found to reconcile.';

    res.redirect(
      `/mpesa-reconciliation?${hasErrors ? 'error' : 'message'}=${encodeURIComponent(message)}`,
    );
  } catch (error) {
    res.redirect(
      `/mpesa-reconciliation?error=${encodeURIComponent(
        error instanceof Error ? error.message : 'Could not reconcile all M-Pesa transactions.',
      )}`,
    );
  }
});

// ─── AI-Powered Categorization ──────────────────────────────────────────
/**
 * POST /mpesa-reconciliation/ai-categorize
 * Uses AI to categorize a batch of M-Pesa transactions.
 * Body: { batchId?: string, transactionIds?: string[] }
 * Updates user_category on matched transactions.
 */
router.post('/mpesa-reconciliation/ai-categorize', async (req, res) => {
  if (!requireAdmin(req, res)) {
    return;
  }

  try {
    const batchId = typeof req.body.batchId === 'string' ? req.body.batchId : null;
    const transactionIds: string[] = Array.isArray(req.body.transactionIds)
      ? req.body.transactionIds.filter((id: unknown) => typeof id === 'string')
      : [];

    // If neither batchId nor transactionIds, try to use the current batch from query
    let transactions: MpesaTransaction[] = [];

    if (batchId) {
      transactions = await getMpesaTransactionsByBatchId(batchId);
    } else if (transactionIds.length > 0) {
      // Fetch individual transactions from all batches
      const allBatches = await getRecentMpesaStatementBatches(50);
      for (const batch of allBatches) {
        const batchTxs = await getMpesaTransactionsByBatchId(batch.id);
        for (const tx of batchTxs) {
          if (transactionIds.includes(tx.id)) {
            transactions.push(tx);
          }
        }
      }
    } else {
      return res.status(400).json({
        ok: false,
        error: 'Provide batchId or transactionIds in the request body.',
      });
    }

    if (transactions.length === 0) {
      return res.status(404).json({
        ok: false,
        error: 'No transactions found for the provided batch or IDs.',
      });
    }

    // Filter to only uncategorized or "new" transactions (optional: skip already-reviewed)
    const targetTransactions = transactions.filter(
      (tx) =>
        tx.direction === 'out' &&
        (tx.withdrawn && tx.withdrawn > 0) &&
        tx.transactionType !== 'mpesa_charge',
    );

    if (targetTransactions.length === 0) {
      return res.json({
        ok: true,
        message: 'No eligible transactions to categorize (only outgoing non-charge payments).',
        categorized: 0,
        results: [],
      });
    }

    // Run AI categorization
    const results = await categorizeBatchWithAi(
      targetTransactions.map((tx) => ({
        id: tx.id,
        details: tx.details,
        counterparty: tx.counterparty,
        direction: tx.direction,
        paidIn: tx.paidIn,
        withdrawn: tx.withdrawn,
        phoneNumber: tx.phoneNumber,
        notes: tx.notes,
        rawDetails: typeof tx.raw?.rawDetails === 'string' ? tx.raw.rawDetails : undefined,
      })),
    );

    // Update user_category on each transaction
    const patches: Array<{
      id: string;
      batchId: string;
      userCategory: string;
      reviewStatus?: MpesaTransaction['reviewStatus'];
      notes?: string;
      aiNotes?: string;
    }> = [];

    for (const result of results) {
      const tx = transactions.find((t) => t.id === result.id);
      if (!tx) continue;

      const note =
        result.method === 'ai'
          ? `AI (${result.confidence * 100}%): ${result.reason}`
          : `Keyword (${result.confidence * 100}%): ${result.reason}`;

      patches.push({
        id: result.id,
        batchId: tx.batchId,
        userCategory: result.category,
        reviewStatus: result.confidence >= 0.6 ? 'reviewed' : 'needs_followup',
        aiNotes: note,
      });
    }

    // Apply updates
    let updatedCount = 0;
    if (patches.length > 0) {
      updatedCount = await updateMpesaTransactionAdminReviewFields(patches);
    }

    // Build summary
    const transportResults = results.filter(
      (r) => r.category === 'transport_expense' || r.category === 'staff_transport_expense',
    );
    const aiCount = results.filter((r) => r.method === 'ai').length;
    const keywordCount = results.filter((r) => r.method === 'keyword').length;

    res.json({
      ok: true,
      message: `AI categorized ${results.length} transactions (${aiCount} via AI, ${keywordCount} via keywords). ${transportResults.length} identified as Transport.`,
      categorized: updatedCount,
      summary: {
        total: results.length,
        aiCategorized: aiCount,
        keywordCategorized: keywordCount,
        transportCount: transportResults.length,
        categories: results.reduce<Record<string, number>>((acc, r) => {
          acc[r.category] = (acc[r.category] || 0) + 1;
          return acc;
        }, {}),
      },
      results: results.map((r) => ({
        id: r.id,
        category: r.category,
        categoryLabel: r.categoryLabel,
        confidence: r.confidence,
        reason: r.reason,
        method: r.method,
        isTransport: r.transportAnalysis.isTransport,
        transportKeywords: r.transportAnalysis.matchedRules.map((m) => m.label),
      })),
    });
  } catch (error) {
    console.error('[ai-categorize] Error:', error);
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'AI categorization failed.',
    });
  }
});

/**
 * GET /mpesa-reconciliation/transport-keywords
 * Returns the list of transport keyword rules for admin review.
 */
router.get('/mpesa-reconciliation/transport-keywords', async (_req, res) => {
  const rules = getTransportKeywordRules();
  res.json({
    ok: true,
    rules: rules.map((r) => ({
      pattern: r.pattern.source,
      weight: r.weight,
      label: r.label,
    })),
    totalRules: rules.length,
    maxPossibleWeight: rules.reduce((sum, r) => sum + r.weight, 0),
  });
});

/**
 * POST /mpesa-reconciliation/analyze-transport
 * Analyzes a single transaction's text for transport keywords without saving.
 * Body: { details: string, counterparty?: string, direction?: string }
 */
router.post('/mpesa-reconciliation/analyze-transport', async (req, res) => {
  const details = typeof req.body.details === 'string' ? req.body.details.trim() : '';
  if (!details) {
    return res.status(400).json({ ok: false, error: 'Provide transaction details text.' });
  }

  const analysis = analyzeTransportKeywords({
    details,
    counterparty: typeof req.body.counterparty === 'string' ? req.body.counterparty : null,
    rawDetails: typeof req.body.rawDetails === 'string' ? req.body.rawDetails : undefined,
    direction: typeof req.body.direction === 'string' ? req.body.direction : 'out',
  });

  const indicators = extractTransportIndicators({
    details,
    counterparty: typeof req.body.counterparty === 'string' ? req.body.counterparty : null,
    rawDetails: typeof req.body.rawDetails === 'string' ? req.body.rawDetails : undefined,
  });

  res.json({
    ok: true,
    analysis: {
      isTransport: analysis.isTransport,
      confidence: analysis.confidence,
      subType: analysis.subType,
      totalWeight: analysis.totalWeight,
      matchedRules: analysis.matchedRules,
      extractedKeywords: indicators,
    },
  });
});

/**
 * Searches existing transactions' notes for PO references and matches them.
 */
async function matchTransactionsByNotesPoRef(
  transactions: MpesaTransaction[],
  odooClient: OdooClient,
  batchId: string,
) {
  const patches: Array<{
    id: string;
    matchedPoId?: number | null;
    matchedPoName?: string | null;
    matchConfidence?: number | null;
    candidates?: MpesaTransaction['candidates'];
    reviewStatus?: MpesaTransaction['reviewStatus'];
    notes?: string | null;
  }> = [];

  const purchaseOrders = await odooClient.searchPurchaseOrders({ limit: 500 });

  for (const tx of transactions) {
    const noteText = tx.notes || '';
    const explicitPoRefs = [...noteText.matchAll(/\bPO\s*[:#-]?\s*(\d{2,7})\b/gi)]
      .map((match) => match[1]);
    const chainedPoRefs = explicitPoRefs.length === 1
      ? [...noteText.slice(noteText.search(/\bPO\s*[:#-]?\s*\d{2,7}\b/i) + 1)
        .matchAll(/\b(?:AND|&)\s*(?:PO\s*[:#-]?\s*)?(\d{2,7})\b/gi)]
        .map((match) => match[1])
      : [];
    const poRefs = [...new Set([...explicitPoRefs, ...chainedPoRefs])];

    // Keep the older fallback for rows whose details contain a bare PO-like
    // reference, but prefer explicit PO references in Notes so dates, amounts,
    // and phone numbers are not mistaken for purchase orders.
    const searchText = [tx.notes || '', tx.details || '', tx.counterparty || ''].join(' ');
    const fallbackPoRef = poRefs.length === 0
      ? searchText.match(/\b(?:PO[:\s#-]*)(\d{2,7})\b/i)?.[1] || null
      : null;
    const resolvedPoRefs = poRefs.length > 0 ? poRefs : fallbackPoRef ? [fallbackPoRef] : [];
    if (resolvedPoRefs.length === 0) continue;

    const exactPos = resolvedPoRefs
      .map((poIdStr) => {
        const poIdNum = parseInt(poIdStr, 10);
        return purchaseOrders.find((po) => {
          const poDigits = po.name.replace(/\D/g, '');
          return poDigits === poIdStr ||
            parseInt(poDigits, 10) === poIdNum ||
            po.name.toLowerCase().includes(`p${poIdStr.toLowerCase()}`) ||
            po.name.toLowerCase().includes(`po${poIdStr.toLowerCase()}`);
        });
      })
      .filter((po): po is NonNullable<typeof po> => Boolean(po))
      .filter((po, index, all) => all.findIndex((candidate) => candidate.id === po.id) === index);

    if (exactPos.length === 0) continue;

    const withdrawalAmount = Number(tx.withdrawn || 0);
    const referencedPoTotal = exactPos.reduce((sum, po) => sum + Number(po.amount_total || 0), 0);
    const amountVariance = Math.round((withdrawalAmount - referencedPoTotal) * 100) / 100;
    const amountExplanation = withdrawalAmount > 0 && referencedPoTotal > 0
      ? ` Withdrawal KSh ${withdrawalAmount.toLocaleString('en-KE', { minimumFractionDigits: 2 })}; referenced PO total KSh ${referencedPoTotal.toLocaleString('en-KE', { minimumFractionDigits: 2 })}; variance KSh ${amountVariance.toLocaleString('en-KE', { minimumFractionDigits: 2 })} is informational for recipient withdrawals.`
      : '';

    // If already matched to THIS PO, skip
    if (exactPos.length === 1 && tx.matchedPoId === exactPos[0].id) continue;

    const candidates = exactPos.map((exactPo) => {
      const vendorName = Array.isArray(exactPo.partner_id) ? exactPo.partner_id[1] : null;
      return {
        id: exactPo.id,
        name: exactPo.name,
        vendorName,
        dateOrder: exactPo.date_order || null,
        amountTotal: exactPo.amount_total || null,
        score: 100,
        reasons: [`PO referenced in transaction notes: ${resolvedPoRefs.map((ref) => `PO ${ref}`).join(' and ')}.${amountExplanation}`],
      };
    });

    // A single transaction cannot safely be assigned to multiple POs. Keep all
    // referenced POs available for manual selection instead of guessing.
    if (exactPos.length > 1 && !tx.matchedPoId) {
      patches.push({
        id: tx.id,
        matchedPoId: null,
        matchedPoName: null,
        matchConfidence: null,
        candidates,
        reviewStatus: 'needs_followup',
        notes: tx.notes,
      });
      continue;
    }

    const exactPo = exactPos[0];

    // If already matched to a DIFFERENT PO, add a note but don't overwrite
    if (tx.matchedPoId) {
      const conflictNote = (tx.notes || '') + ` [NOTE: Notes suggest ${exactPos.map((po) => po.name).join(' and ')} but already matched to ${tx.matchedPoName || '#' + tx.matchedPoId}]`;
      patches.push({
        id: tx.id,
        notes: conflictNote.trim(),
      });
      continue;
    }

    patches.push({
      id: tx.id,
      matchedPoId: exactPo.id,
      matchedPoName: exactPo.name,
      matchConfidence: 100,
      candidates,
      reviewStatus: 'reviewed',
      notes: tx.notes,
    });
  }

  return patches;
}

/**
 * POST /mpesa-reconciliation/batches/:batchId/auto-match
 * Re-runs Odoo candidate matching on existing transactions WITHOUT re-extracting
 * the PDF — preserves original amounts, totals, and statement checks.
 */
router.post('/mpesa-reconciliation/batches/:batchId/auto-match', async (req, res) => {
  const batchId = req.params.batchId;

  try {
    const batch = await getMpesaStatementBatchById(batchId);
    const existingTransactions = await getMpesaTransactionsByBatchId(batchId);

    if (existingTransactions.length === 0) {
      res.redirect(
        `/mpesa-reconciliation?batch=${encodeURIComponent(batchId)}&error=${encodeURIComponent(
          'No transactions found in this batch.',
        )}`,
      );
      return;
    }

    const { settings, client } = await buildOptionalOdooClient();

    // Re-extract from the stored file to get fresh candidate matching,
    // but only update candidates/auto-matches — do NOT change amounts or details
    const storedFilePath = resolveStoredMpesaFile(batch.storedFilename);
    await fs.access(storedFilePath);

    const extraction = await extractMpesaStatement({
      filePath: storedFilePath,
      originalFilename: batch.originalFilename,
      aiConfig: settings.ai,
      odooClient: client,
      matchCandidates: true,
    });

    // Build a map of existing transactions keyed by receipt number + date for matching
    const existingByKey = new Map<string, typeof existingTransactions[0]>();
    for (const tx of existingTransactions) {
      const key = [
        (tx.receiptNumber || '').toUpperCase(),
        String(tx.transactionDate || '').slice(0, 10),
        tx.direction,
        (tx.amount || 0).toFixed(2),
      ].join('|');
      existingByKey.set(key, tx);
    }

    // Only update candidate-related fields; preserve all original data
    const patches: Array<{
      id: string;
      matchedPoId?: number | null;
      matchedPoName?: string | null;
      matchConfidence?: number | null;
      candidates?: MpesaTransaction['candidates'];
      reviewStatus?: MpesaTransaction['reviewStatus'];
      notes?: string | null;
    }> = [];

    for (const tx of extraction.transactions) {
      const key = [
        (tx.receiptNumber || '').toUpperCase(),
        String(tx.transactionDate || '').slice(0, 10),
        tx.direction,
        (tx.amount || 0).toFixed(2),
      ].join('|');
      const existing = existingByKey.get(key);
      if (!existing) continue;

      patches.push({
        id: existing.id,
        matchedPoId: tx.matchedPoId,
        matchedPoName: tx.matchedPoName,
        matchConfidence: tx.matchConfidence,
        candidates: tx.candidates || [],
        reviewStatus: tx.reviewStatus,
        notes: tx.notes || existing.notes,
      });
    }

    if (patches.length > 0) {
      await updateMpesaTransactions(batchId, patches);
    }

    // Second pass: match by PO reference found in existing transaction NOTES
    let notesMatched = 0;
    if (client) {
      const poRefPatches = await matchTransactionsByNotesPoRef(existingTransactions, client, batchId);
      if (poRefPatches.length > 0) {
        await updateMpesaTransactions(batchId, poRefPatches);
        notesMatched = poRefPatches.filter((p) => p.matchedPoId !== null).length;
      }
    }

    const extractionMatched = patches.filter((p) => p.matchedPoId !== null).length;
    const totalMatched = extractionMatched + notesMatched;

    res.redirect(
      `/mpesa-reconciliation?batch=${encodeURIComponent(batch.id)}&message=${encodeURIComponent(
        `Matched ${totalMatched} transaction(s) to POs/invoices (${extractionMatched} from extraction, ${notesMatched} from notes).`,
      )}`,
    );
  } catch (error) {
    res.redirect(
      `/mpesa-reconciliation?batch=${encodeURIComponent(batchId)}&error=${encodeURIComponent(
        error instanceof Error ? error.message : 'Auto-match failed.',
      )}`,
    );
  }
});

export default router;
