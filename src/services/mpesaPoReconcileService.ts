import { CustomerInvoiceSummary, MpesaTransaction, PurchaseOrderSummary } from '../models/types';
import {
  getLatestPoBillProcessedDocumentsByPurchaseOrderIds,
  getMatchedIncomingTransactionsSince,
  getMatchedOutgoingTransactionsSince,
  getMpesaTransactionsByBatchId,
  getSettings,
  updateMpesaTransactionAdminReviewFields,
} from '../models/repositories';
import { OdooClient } from './odooClient';
import { hasOdooConfiguration, sanitizeBaseUrl } from '../utils/helpers';

interface VendorBillSummary {
  id: number;
  name?: string | null;
  ref?: string | null;
  state?: string | null;
  invoice_date?: string | null;
  invoice_origin?: string | null;
  amount_total?: number | null;
  amount_residual?: number | null;
  payment_state?: string | null;
}

interface MpesaPoReconcileResult {
  processed: number;
  approved: string[];
  billsCreated: string[];
  paymentsRegistered: string[];
  skipped: string[];
  errors: string[];
}

/** PIN note logged on the PO by PO Bill Automation: ETR = valid tax PIN, NO PIN = no valid PIN */
type PinNote = 'ETR' | 'NO PIN';

/** Find a journal by name or code */
async function findJournalByNameOrCode(
  client: OdooClient,
  ...searchTerms: string[]
): Promise<{ id: number; name: string; code: string } | null> {
  for (const term of searchTerms) {
    const journals = await client.searchReadRecords<{ id: number; name: string; code: string }>(
      'account.journal',
      {
        domain: ['|', ['name', '=', term], ['code', '=', term]],
        fields: ['id', 'name', 'code'],
        limit: 1,
      },
    );
    if (journals[0]) return journals[0];
  }
  return null;
}

/**
 * Read the PO's recent chatter messages to detect ETR or NO PIN status
 * (logged by PO Bill Automation as a single-line note like "ETR" or "NO PIN").
 */
