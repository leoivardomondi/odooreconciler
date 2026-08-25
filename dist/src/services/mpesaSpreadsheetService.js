"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractMpesaSpreadsheet = extractMpesaSpreadsheet;
const promises_1 = require("fs/promises");
const xlsx_1 = __importDefault(require("xlsx"));
function normalizeHeader(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '');
}
function text(value) {
    return String(value ?? '').trim();
}
function amount(value) {
    if (typeof value === 'number' && Number.isFinite(value))
        return Math.round(value * 100) / 100;
    const parsed = Number(text(value).replace(/(?:kes|ksh)/gi, '').replace(/,/g, '').replace(/\s+/g, ''));
    return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}
function dateTime(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        const pad = (part) => String(part).padStart(2, '0');
        return {
            date: `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`,
            time: `${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`,
        };
    }
    const raw = text(value);
    const match = raw.match(/(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{4})[^\d]*(\d{1,2}:\d{2}(?::\d{2})?)?/);
    if (!match)
        return { date: null, time: null };
    const parts = match[1].split(/[/-]/).map(Number);
    const year = parts[0] > 1000 ? parts[0] : parts[2];
    const month = parts[0] > 1000 ? parts[1] : parts[1];
    const day = parts[0] > 1000 ? parts[2] : parts[0];
    return {
        date: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
        time: match[2] || null,
    };
}
function inferredTransactionType(transactionTypeText, paidIn, withdrawn) {
    const normalized = transactionTypeText.toLowerCase();
    if (withdrawn > 0 && /charge|fee/.test(normalized))
        return 'mpesa_charge';
    if (paidIn > 0)
        return 'customer_receipt';
    if (withdrawn > 0)
        return 'outgoing_payment';
    return 'unknown';
}
async function extractMpesaSpreadsheet(input) {
    const workbook = xlsx_1.default.read(await (0, promises_1.readFile)(input.filePath), { type: 'buffer', cellDates: true });
    const transactions = [];
    const warnings = [];
    workbook.SheetNames.forEach((sheetName) => {
        const rows = xlsx_1.default.utils.sheet_to_json(workbook.Sheets[sheetName], {
            header: 1,
            raw: true,
            defval: '',
        });
        const headerIndex = rows.findIndex((row) => {
            const headers = row.map(normalizeHeader);
            return headers.includes('receiptno') && headers.includes('completiontime') &&
                (headers.includes('paidin') || headers.includes('withdrawn'));
        });
        if (headerIndex < 0)
            return;
        const headers = rows[headerIndex].map(normalizeHeader);
        const column = (...names) => names.map((name) => headers.indexOf(name)).find((index) => index >= 0) ?? -1;
        const columns = {
            receipt: column('receiptno', 'receiptnumber', 'receipt'),
            completion: column('completiontime', 'completiondate', 'date'),
            details: column('details', 'description'),
            status: column('transactionstatus', 'status'),
            paidIn: column('paidin'),
            withdrawn: column('withdrawn', 'paidout'),
            balance: column('balance'),
            transactionType: column('transactiontype', 'type'),
            otherParty: column('otherparty', 'otherpart', 'counterparty'),
        };
        rows.slice(headerIndex + 1).forEach((row) => {
            const receiptNumber = text(row[columns.receipt]);
            const completion = dateTime(row[columns.completion]);
            const paidInValue = Math.abs(amount(row[columns.paidIn]));
            const withdrawnValue = Math.abs(amount(row[columns.withdrawn]));
            if (!receiptNumber && !completion.date && !completion.time)
                return;
            if (paidInValue <= 0 && withdrawnValue <= 0)
                return;
            // The source columns are mutually exclusive. Keep only the populated
            // side so a spreadsheet zero/blank cannot be counted twice.
            const paidIn = paidInValue > 0 && withdrawnValue <= 0 ? paidInValue : null;
            const withdrawn = withdrawnValue > 0 && paidInValue <= 0 ? withdrawnValue : null;
            if (paidIn === null && withdrawn === null) {
                warnings.push(`Skipped spreadsheet row with both Paid In and Withdrawn populated${receiptNumber ? ` (${receiptNumber})` : ''}.`);
                return;
            }
            const transactionTypeText = text(row[columns.transactionType]);
            const direction = paidIn !== null ? 'in' : 'out';
            const details = text(row[columns.details]) || transactionTypeText || text(row[columns.status]);
            transactions.push({
                rowIndex: transactions.length + 1,
                transactionDate: completion.date,
                completionTime: completion.time,
                receiptNumber: receiptNumber || null,
                details,
                paidIn,
                withdrawn,
                balance: columns.balance >= 0 ? amount(row[columns.balance]) : null,
                amount: paidIn ?? withdrawn,
                direction,
                counterparty: text(row[columns.otherParty]) || null,
                phoneNumber: null,
                transactionType: inferredTransactionType(transactionTypeText, paidIn || 0, withdrawn || 0),
                matchedPoId: null,
                matchedPoName: null,
                matchConfidence: null,
                userCategory: null,
                userSupplier: text(row[columns.otherParty]) || null,
                reviewStatus: 'new',
                notes: transactionTypeText || null,
                aiNotes: null,
                candidates: [],
                raw: { row: JSON.stringify(row), spreadsheetTransactionType: transactionTypeText },
            });
        });
    });
    if (transactions.length === 0) {
        throw new Error('No M-Pesa transaction table was found in the Excel file. Required columns include Receipt No, Completion Time, Paid In, or Withdrawn.');
    }
    return {
        transactions,
        warnings: [...new Set([`Excel statement imported ${transactions.length} transaction row(s); Transaction Type was copied into Notes.`, ...warnings])],
        rawTextPreview: transactions.slice(0, 40).map((transaction) => transaction.raw.row).join('\n').slice(0, 6000),
        pageCount: workbook.SheetNames.length,
    };
}
