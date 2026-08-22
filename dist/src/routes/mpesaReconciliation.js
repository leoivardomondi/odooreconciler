"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const promises_1 = __importDefault(require("fs/promises"));
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const express_1 = require("express");
const repositories_1 = require("../models/repositories");
const mpesaReconciliationService_1 = require("../services/mpesaReconciliationService");
const aiCategoryService_1 = require("../services/aiCategoryService");
const odooClient_1 = require("../services/odooClient");
const payrollBridgeService_1 = require("../services/payrollBridgeService");
const helpers_1 = require("../utils/helpers");
const paths_1 = require("../utils/paths");
const mpesaPoReconcileService_1 = require("../services/mpesaPoReconcileService");
const mpesaExtractionJobService_1 = require("../services/mpesaExtractionJobService");
const router = (0, express_1.Router)();
const uploadRoot = (0, paths_1.resolveProjectFile)(process.env.UPLOAD_DIR || 'uploads', 'uploads');
const uploadDir = path_1.default.join(uploadRoot, 'mpesa');
const resolvedUploadDir = path_1.default.resolve(uploadDir);
const KNOWN_MPESA_PAYER_ALIASES = [
    {
        customerName: 'OKEVAM FURNITURE',
        payerNames: ['Kevin Okumayia Amalanda'],
    },
];
const MPESA_REVIEW_STATUSES = [
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
];
const MPESA_CATEGORY_SET = new Set(MPESA_CATEGORY_OPTIONS.map(([value]) => value));
async function ensurePrivateUploadDirectory() {
    await promises_1.default.mkdir(uploadDir, { recursive: true });
    await promises_1.default.writeFile(path_1.default.join(uploadDir, '.htaccess'), 'Require all denied\n', { flag: 'wx' }).catch((error) => {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') {
            return;
        }
        throw error;
    });
}
const storage = multer_1.default.diskStorage({
    destination: async (_req, _file, callback) => {
        try {
            await ensurePrivateUploadDirectory();
            callback(null, uploadDir);
        }
        catch (error) {
            callback(error instanceof Error ? error : new Error(String(error)), uploadDir);
        }
    },
    filename: (_req, file, callback) => {
        const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]+/g, '_');
        callback(null, `${Date.now()}-${safeName}`);
    },
});
const upload = (0, multer_1.default)({
    storage,
    limits: { fileSize: 25 * 1024 * 1024 },
    fileFilter: (_req, file, callback) => {
        const extension = path_1.default.extname(file.originalname).toLowerCase();
        const allowed = ['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.tif', '.tiff'];
        if (allowed.includes(extension)) {
            callback(null, true);
            return;
        }
        callback(new Error('Upload an M-Pesa statement PDF or image file.'));
    },
});
async function buildOptionalOdooClient() {
    const settings = await (0, repositories_1.getSettings)();
    if (!(0, helpers_1.hasOdooConfiguration)(settings)) {
        return { settings, client: null };
    }
    return {
        settings,
        client: new odooClient_1.OdooClient({
            baseUrl: (0, helpers_1.sanitizeBaseUrl)(settings.odoo.baseUrl),
            database: settings.odoo.database,
            username: settings.odoo.username,
            apiKey: settings.odoo.apiKey,
        }),
    };
}
async function buildPageModel(selectedBatchId) {
    let batches = await (0, repositories_1.getRecentMpesaStatementBatches)(12);
    let selectedBatch = selectedBatchId
        ? await (0, repositories_1.getMpesaStatementBatchById)(selectedBatchId)
        : batches[0] || null;
    let transactions = [];
    if (selectedBatch) {
        await (0, repositories_1.autoVerifyMpesaTransactionsByRule)(selectedBatch.id);
        selectedBatch = await (0, repositories_1.getMpesaStatementBatchById)(selectedBatch.id);
        batches = await (0, repositories_1.getRecentMpesaStatementBatches)(12);
        const storedTransactions = await (0, repositories_1.getMpesaTransactionsByBatchId)(selectedBatch.id);
        transactions = sanitizeKnownPayerInvoiceCandidates(storedTransactions);
        const repairPatches = buildKnownPayerRepairPatches(storedTransactions, transactions);
        if (repairPatches.length > 0) {
            selectedBatch = await (0, repositories_1.updateMpesaTransactions)(selectedBatch.id, repairPatches);
            batches = await (0, repositories_1.getRecentMpesaStatementBatches)(12);
            transactions = sanitizeKnownPayerInvoiceCandidates(await (0, repositories_1.getMpesaTransactionsByBatchId)(selectedBatch.id));
        }
    }
    const statementTotalChecks = selectedBatch
        ? buildStatementTotalChecks(selectedBatch.rawTextPreview, transactions)
        : [];
    return { batches, selectedBatch, transactions, statementTotalChecks };
}
function normalizeSearch(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}
function hasAllSearchTokens(value, phrase) {
    const valueTokens = new Set(normalizeSearch(value).split(' ').filter(Boolean));
    return normalizeSearch(phrase)
        .split(' ')
        .filter(Boolean)
        .every((token) => valueTokens.has(token));
}
function findKnownPayerAliasForTransaction(transaction) {
    const transactionText = `${transaction.counterparty || ''} ${transaction.userSupplier || ''} ${transaction.details}`;
    return KNOWN_MPESA_PAYER_ALIASES.find((alias) => alias.payerNames.some((payerName) => hasAllSearchTokens(transactionText, payerName)));
}
function knownPayerCandidateIsAllowed(candidate, alias) {
    return Boolean(candidate && hasAllSearchTokens(candidate.vendorName || '', alias.customerName));
}
function knownPayerSelectionIsAllowed(transaction, selection) {
    const alias = findKnownPayerAliasForTransaction(transaction);
    if (!alias || !selection.matchedPoId) {
        return true;
    }
    const candidate = transaction.candidates.find((entry) => entry.id === selection.matchedPoId);
    return knownPayerCandidateIsAllowed(candidate, alias);
}
function buildTrainingPayloadFromTransaction(transaction, patch) {
    const category = String(patch.userCategory || transaction.userCategory || '').trim();
    if (!category || !MPESA_CATEGORY_SET.has(category)) {
        return null;
    }
    return {
        category: category,
        details: transaction.details,
        counterparty: transaction.counterparty,
        direction: transaction.direction,
        paidIn: transaction.paidIn,
        withdrawn: transaction.withdrawn,
        phoneNumber: transaction.phoneNumber,
        rawDetails: typeof transaction.raw?.rawDetails === 'string' ? transaction.raw.rawDetails : undefined,
        notes: patch.notes ?? transaction.notes,
        source: 'manual',
    };
}
async function trainMpesaCategoryRulesFromPatches(transactions, patches) {
    const transactionById = new Map(transactions.map((transaction) => [transaction.id, transaction]));
    await Promise.all(patches
        .map((patch) => {
        const transaction = transactionById.get(patch.id);
        if (!transaction) {
            return null;
        }
        const payload = buildTrainingPayloadFromTransaction(transaction, patch);
        return payload ? (0, aiCategoryService_1.trainMpesaCategoryFromTransaction)(payload).catch(() => undefined) : null;
    })
        .filter((entry) => Boolean(entry)));
}
function findSelectedCandidate(transaction, selection) {
    return selection.matchedPoId
        ? transaction.candidates.find((candidate) => candidate.id === selection.matchedPoId) || null
        : null;
}
function normalizeInvoiceCandidateReasons(candidate, aliasReason) {
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
function candidatesChanged(left, right) {
    return JSON.stringify(left) !== JSON.stringify(right);
}
function buildKnownPayerRepairPatches(storedTransactions, sanitizedTransactions) {
    return sanitizedTransactions
        .map((sanitized, index) => {
        const stored = storedTransactions[index];
        if (!stored || !findKnownPayerAliasForTransaction(stored)) {
            return null;
        }
        const changed = stored.matchedPoId !== sanitized.matchedPoId ||
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
        .filter((patch) => Boolean(patch));
}
function sanitizeKnownPayerInvoiceCandidates(transactions) {
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
function asArray(value) {
    if (Array.isArray(value)) {
        return value.map((entry) => String(entry || ''));
    }
    if (value === undefined || value === null) {
        return [];
    }
    return [String(value)];
}
function firstString(value) {
    return asArray(value)[0] || '';
}
function parsePoSelection(value) {
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
function normalizeReviewStatus(value) {
    return MPESA_REVIEW_STATUSES.includes(value)
        ? value
        : 'new';
}
function readTransactionExplorerFilters(source) {
    const partyRole = firstString(source.partyRole);
    const reviewStatus = firstString(source.status);
    const month = firstString(source.month).trim();
    return {
        name: firstString(source.name).trim(),
        partyRole: partyRole === 'sender' || partyRole === 'receiver' ? partyRole : 'any',
        category: firstString(source.category).trim(),
        month: /^\d{4}-\d{2}$/.test(month) ? month : '',
        reviewStatus: MPESA_REVIEW_STATUSES.includes(reviewStatus)
            ? reviewStatus
            : '',
        statementId: firstString(source.statement).trim(),
    };
}
function transactionExplorerQueryString(filters, extra) {
    const params = new URLSearchParams();
    if (filters.name)
        params.set('name', filters.name);
    if (filters.partyRole !== 'any')
        params.set('partyRole', filters.partyRole);
    if (filters.category)
        params.set('category', filters.category);
    if (filters.month)
        params.set('month', filters.month);
    if (filters.reviewStatus)
        params.set('status', filters.reviewStatus);
    if (filters.statementId)
        params.set('statement', filters.statementId);
    if (extra?.message)
        params.set('message', extra.message);
    if (extra?.error)
        params.set('error', extra.error);
    const query = params.toString();
    return query ? `?${query}` : '';
}
function mpesaTransactionTotals(transactions) {
    return transactions.reduce((totals, transaction) => ({
        paidIn: roundMoney(totals.paidIn + Number(transaction.paidIn || 0)),
        withdrawn: roundMoney(totals.withdrawn + Number(transaction.withdrawn || 0)),
        net: roundMoney(totals.net + Number(transaction.paidIn || 0) - Number(transaction.withdrawn || 0)),
    }), { paidIn: 0, withdrawn: 0, net: 0 });
}
function requireAdmin(req, res) {
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
function roundMoney(value) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
}
function parseStatementMoney(value) {
    const parsed = Number(value.replace(/,/g, ''));
    return Number.isFinite(parsed) ? roundMoney(parsed) : null;
}
function extractMoneyValues(value) {
    return (value.match(/\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2}/g) || [])
        .map(parseStatementMoney)
        .filter((entry) => typeof entry === 'number');
}
function extractStatementSummaryTotals(rawTextPreview) {
    const preview = String(rawTextPreview || '');
    const normalized = preview.replace(/\r/g, '');
    const totalLine = preview
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => /^Total/i.test(line));
    const totalBlock = totalLine ||
        normalized.match(/Total[\s\S]{0,160}?(?=Receipt\s+No|Receipt No|Completion\s+Time|$)/i)?.[0] ||
        normalized.match(/Total\s*\d[\d,]*\.\d{2}\s*\d[\d,]*\.\d{2}/i)?.[0] ||
        '';
    const values = extractMoneyValues(totalBlock);
    return {
        paidIn: values[0] ?? null,
        withdrawn: values[1] ?? null,
    };
}
function buildStatementTotalChecks(rawTextPreview, transactions) {
    const expected = extractStatementSummaryTotals(rawTextPreview);
    const extracted = {
        paidIn: roundMoney(transactions.reduce((sum, transaction) => sum + Number(transaction.paidIn || 0), 0)),
        withdrawn: roundMoney(transactions.reduce((sum, transaction) => sum + Number(transaction.withdrawn || 0), 0)),
    };
    return [
        { key: 'paidIn', label: 'Paid in match status', expected: expected.paidIn, extracted: extracted.paidIn },
        { key: 'withdrawn', label: 'Withdrawn match status', expected: expected.withdrawn, extracted: extracted.withdrawn },
    ].map((check) => {
        const difference = check.expected === null ? null : roundMoney(check.extracted - check.expected);
        const status = check.expected === null
            ? 'missing_summary'
            : Math.abs(difference || 0) <= 0.01
                ? 'match'
                : 'mismatch';
        return {
            ...check,
            difference,
            status,
            diagnosis: status === 'missing_summary'
                ? `No statement summary table printed on this PDF. Total calculated from ${transactions.length} extracted rows: Paid In = KSh ${extracted.paidIn.toLocaleString('en-KE', { minimumFractionDigits: 2 })}, Withdrawn = KSh ${extracted.withdrawn.toLocaleString('en-KE', { minimumFractionDigits: 2 })}.`
                : status === 'match'
                    ? 'All extracted rows reconcile to the statement summary.'
                    : difference < 0
                        ? 'Extracted rows are lower than the statement. Review OCR for missing, split, or unreadable transactions.'
                        : 'Extracted rows are higher than the statement. Review duplicate or incorrectly classified transactions.',
        };
    });
}
function uploadSingleFile(fieldName) {
    return (req, res, next) => {
        upload.single(fieldName)(req, res, (err) => {
            if (err) {
                const batchIdParam = req.params.batchId ? `batch=${encodeURIComponent(req.params.batchId)}&` : '';
                const message = err instanceof multer_1.default.MulterError && err.code === 'LIMIT_FILE_SIZE'
                    ? 'The statement is too large. Maximum upload size is 25 MB.'
                    : err instanceof Error ? err.message : 'Upload an M-Pesa statement PDF or image file.';
                return res.redirect(`/mpesa-reconciliation?${batchIdParam}error=${encodeURIComponent(message)}`);
            }
            next();
        });
    };
}
function resolveStoredMpesaFile(storedFilename) {
    const resolved = path_1.default.resolve(uploadDir, storedFilename);
    if (resolved !== resolvedUploadDir && !resolved.startsWith(`${resolvedUploadDir}${path_1.default.sep}`)) {
        throw new Error('Stored M-Pesa document path is invalid.');
    }
    return resolved;
}
function contentTypeForStatementFile(filename) {
    const extension = path_1.default.extname(filename).toLowerCase();
    if (extension === '.pdf')
        return 'application/pdf';
    if (extension === '.png')
        return 'image/png';
    if (extension === '.jpg' || extension === '.jpeg')
        return 'image/jpeg';
    if (extension === '.webp')
        return 'image/webp';
    if (extension === '.tif' || extension === '.tiff')
        return 'image/tiff';
    return 'application/octet-stream';
}
function attachmentDisposition(filename) {
    const fallback = path_1.default.basename(filename).replace(/["\r\n]/g, '_') || 'mpesa-statement';
    return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(path_1.default.basename(filename))}`;
}
function dateOnly(value) {
    if (!value) {
        return null;
    }
    const match = String(value).match(/^(\d{4}-\d{1,2}-\d{1,2})/);
    return match ? match[1] : null;
}
function salaryAdvancePeriodDefaults(transactions) {
    const dates = transactions
        .map((transaction) => dateOnly(transaction.transactionDate))
        .filter((value) => Boolean(value))
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
async function deleteStoredMpesaFile(storedFilename) {
    if (!storedFilename) {
        return null;
    }
    try {
        await promises_1.default.unlink(resolveStoredMpesaFile(storedFilename));
        return null;
    }
    catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
            return null;
        }
        return error instanceof Error ? error.message : String(error);
    }
}
router.get('/mpesa-reconciliation', async (req, res) => {
    try {
        const model = await buildPageModel(typeof req.query.batch === 'string' ? req.query.batch : null);
        const salaryAdvanceRecords = (0, payrollBridgeService_1.buildPayrollAdvanceRecords)(model.transactions);
        const salaryAdvancePeriod = salaryAdvancePeriodDefaults(model.transactions);
        const monthlySalaryAdvanceTransactions = await (0, repositories_1.getReviewedSalaryAdvanceTransactionsByPeriod)({
            periodStart: salaryAdvancePeriod.periodStart,
            periodEnd: salaryAdvancePeriod.periodEnd,
        });
        const monthlySalaryAdvanceRecords = (0, payrollBridgeService_1.buildPayrollAdvanceRecords)(monthlySalaryAdvanceTransactions);
        res.render('mpesa-reconciliation', {
            pageTitle: 'M-Pesa Reconciliation',
            status: typeof req.query.message === 'string'
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
    }
    catch (error) {
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
    const batches = await (0, repositories_1.getMpesaStatementBatchesWithOpenReviewCounts)();
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
        const job = await (0, repositories_1.getMpesaExtractionJobById)(req.params.jobId);
        const batch = await (0, repositories_1.getMpesaStatementBatchById)(job.batchId);
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
    }
    catch (error) {
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
        const filters = readTransactionExplorerFilters(req.query);
        await (0, repositories_1.autoVerifyMpesaTransactionsByRule)();
        const [transactions, filterOptions] = await Promise.all([
            (0, repositories_1.getMpesaTransactionExplorerRows)(filters),
            (0, repositories_1.getMpesaTransactionExplorerOptions)(),
        ]);
        res.render('mpesa-transactions', {
            pageTitle: 'M-Pesa Transactions',
            status: typeof req.query.message === 'string'
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
    }
    catch (error) {
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
    const filters = readTransactionExplorerFilters(req.query);
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
        const touchedBatchCount = await (0, repositories_1.updateMpesaTransactionAdminReviewFields)(patches);
        const transactions = await (0, repositories_1.getMpesaTransactionsByIds)(patches.map((patch) => patch.id));
        await trainMpesaCategoryRulesFromPatches(transactions, patches);
        res.redirect(`/mpesa-reconciliation/transactions${transactionExplorerQueryString(filters, {
            message: `Saved ${patches.length} filtered transaction row(s) across ${touchedBatchCount} statement(s).`,
        })}`);
    }
    catch (error) {
        res.redirect(`/mpesa-reconciliation/transactions${transactionExplorerQueryString(filters, {
            error: error instanceof Error ? error.message : 'Could not save filtered M-Pesa transactions.',
        })}`);
    }
});
router.get('/mpesa-reconciliation/batches/:batchId/download', async (req, res) => {
    try {
        const batch = await (0, repositories_1.getMpesaStatementBatchById)(req.params.batchId);
        const storedFilePath = resolveStoredMpesaFile(batch.storedFilename);
        await promises_1.default.access(storedFilePath);
        const filename = batch.originalFilename || path_1.default.basename(batch.storedFilename);
        res.setHeader('Content-Type', contentTypeForStatementFile(filename || batch.storedFilename));
        res.setHeader('Content-Disposition', attachmentDisposition(filename));
        res.setHeader('Cache-Control', 'private, no-store');
        res.sendFile(storedFilePath);
    }
    catch (error) {
        res.status(404).type('text/plain').send(error instanceof Error ? error.message : 'M-Pesa document was not found.');
    }
});
router.post('/mpesa-reconciliation/upload', uploadSingleFile('file'), async (req, res) => {
    try {
        if (!req.file) {
            throw new Error('Upload an M-Pesa statement PDF or image file.');
        }
        const batch = await (0, repositories_1.createMpesaStatementBatch)({
            originalFilename: req.file.originalname,
            storedFilename: req.file.filename,
            status: 'processing',
            warnings: [],
            rawTextPreview: '',
            transactions: [],
        });
        const job = await (0, repositories_1.createMpesaExtractionJob)({
            batchId: batch.id,
            jobType: 'upload',
            originalFilename: req.file.originalname,
            storedFilename: req.file.filename,
        });
        (0, mpesaExtractionJobService_1.wakeMpesaExtractionJobWorker)();
        res.redirect(`/mpesa-reconciliation?batch=${encodeURIComponent(batch.id)}&job=${encodeURIComponent(job.id)}&message=${encodeURIComponent('M-Pesa statement uploaded. Extraction is running in the background.')}`);
    }
    catch (error) {
        if (req.file?.path) {
            await deleteStoredMpesaFile(req.file.filename).catch(() => undefined);
        }
        res.redirect(`/mpesa-reconciliation?error=${encodeURIComponent(error instanceof Error ? error.message : 'M-Pesa statement import failed.')}`);
    }
});
router.post('/mpesa-reconciliation/batches/:batchId/reprocess', async (req, res) => {
    const batchId = req.params.batchId;
    try {
        const batch = await (0, repositories_1.getMpesaStatementBatchById)(batchId);
        const storedFilePath = resolveStoredMpesaFile(batch.storedFilename);
        await promises_1.default.access(storedFilePath);
        await (0, repositories_1.markMpesaStatementBatchProcessing)(batch.id);
        const job = await (0, repositories_1.createMpesaExtractionJob)({
            batchId: batch.id,
            jobType: 'reprocess',
            originalFilename: batch.originalFilename,
            storedFilename: batch.storedFilename,
        });
        (0, mpesaExtractionJobService_1.wakeMpesaExtractionJobWorker)();
        res.redirect(`/mpesa-reconciliation?batch=${encodeURIComponent(batch.id)}&job=${encodeURIComponent(job.id)}&message=${encodeURIComponent('Extraction retry started in the background.')}`);
    }
    catch (error) {
        res.redirect(`/mpesa-reconciliation?batch=${encodeURIComponent(batchId)}&error=${encodeURIComponent(error instanceof Error ? error.message : 'Could not retry extraction for this M-Pesa document.')}`);
    }
});
router.post('/mpesa-reconciliation/batches/:batchId/reupload', uploadSingleFile('file'), async (req, res) => {
    const batchId = req.params.batchId;
    try {
        if (req.authUser?.role !== 'admin') {
            throw new Error('Only admins can reupload M-Pesa statements.');
        }
        if (!req.file) {
            throw new Error('Upload a replacement M-Pesa statement PDF or image file.');
        }
        const batch = await (0, repositories_1.getMpesaStatementBatchById)(batchId);
        await (0, repositories_1.markMpesaStatementBatchProcessing)(batch.id);
        const job = await (0, repositories_1.createMpesaExtractionJob)({
            batchId: batch.id,
            jobType: 'reupload',
            originalFilename: req.file.originalname,
            storedFilename: req.file.filename,
            previousStoredFilename: batch.storedFilename,
        });
        (0, mpesaExtractionJobService_1.wakeMpesaExtractionJobWorker)();
        res.redirect(`/mpesa-reconciliation?batch=${encodeURIComponent(batch.id)}&job=${encodeURIComponent(job.id)}&message=${encodeURIComponent('Replacement statement uploaded. Extraction is running in the background.')}`);
    }
    catch (error) {
        if (req.file) {
            await deleteStoredMpesaFile(req.file.filename).catch(() => undefined);
        }
        res.redirect(`/mpesa-reconciliation?batch=${encodeURIComponent(batchId)}&error=${encodeURIComponent(error instanceof Error ? error.message : 'Could not reupload this M-Pesa document.')}`);
    }
});
router.post('/mpesa-reconciliation/batches/:batchId/delete', async (req, res) => {
    try {
        const batch = await (0, repositories_1.deleteMpesaStatementBatch)(req.params.batchId);
        const fileDeleteError = await deleteStoredMpesaFile(batch.storedFilename);
        const message = fileDeleteError
            ? `Deleted ${batch.originalFilename}, but the uploaded file could not be removed: ${fileDeleteError}`
            : `Deleted ${batch.originalFilename}.`;
        res.redirect(`/mpesa-reconciliation?message=${encodeURIComponent(message)}`);
    }
    catch (error) {
        res.redirect(`/mpesa-reconciliation?batch=${encodeURIComponent(req.params.batchId)}&error=${encodeURIComponent(error instanceof Error ? error.message : 'Could not delete the M-Pesa document.')}`);
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
        const transactions = await (0, repositories_1.getReviewedSalaryAdvanceTransactionsByPeriod)({
            periodStart,
            periodEnd,
        });
        const settings = await (0, repositories_1.getSettings)();
        const statementCount = new Set(transactions.map((transaction) => transaction.batchId)).size;
        const result = await (0, payrollBridgeService_1.sharePayrollAdvances)({
            periodStart,
            periodEnd,
            transactions,
            bridge: settings.payrollBridge,
        });
        let payrollMessage = '';
        if (settings.payrollBridge.autoCreatePayRun) {
            const payRunName = (0, payrollBridgeService_1.buildPayrollPayRunName)(periodStart, periodEnd, settings.payrollBridge.payRunNameTemplate);
            if (!(0, helpers_1.hasOdooConfiguration)(settings)) {
                throw new Error('Odoo is not configured in the reconciler app settings.');
            }
            const payRunResult = await (0, payrollBridgeService_1.createPayrollPayRun)({
                periodStart,
                periodEnd,
                payRunName,
                bridge: settings.payrollBridge,
                odooCredentials: {
                    baseUrl: (0, helpers_1.sanitizeBaseUrl)(settings.odoo.baseUrl),
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
        res.redirect(`/mpesa-reconciliation?batch=${encodeURIComponent(batchId)}&message=${encodeURIComponent(`Shared ${result.received} salary advance row(s) from ${statementCount} statement(s) for ${periodStart} to ${periodEnd}.${payrollMessage}`)}`);
    }
    catch (error) {
        res.redirect(`/mpesa-reconciliation?batch=${encodeURIComponent(batchId)}&error=${encodeURIComponent(error instanceof Error ? error.message : 'Could not share salary advances with payroll.')}`);
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
        const existingTransactions = await (0, repositories_1.getMpesaTransactionsByBatchId)(batchId);
        const transactionById = new Map(existingTransactions.map((transaction) => [transaction.id, transaction]));
        const patches = ids.map((id, index) => {
            const transaction = transactionById.get(id);
            let selectedPo = parsePoSelection(poSelections[index] || '');
            let reviewStatus = normalizeReviewStatus(statuses[index] || 'new');
            let matchConfidence = transaction
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
        await (0, repositories_1.updateMpesaTransactions)(batchId, patches);
        await trainMpesaCategoryRulesFromPatches(existingTransactions, patches);
        res.redirect(`/mpesa-reconciliation?batch=${encodeURIComponent(batchId)}&message=${encodeURIComponent('M-Pesa invoice and PO matches updated.')}`);
    }
    catch (error) {
        res.redirect(`/mpesa-reconciliation?batch=${encodeURIComponent(batchId)}&error=${encodeURIComponent(error instanceof Error ? error.message : 'Could not save M-Pesa reconciliation rows.')}`);
    }
});
router.post('/mpesa-reconciliation/batches/:batchId/reconcile-pos', async (req, res) => {
    const batchId = req.params.batchId;
    try {
        if (req.authUser?.role !== 'admin') {
            throw new Error('Only admins can reconcile M-Pesa transactions with Purchase Orders.');
        }
        const transactionIds = asArray(req.body.transactionId).filter(Boolean);
        const result = await (0, mpesaPoReconcileService_1.processMpesaPoReconciliation)(batchId, transactionIds.length > 0 ? transactionIds : undefined);
        const messageParts = [];
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
        res.redirect(`/mpesa-reconciliation?batch=${encodeURIComponent(batchId)}&${hasErrors ? 'error' : 'message'}=${encodeURIComponent(message)}`);
    }
    catch (error) {
        res.redirect(`/mpesa-reconciliation?batch=${encodeURIComponent(batchId)}&error=${encodeURIComponent(error instanceof Error ? error.message : 'Could not reconcile M-Pesa transactions with POs.')}`);
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
        const result = await (0, mpesaPoReconcileService_1.processMpesaPoReconciliationByMonth)(fromMonth);
        const messageParts = [];
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
        res.redirect(`/mpesa-reconciliation?${hasErrors ? 'error' : 'message'}=${encodeURIComponent(message)}`);
    }
    catch (error) {
        res.redirect(`/mpesa-reconciliation?error=${encodeURIComponent(error instanceof Error ? error.message : 'Could not reconcile all M-Pesa transactions.')}`);
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
        const transactionIds = Array.isArray(req.body.transactionIds)
            ? req.body.transactionIds.filter((id) => typeof id === 'string')
            : [];
        // If neither batchId nor transactionIds, try to use the current batch from query
        let transactions = [];
        if (batchId) {
            transactions = await (0, repositories_1.getMpesaTransactionsByBatchId)(batchId);
        }
        else if (transactionIds.length > 0) {
            // Fetch individual transactions from all batches
            const allBatches = await (0, repositories_1.getRecentMpesaStatementBatches)(50);
            for (const batch of allBatches) {
                const batchTxs = await (0, repositories_1.getMpesaTransactionsByBatchId)(batch.id);
                for (const tx of batchTxs) {
                    if (transactionIds.includes(tx.id)) {
                        transactions.push(tx);
                    }
                }
            }
        }
        else {
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
        const targetTransactions = transactions.filter((tx) => tx.direction === 'out' &&
            (tx.withdrawn && tx.withdrawn > 0) &&
            tx.transactionType !== 'mpesa_charge');
        if (targetTransactions.length === 0) {
            return res.json({
                ok: true,
                message: 'No eligible transactions to categorize (only outgoing non-charge payments).',
                categorized: 0,
                results: [],
            });
        }
        // Run AI categorization
        const results = await (0, aiCategoryService_1.categorizeBatchWithAi)(targetTransactions.map((tx) => ({
            id: tx.id,
            details: tx.details,
            counterparty: tx.counterparty,
            direction: tx.direction,
            paidIn: tx.paidIn,
            withdrawn: tx.withdrawn,
            phoneNumber: tx.phoneNumber,
            notes: tx.notes,
            rawDetails: typeof tx.raw?.rawDetails === 'string' ? tx.raw.rawDetails : undefined,
        })));
        // Update user_category on each transaction
        const patches = [];
        for (const result of results) {
            const tx = transactions.find((t) => t.id === result.id);
            if (!tx)
                continue;
            const note = result.method === 'ai'
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
            updatedCount = await (0, repositories_1.updateMpesaTransactionAdminReviewFields)(patches);
        }
        // Build summary
        const transportResults = results.filter((r) => r.category === 'transport_expense' || r.category === 'staff_transport_expense');
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
                categories: results.reduce((acc, r) => {
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
    }
    catch (error) {
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
    const rules = (0, aiCategoryService_1.getTransportKeywordRules)();
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
    const analysis = (0, aiCategoryService_1.analyzeTransportKeywords)({
        details,
        counterparty: typeof req.body.counterparty === 'string' ? req.body.counterparty : null,
        rawDetails: typeof req.body.rawDetails === 'string' ? req.body.rawDetails : undefined,
        direction: typeof req.body.direction === 'string' ? req.body.direction : 'out',
    });
    const indicators = (0, aiCategoryService_1.extractTransportIndicators)({
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
async function matchTransactionsByNotesPoRef(transactions, odooClient, batchId) {
    const patches = [];
    const purchaseOrders = await odooClient.searchPurchaseOrders({ limit: 500 });
    for (const tx of transactions) {
        const searchText = [
            tx.notes || '',
            tx.details || '',
            tx.counterparty || '',
        ].join(' ');
        const poRefMatch = searchText.match(/\b(?:PO[:\s#-]*)?(\d{2,7})\b/i);
        if (!poRefMatch)
            continue;
        const poIdStr = poRefMatch[1];
        const poIdNum = parseInt(poIdStr, 10);
        const exactPo = purchaseOrders.find((po) => {
            const poDigits = po.name.replace(/\D/g, '');
            return poDigits === poIdStr ||
                parseInt(poDigits, 10) === poIdNum ||
                po.name.toLowerCase().includes(`p${poIdStr.toLowerCase()}`) ||
                po.name.toLowerCase().includes(`po${poIdStr.toLowerCase()}`);
        });
        if (!exactPo)
            continue;
        // If already matched to THIS PO, skip
        if (tx.matchedPoId === exactPo.id)
            continue;
        const vendorName = Array.isArray(exactPo.partner_id) ? exactPo.partner_id[1] : null;
        const reason = `PO referenced in transaction notes: "${poRefMatch[0].trim()}" → ${exactPo.name}.`;
        // If already matched to a DIFFERENT PO, add a note but don't overwrite
        if (tx.matchedPoId) {
            const conflictNote = (tx.notes || '') + ` [NOTE: Notes suggest ${exactPo.name} but already matched to ${tx.matchedPoName || '#' + tx.matchedPoId}]`;
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
            candidates: [{
                    id: exactPo.id,
                    name: exactPo.name,
                    vendorName,
                    dateOrder: exactPo.date_order || null,
                    amountTotal: exactPo.amount_total || null,
                    score: 100,
                    reasons: [reason],
                }],
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
        const batch = await (0, repositories_1.getMpesaStatementBatchById)(batchId);
        const existingTransactions = await (0, repositories_1.getMpesaTransactionsByBatchId)(batchId);
        if (existingTransactions.length === 0) {
            res.redirect(`/mpesa-reconciliation?batch=${encodeURIComponent(batchId)}&error=${encodeURIComponent('No transactions found in this batch.')}`);
            return;
        }
        const { settings, client } = await buildOptionalOdooClient();
        // Re-extract from the stored file to get fresh candidate matching,
        // but only update candidates/auto-matches — do NOT change amounts or details
        const storedFilePath = resolveStoredMpesaFile(batch.storedFilename);
        await promises_1.default.access(storedFilePath);
        const extraction = await (0, mpesaReconciliationService_1.extractMpesaStatement)({
            filePath: storedFilePath,
            originalFilename: batch.originalFilename,
            aiConfig: settings.ai,
            odooClient: client,
        });
        // Build a map of existing transactions keyed by receipt number + date for matching
        const existingByKey = new Map();
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
        const patches = [];
        for (const tx of extraction.transactions) {
            const key = [
                (tx.receiptNumber || '').toUpperCase(),
                String(tx.transactionDate || '').slice(0, 10),
                tx.direction,
                (tx.amount || 0).toFixed(2),
            ].join('|');
            const existing = existingByKey.get(key);
            if (!existing)
                continue;
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
            await (0, repositories_1.updateMpesaTransactions)(batchId, patches);
        }
        // Second pass: match by PO reference found in existing transaction NOTES
        let notesMatched = 0;
        if (client) {
            const poRefPatches = await matchTransactionsByNotesPoRef(existingTransactions, client, batchId);
            if (poRefPatches.length > 0) {
                await (0, repositories_1.updateMpesaTransactions)(batchId, poRefPatches);
                notesMatched = poRefPatches.filter((p) => p.matchedPoId !== null).length;
            }
        }
        const extractionMatched = patches.filter((p) => p.matchedPoId !== null).length;
        const totalMatched = extractionMatched + notesMatched;
        res.redirect(`/mpesa-reconciliation?batch=${encodeURIComponent(batch.id)}&message=${encodeURIComponent(`Matched ${totalMatched} transaction(s) to POs/invoices (${extractionMatched} from extraction, ${notesMatched} from notes).`)}`);
    }
    catch (error) {
        res.redirect(`/mpesa-reconciliation?batch=${encodeURIComponent(batchId)}&error=${encodeURIComponent(error instanceof Error ? error.message : 'Auto-match failed.')}`);
    }
});
exports.default = router;