async function detectPoPinNote(
  client: OdooClient,
  purchaseOrderId: number,
): Promise<PinNote | null> {
  try {
    const messages = await client.searchReadRecords<{ id: number; body?: string | null }>(
      'mail.message',
      {
        domain: [
          ['model', '=', 'purchase.order'],
          ['res_id', '=', purchaseOrderId],
        ],
        fields: ['id', 'body'],
        limit: 50,
        order: 'id desc',
      },
    );

    for (const message of messages) {
      const body = (message.body || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      // PO Bill Automation logs the pin note as a standalone message: "ETR" or "NO PIN"
      if (body === 'ETR') return 'ETR';
      if (body === 'NO PIN') return 'NO PIN';
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Resolve the payment journal based on the PO's ETR/NO PIN status:
 * - NO PIN → "MPESA" journal (NOT "MPESA SEND MONEY")
 * - ETR    → journal code "001215001007459"
 * - unknown → fall back to wizard default
 */
async function resolvePaymentJournal(
  client: OdooClient,
  purchaseOrderId: number,
  wizardDefaultJournalId: unknown,
): Promise<{ journalId: number | undefined; journalLabel: string }> {
  const pinNote = await detectPoPinNote(client, purchaseOrderId);

  if (pinNote === 'NO PIN') {
    const mpesaJournal = await findJournalByNameOrCode(client, 'MPESA');
    if (mpesaJournal) {
      return { journalId: mpesaJournal.id, journalLabel: `MPESA (${mpesaJournal.code})` };
    }
    // Fallback — try to match wizard default if it's the MPESA journal
    if (typeof wizardDefaultJournalId === 'number') {
      return { journalId: wizardDefaultJournalId, journalLabel: 'wizard default (NO PIN fallback)' };
    }
    return { journalId: undefined, journalLabel: 'MPESA journal not found' };
  }

  if (pinNote === 'ETR') {
    const etrJournal = await findJournalByNameOrCode(client, '001215001007459');
    if (etrJournal) {
      return { journalId: etrJournal.id, journalLabel: `001215001007459 (${etrJournal.name})` };
    }
    return { journalId: undefined, journalLabel: 'ETR journal 001215001007459 not found' };
  }

  // Unknown — use wizard default
  return {
    journalId: typeof wizardDefaultJournalId === 'number' ? wizardDefaultJournalId : undefined,
    journalLabel: 'wizard default (pin note unknown)',
  };
}

async function findPoSchedulerVendorBill(
  client: OdooClient,
  purchaseOrderId: number,
): Promise<{ bill: VendorBillSummary | null; reason: string }> {
  const processedByPoId = await getLatestPoBillProcessedDocumentsByPurchaseOrderIds([purchaseOrderId]);
  const processed = processedByPoId[purchaseOrderId] || null;

  if (!processed) {
    return {
      bill: null,
      reason: 'No PO Scheduler vendor bill marker exists yet.',
    };
  }

  if (!['processed', 'processed_with_warnings'].includes(processed.status)) {
    return {
      bill: null,
      reason: `Latest PO Scheduler marker is "${processed.status}", not processed.`,
    };
  }

  if (!processed.vendorBillId) {
    return {
      bill: null,
      reason: 'PO Scheduler marker does not include a vendor bill ID.',
    };
  }

  const bills = await client.readRecords<VendorBillSummary>('account.move', [processed.vendorBillId], [
    'id',
    'name',
    'ref',
    'state',
    'invoice_date',
    'invoice_origin',
    'amount_total',
    'amount_residual',
    'payment_state',
  ]).catch(() => []);
  const bill = bills.find((entry) => entry.id === processed.vendorBillId) || null;

  if (!bill) {
    return {
      bill: null,
      reason: `PO Scheduler marker references vendor bill ${processed.vendorBillId}, but it was not found in Odoo.`,
    };
  }

  return {
    bill,
    reason: `PO Scheduler created vendor bill ${bill.name || bill.id}.`,
  };
}

/** Approve a PO if it's in "to approve" state */
async function approvePoIfNeeded(
  client: OdooClient,
  purchaseOrder: PurchaseOrderSummary,
): Promise<{ approved: boolean; purchaseOrder: PurchaseOrderSummary }> {
  if (purchaseOrder.state !== 'to approve') {
    return { approved: false, purchaseOrder };
  }

  await client.callRecordMethod<unknown>('purchase.order', 'button_approve', [purchaseOrder.id]);

  const refreshed = await client.readRecords<PurchaseOrderSummary>('purchase.order', [purchaseOrder.id], [
    'id', 'name', 'state', 'date_order', 'amount_total', 'amount_untaxed',
    'partner_id', 'currency_id', 'invoice_status', 'user_id', 'picking_ids',
  ]);

  return {
    approved: true,
    purchaseOrder: refreshed[0] || purchaseOrder,
  };
}

/** Register payment on a vendor bill */
async function registerPaymentOnBill(
  client: OdooClient,
  billId: number,
  transaction: MpesaTransaction,
  purchaseOrderId: number,
): Promise<{ success: boolean; message: string }> {
  const paymentAmount = transaction.amount || transaction.withdrawn || 0;
  const paymentDate = transaction.transactionDate || new Date().toISOString().slice(0, 10);
  const ref = transaction.receiptNumber || `MPesa-${transaction.id.slice(0, 8)}`;

  try {
    // Get wizard defaults for fallback values
    const wizardContext = await client.callRecordMethod<{
      res_id?: number;
      context?: Record<string, unknown>;
    } | false>(
      'account.move',
      'action_register_payment',
      [billId],
    );

    const wizardDefaultJournalId = wizardContext && typeof wizardContext === 'object' && wizardContext.context
      ? wizardContext.context.default_journal_id
      : undefined;

    // Resolve journal based on PO's ETR / NO PIN status
    const { journalId, journalLabel } = await resolvePaymentJournal(
      client,
      purchaseOrderId,
      wizardDefaultJournalId,
    );

    const paymentValues: Record<string, unknown> = {
      payment_type: 'outbound',
      partner_type: 'supplier',
      amount: paymentAmount,
      date: paymentDate,
      ref: ref,
      journal_id: journalId,
      payment_method_line_id: wizardContext && typeof wizardContext === 'object' && wizardContext.context
        ? wizardContext.context.default_payment_method_line_id
        : undefined,
    };

    const paymentId = await client.createRecord('account.payment', paymentValues);

    // Post the payment
    await client.callRecordMethod<unknown>('account.payment', 'action_post', [paymentId]);

    return {
      success: true,
      message: `Payment ${paymentId} registered for ${paymentAmount} on ${paymentDate} via journal ${journalLabel}.`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Fallback: try to post a message on the bill instead
    try {
      await client.postModelChatterMessage('account.move', billId,
        `<p><strong>MPesa Payment Recorded (Manual Follow-up)</strong></p>` +
        `<p>Receipt: ${ref}</p>` +
        `<p>Amount: ${paymentAmount}</p>` +
        `<p>Date: ${paymentDate}</p>` +
        `<p>Note: Automatic payment registration failed: ${message}. Please register payment manually in Odoo.</p>`,
      );
    } catch {
      // ignore chatter fallback failures
    }

    return { success: false, message };
  }
}

/** Register a customer payment on a customer invoice (for incoming M-Pesa receipts) */
async function registerCustomerPayment(
  client: OdooClient,
  invoiceId: number,
  transaction: MpesaTransaction,
): Promise<{ success: boolean; message: string }> {
  const paymentAmount = transaction.amount || transaction.paidIn || 0;
  const paymentDate = transaction.transactionDate || new Date().toISOString().slice(0, 10);
  const ref = transaction.receiptNumber || `MPesa-${transaction.id.slice(0, 8)}`;

  try {
    // Get wizard defaults for fallback values
    const wizardContext = await client.callRecordMethod<{
      res_id?: number;
      context?: Record<string, unknown>;
    } | false>(
      'account.move',
      'action_register_payment',
      [invoiceId],
    );

    const wizardDefaultJournalId = wizardContext && typeof wizardContext === 'object' && wizardContext.context
      ? wizardContext.context.default_journal_id
      : undefined;

    // For customer receipts, use the MPESA journal (inbound)
    const mpesaJournal = await findJournalByNameOrCode(client, 'MPESA');
    const journalId = mpesaJournal?.id ?? (typeof wizardDefaultJournalId === 'number' ? wizardDefaultJournalId : undefined);

    const paymentValues: Record<string, unknown> = {
      payment_type: 'inbound',
      partner_type: 'customer',
      amount: paymentAmount,
      date: paymentDate,
      ref: ref,
      journal_id: journalId,
      payment_method_line_id: wizardContext && typeof wizardContext === 'object' && wizardContext.context
        ? wizardContext.context.default_payment_method_line_id
        : undefined,
    };

    const paymentId = await client.createRecord('account.payment', paymentValues);
    await client.callRecordMethod<unknown>('account.payment', 'action_post', [paymentId]);

    return {
      success: true,
      message: `Customer payment ${paymentId} registered for ${paymentAmount} on ${paymentDate}.`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Fallback chatter note
    try {
      await client.postModelChatterMessage('account.move', invoiceId,
        `<p><strong>MPesa Customer Payment Recorded (Manual Follow-up)</strong></p>` +
        `<p>Receipt: ${ref}</p>` +
        `<p>Amount: ${paymentAmount}</p>` +
        `<p>Date: ${paymentDate}</p>` +
        `<p>Note: Automatic payment registration failed: ${message}. Please register payment manually in Odoo.</p>`,
      );
    } catch {
      // ignore
    }

    return { success: false, message };
  }
}

/** Build an Odoo client from settings */
async function buildOdooClient(): Promise<OdooClient | null> {
  const settings = await getSettings();
  if (!hasOdooConfiguration(settings)) {
    return null;
  }

  return new OdooClient({
    baseUrl: sanitizeBaseUrl(settings.odoo.baseUrl),
    database: settings.odoo.database,
    username: settings.odoo.username,
    apiKey: settings.odoo.apiKey,
  });
}

/**
 * Process outgoing M-Pesa transactions that have been matched with POs:
 * 1. Approve the PO if not yet approved
 * 2. Find the vendor bill created by PO Bill Scheduler
 * 3. Register payment on that bill
 * 4. Mark unresolved rows for follow-up instead of creating bills from payment data
 */
export async function processMpesaPoReconciliation(
  batchId: string,
  transactionIds?: string[],
): Promise<MpesaPoReconcileResult> {
  const result: MpesaPoReconcileResult = {
    processed: 0,
    approved: [],
    billsCreated: [],
    paymentsRegistered: [],
    skipped: [],
    errors: [],
  };

  const client = await buildOdooClient();
  if (!client) {
    result.errors.push('Odoo is not configured. Cannot reconcile M-Pesa transactions with POs.');
    return result;
  }

  // Get all transactions in the batch
  const transactions = await getMpesaTransactionsByBatchId(batchId);

  // Filter to only those with matched POs, direction=out, not yet verified
  const matchedTransactions = transactions.filter((t) => {
    // Only process if a PO is matched
    if (!t.matchedPoId) return false;
    // Must be an outgoing payment
    if (t.direction !== 'out') return false;
    // Skip already-reconciled (verified) transactions
    if (t.reviewStatus === 'verified') return false;
    // Skip internal/expense categories
    if (['mpesa_charge', 'staff_lunch_expense', 'staff_transport_expense', 'office_water_expense', 'cash_withdrawal', 'internal_transfer', 'bank_transfer'].includes(t.transactionType)) {
      return false;
    }
    // If specific transaction IDs are provided, only process those
    if (transactionIds && transactionIds.length > 0 && !transactionIds.includes(t.id)) {
      return false;
    }
    return true;
  });

  const notesPatch: Array<{
    id: string;
    batchId: string;
    notes?: string | null;
    reviewStatus?: MpesaTransaction['reviewStatus'];
  }> = [];

  for (const transaction of matchedTransactions) {
    try {
      // Step 1: Get and approve the PO
      const poId = transaction.matchedPoId!;
      let po: PurchaseOrderSummary;
      try {
        const pos = await client.readRecords<PurchaseOrderSummary>('purchase.order', [poId], [
          'id', 'name', 'state', 'date_order', 'amount_total', 'amount_untaxed',
          'partner_id', 'currency_id', 'invoice_status', 'user_id', 'picking_ids',
        ]);
        if (!pos[0]) {
          result.skipped.push(`${transaction.receiptNumber || transaction.id}: PO ${poId} not found in Odoo.`);
          continue;
        }
        po = pos[0];
      } catch (error) {
        result.errors.push(`${transaction.receiptNumber || transaction.id}: Could not read PO ${poId}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }

      // Step 2: Approve PO if needed
      if (po.state === 'to approve') {
        const { approved, purchaseOrder } = await approvePoIfNeeded(client, po);
        if (approved) {
          result.approved.push(`${po.name} (from "to approve" → "${purchaseOrder.state}")`);
          po = purchaseOrder;
        }
      } else if (po.state === 'purchase') {
        // Already approved
      } else if (po.state === 'done') {
        result.skipped.push(`${po.name}: PO is already done/locked.`);
        continue;
      } else {
        result.skipped.push(`${po.name}: PO state is "${po.state}", not eligible for auto-approval.`);
        continue;
      }

      // Step 3: Use only a vendor bill created and recorded by PO Bill Scheduler.
      const schedulerBill = await findPoSchedulerVendorBill(client, po.id);
      const vendorBill = schedulerBill.bill;

      // Step 4: Register payment if we have a bill
      const paymentDate = transaction.transactionDate || new Date().toISOString().slice(0, 10);
      let paymentRegistered = false;
      let billAlreadyPaid = false;
      if (vendorBill) {
        // Check if bill is already paid
        if (vendorBill.payment_state === 'paid') {
          result.skipped.push(`${vendorBill.name || vendorBill.id}: Bill is already paid.`);
          billAlreadyPaid = true;
        } else {
          const paymentResult = await registerPaymentOnBill(client, vendorBill.id, transaction, po.id);
          if (paymentResult.success) {
            paymentRegistered = true;
            result.paymentsRegistered.push(
              `${vendorBill.name || vendorBill.id}: ${transaction.amount || transaction.withdrawn} on ${paymentDate} (MPesa: ${transaction.receiptNumber || transaction.id})`,
            );
          } else {
            result.errors.push(
              `${vendorBill.name || vendorBill.id}: Payment registration failed: ${paymentResult.message}`,
            );
          }
        }
      } else {
        result.skipped.push(`${po.name}: ${schedulerBill.reason} Transaction left for follow-up.`);
      }

      // Build note for the transaction
      const noteParts: string[] = [];
      if (result.approved.some((a) => a.startsWith(po.name))) {
        noteParts.push('PO auto-approved.');
      }
      if (vendorBill) {
        noteParts.push(`Vendor bill: ${vendorBill.name || vendorBill.id}.`);
        noteParts.push(`Payment date: ${paymentDate}.`);
      } else {
        noteParts.push(`Payment date: ${paymentDate}. Awaiting PO Scheduler vendor bill. ${schedulerBill.reason}`);
      }

      notesPatch.push({
        id: transaction.id,
        batchId,
        notes: noteParts.join(' '),
        reviewStatus: paymentRegistered || billAlreadyPaid ? 'verified' : 'needs_followup',
      });

      result.processed += 1;
    } catch (error) {
      result.errors.push(
        `${transaction.receiptNumber || transaction.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // Update transaction notes and review status (using admin review fields to avoid clearing PO matches)
  if (notesPatch.length > 0) {
    try {
      await updateMpesaTransactionAdminReviewFields(notesPatch);
    } catch (error) {
      result.errors.push(`Could not save transaction notes: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return result;
}

/**
 * Reconcile ALL matched M-Pesa transactions across all batches from a given month.
 * Handles BOTH directions:
 *   - Outgoing -> approve PO, then pay only PO Scheduler-created vendor bills
 *   - Incoming  → register customer payment on matched invoice
 * Skips already-verified transactions to avoid re-processing.
 */
export async function processMpesaPoReconciliationByMonth(
  fromMonth: string,
): Promise<MpesaPoReconcileResult> {
  const result: MpesaPoReconcileResult = {
    processed: 0,
    approved: [],
    billsCreated: [],
    paymentsRegistered: [],
    skipped: [],
    errors: [],
  };

  const client = await buildOdooClient();
  if (!client) {
    result.errors.push('Odoo is not configured. Cannot reconcile M-Pesa transactions.');
    return result;
  }

  // Fetch both outgoing (PO payments) and incoming (customer receipts)
  const outgoingTransactions = await getMatchedOutgoingTransactionsSince(fromMonth);
  const incomingTransactions = await getMatchedIncomingTransactionsSince(fromMonth);
  const allTransactions = [...outgoingTransactions, ...incomingTransactions];

  if (!allTransactions.length) {
    result.skipped.push(`No unverified matched transactions found from ${fromMonth} onwards.`);
    return result;
  }

  const notesPatch: Array<{
    id: string;
    batchId: string;
    notes?: string | null;
    reviewStatus?: MpesaTransaction['reviewStatus'];
  }> = [];

  for (const transaction of allTransactions) {
    const isIncoming = transaction.direction === 'in' || Number(transaction.paidIn || 0) > 0;

    try {
      if (isIncoming) {
        // --- INCOMING: Customer receipt matched to a customer invoice ---
        const invoiceId = transaction.matchedPoId!;
        let invoice: CustomerInvoiceSummary;
        try {
          const invoices = await client.readRecords<CustomerInvoiceSummary>('account.move', [invoiceId], [
            'id', 'name', 'ref', 'state', 'invoice_date', 'amount_total', 'amount_residual',
            'payment_state', 'move_type', 'partner_id',
          ]);
          if (!invoices[0]) {
            result.skipped.push(`${transaction.receiptNumber || transaction.id}: Invoice ${invoiceId} not found in Odoo.`);
            continue;
          }
          invoice = invoices[0];
        } catch (error) {
          result.errors.push(`${transaction.receiptNumber || transaction.id}: Could not read invoice ${invoiceId}: ${error instanceof Error ? error.message : String(error)}`);
          continue;
        }

        // Skip if invoice is not posted
        if (invoice.state !== 'posted') {
          result.skipped.push(`${invoice.name || invoice.id}: Invoice state is "${invoice.state}", not posted.`);
          continue;
        }

        // Skip if already paid
        if (invoice.payment_state === 'paid') {
          result.skipped.push(`${invoice.name || invoice.id}: Invoice is already paid.`);
          continue;
        }

        // Register customer payment
        const paymentDate = transaction.transactionDate || new Date().toISOString().slice(0, 10);
        const paymentResult = await registerCustomerPayment(client, invoice.id, transaction);
        if (paymentResult.success) {
          result.paymentsRegistered.push(
            `${invoice.name || invoice.id}: ${transaction.amount || transaction.paidIn} on ${paymentDate} (MPesa: ${transaction.receiptNumber || transaction.id})`,
          );
        } else {
          result.errors.push(
            `${invoice.name || invoice.id}: Customer payment registration failed: ${paymentResult.message}`,
          );
        }

        const noteParts = [`Invoice ${invoice.name || invoice.id}.`, `Payment date: ${paymentDate}.`];
        notesPatch.push({
          id: transaction.id,
          batchId: transaction.batchId,
          notes: noteParts.join(' '),
          reviewStatus: 'verified',
        });
        result.processed += 1;
        continue;
      }

      // --- OUTGOING: Supplier payment matched to a PO ---
      const poId = transaction.matchedPoId!;
      let po: PurchaseOrderSummary;
      try {
        const pos = await client.readRecords<PurchaseOrderSummary>('purchase.order', [poId], [
          'id', 'name', 'state', 'date_order', 'amount_total', 'amount_untaxed',
          'partner_id', 'currency_id', 'invoice_status', 'user_id', 'picking_ids',
        ]);
        if (!pos[0]) {
          result.skipped.push(`${transaction.receiptNumber || transaction.id}: PO ${poId} not found in Odoo.`);
          continue;
        }
        po = pos[0];
      } catch (error) {
        result.errors.push(`${transaction.receiptNumber || transaction.id}: Could not read PO ${poId}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }

      // Approve PO if needed
      if (po.state === 'to approve') {
        const { approved, purchaseOrder } = await approvePoIfNeeded(client, po);
        if (approved) {
          result.approved.push(`${po.name} (from "to approve" → "${purchaseOrder.state}")`);
          po = purchaseOrder;
        }
      } else if (po.state === 'purchase') {
        // Already approved
      } else if (po.state === 'done') {
        result.skipped.push(`${po.name}: PO is already done/locked.`);
        continue;
      } else {
        result.skipped.push(`${po.name}: PO state is "${po.state}", not eligible.`);
        continue;
      }

      // Use only a vendor bill created and recorded by PO Bill Scheduler.
      const schedulerBill = await findPoSchedulerVendorBill(client, po.id);
      const vendorBill = schedulerBill.bill;

      // Register payment if we have a bill
      const paymentDate = transaction.transactionDate || new Date().toISOString().slice(0, 10);
      let paymentRegistered = false;
      let billAlreadyPaid = false;
      if (vendorBill) {
        if (vendorBill.payment_state === 'paid') {
          result.skipped.push(`${vendorBill.name || vendorBill.id}: Bill is already paid.`);
          billAlreadyPaid = true;
        } else {
          const paymentResult = await registerPaymentOnBill(client, vendorBill.id, transaction, po.id);
          if (paymentResult.success) {
            paymentRegistered = true;
            result.paymentsRegistered.push(
              `${vendorBill.name || vendorBill.id}: ${transaction.amount || transaction.withdrawn} on ${paymentDate} (MPesa: ${transaction.receiptNumber || transaction.id})`,
            );
          } else {
            result.errors.push(
              `${vendorBill.name || vendorBill.id}: Payment registration failed: ${paymentResult.message}`,
            );
          }
        }
      } else {
        result.skipped.push(`${po.name}: ${schedulerBill.reason} Transaction left for follow-up.`);
      }

      // Build note
      const noteParts: string[] = [];
      if (result.approved.some((a) => a.startsWith(po.name))) {
        noteParts.push('PO auto-approved.');
      }
      if (vendorBill) {
        noteParts.push(`Vendor bill: ${vendorBill.name || vendorBill.id}.`);
        noteParts.push(`Payment date: ${paymentDate}.`);
      } else {
        noteParts.push(`Payment date: ${paymentDate}. Awaiting PO Scheduler vendor bill. ${schedulerBill.reason}`);
      }

      notesPatch.push({
        id: transaction.id,
        batchId: transaction.batchId,
        notes: noteParts.join(' '),
        reviewStatus: paymentRegistered || billAlreadyPaid ? 'verified' : 'needs_followup',
      });

      result.processed += 1;
    } catch (error) {
      result.errors.push(
        `${transaction.receiptNumber || transaction.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // Update transaction notes and review status
  if (notesPatch.length > 0) {
    try {
      await updateMpesaTransactionAdminReviewFields(notesPatch);
    } catch (error) {
      result.errors.push(`Could not save transaction notes: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return result;
}
