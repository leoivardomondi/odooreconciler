import PDFDocument from 'pdfkit';
import { OdooClient } from './odooClient';
import { getPoBillProcessedDocumentsByAttachmentIds, getSettings } from '../models/repositories';
import { sendMailWithConfig } from './mailTransport';
import { logEvent } from './logService';
import { getRecentDocumentPdfsPage } from './poBillAutomationService';
import { env } from '../utils/env';

export const CAMPAIGN_START_DATE = '2026-05-01 00:00:00';
export const CAMPAIGN_BATCH_SIZE = 48;
export const CAMPAIGN_DAILY_LIMIT = 72;
export const CAMPAIGN_DURATION_DAYS = 7;

export function buildOdooDocumentUrl(
  odooBaseUrl: string,
  documentId: number | null | undefined,
  attachmentId: number | null | undefined,
): string {
  const baseUrl = (odooBaseUrl || '').replace(/\/+$/, '');
  if (documentId && documentId > 0) {
    return `${baseUrl}/web#id=${documentId}&model=documents.document&view_type=form`;
  }
  if (attachmentId && attachmentId > 0) {
    return `${baseUrl}/web#id=${attachmentId}&model=ir.attachment&view_type=form`;
  }
  return `${baseUrl}/web#action=documents.document_action`;
}

export function isNonInvoiceSummary(summary: string): boolean {
  const text = (summary || '').toLowerCase();
  return /\b(job summary|maxcut|max cut|delivery note|delivery slip|packing slip|not a vendor bill|not a supplier invoice|receipt)\b/i.test(text);
}

export function isAlreadyInvoicedSummary(summary: string): boolean {
  const text = (summary || '').toLowerCase();
  return /\b(already invoiced|invoiced in odoo)\b/i.test(text);
}

export interface CampaignMetrics {
  totalScanned: number;
  totalPassed: number;
  totalFailed: number;
  totalNonInvoices: number;
  totalAlreadyInvoiced: number;
  totalUnmatchedInvoices: number;
  unprocessedRemaining: number;
  unmatchedInvoicesList: Array<{
    attachmentId: number;
    documentId: number | null;
    fileName: string;
    summary: string;
    odooUrl: string;
    attemptCount: number;
    lastAttemptAt: string | null;
  }>;
}

export async function computeMayCampaignMetrics(
  client: OdooClient,
  odooBaseUrl: string,
): Promise<CampaignMetrics> {
  const allPage = await getRecentDocumentPdfsPage(client, { page: 1, pageSize: 500 });
  const pdfs = allPage.items;
  const attachmentIds = pdfs.map((pdf) => pdf.id);
  const processedMap = await getPoBillProcessedDocumentsByAttachmentIds(attachmentIds);

  let totalScanned = 0;
  let totalPassed = 0;
  let totalFailed = 0;
  let totalNonInvoices = 0;
  let totalAlreadyInvoiced = 0;
  let totalUnmatchedInvoices = 0;
  let unprocessedRemaining = 0;

  const unmatchedInvoicesList: CampaignMetrics['unmatchedInvoicesList'] = [];

  for (const pdf of pdfs) {
    const record = processedMap[pdf.id];
    if (!record) {
      unprocessedRemaining += 1;
      continue;
    }

    totalScanned += 1;
    const status = String(record.status || '');
    const summary = String(record.summary || '');

    if (['processed', 'processed_with_warnings'].includes(status)) {
      totalPassed += 1;
    } else if (status === 'failed') {
      totalFailed += 1;
    } else if (isNonInvoiceSummary(summary)) {
      totalNonInvoices += 1;
    } else if (isAlreadyInvoicedSummary(summary)) {
      totalAlreadyInvoiced += 1;
    } else {
      totalUnmatchedInvoices += 1;
      unmatchedInvoicesList.push({
        attachmentId: pdf.id,
        documentId: pdf.documentId || null,
        fileName: pdf.name || `Attachment #${pdf.id}`,
        summary: summary || 'No safe PO bill match was found.',
        odooUrl: buildOdooDocumentUrl(odooBaseUrl, pdf.documentId, pdf.id),
        attemptCount: Number(record.attemptCount || 1),
        lastAttemptAt: record.processedAt || null,
      });
    }
  }

  return {
    totalScanned,
    totalPassed,
    totalFailed,
    totalNonInvoices,
    totalAlreadyInvoiced,
    totalUnmatchedInvoices,
    unprocessedRemaining,
    unmatchedInvoicesList,
  };
}

export async function generateCampaignPdfReport(
  metrics: CampaignMetrics,
  odooBaseUrl: string,
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ margin: 36, size: 'A4' });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', (err) => reject(err));

    doc.fontSize(18).fillColor('#1e293b').text('PO Bill Automation Campaign Summary Report', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor('#64748b').text(`Scope: Documents from May 1st, 2026 to Date | Batch Size: ${CAMPAIGN_BATCH_SIZE} | Daily Ceiling: ${CAMPAIGN_DAILY_LIMIT}`, { align: 'center' });
    doc.moveDown(1);

    doc.fontSize(12).fillColor('#0f172a').text('Campaign Summary Metrics:', { underline: true });
    doc.moveDown(0.5);

    const summaryRows = [
      ['Total Scanned Documents', String(metrics.totalScanned)],
      ['Passed (Vendor Bills Created)', String(metrics.totalPassed)],
      ['Failed (System / API Errors)', String(metrics.totalFailed)],
      ['Non-Invoices / Delivery Notes', String(metrics.totalNonInvoices)],
      ['Already Invoiced in Odoo', String(metrics.totalAlreadyInvoiced)],
      ['Unmatched Invoices (Action Required)', String(metrics.totalUnmatchedInvoices)],
      ['Unprocessed Remaining', String(metrics.unprocessedRemaining)],
    ];

    summaryRows.forEach(([label, val]) => {
      doc.fontSize(10).fillColor('#334155').text(`• ${label}: `, { continued: true }).fillColor('#0284c7').text(val);
    });

    doc.moveDown(1.5);
    doc.fontSize(12).fillColor('#0f172a').text(`Unmatched Invoices (${metrics.unmatchedInvoicesList.length}):`, { underline: true });
    doc.moveDown(0.5);

    if (metrics.unmatchedInvoicesList.length === 0) {
      doc.fontSize(10).fillColor('#166534').text('Great news! All scanned invoices were successfully matched or skipped as non-invoices.');
    } else {
      metrics.unmatchedInvoicesList.forEach((item, index) => {
        if (doc.y > 720) {
          doc.addPage();
        }
        doc.fontSize(10).fillColor('#0f172a').text(`${index + 1}. ${item.fileName} `, { continued: true });
        doc.fillColor('#0284c7').text(`[View in Odoo Documents]`, { link: item.odooUrl, underline: true });
        doc.fontSize(9).fillColor('#475569').text(`   Details: ${item.summary} | Attempts: ${item.attemptCount} | Last Run: ${item.lastAttemptAt || '-'}`);
        doc.moveDown(0.4);
      });
    }

    doc.end();
  });
}

export async function notifyDbAdminCampaignReport(
  client: OdooClient,
  recipientEmail?: string,
): Promise<{ sent: boolean; message: string }> {
  const settings = await getSettings();
  const odooBaseUrl = settings.odoo.baseUrl || 'https://reconciler.flowcode.co.ke';
  const metrics = await computeMayCampaignMetrics(client, odooBaseUrl);
  const pdfBuffer = await generateCampaignPdfReport(metrics, odooBaseUrl);

  const fallbackEmail = env.AUTH_LOCAL_ADMIN_EMAIL || settings.mail.accounts[0]?.username || 'dbadmin@urbanvibeinteriordesign.co.ke';
  const targetEmail = recipientEmail || fallbackEmail;

  const htmlBody = `
    <div style="font-family: Arial, sans-serif; max-width: 650px; margin: 0 auto; color: #1e293b;">
      <h2 style="color: #0f172a; border-bottom: 2px solid #0284c7; padding-bottom: 8px;">PO Bill Automation Campaign Summary</h2>
      <p>Hello System Administrator,</p>
      <p>The PO Bill Scheduler campaign for documents starting <strong>May 1st, 2026</strong> has completed a scan cycle. Below is the summary of results:</p>
      
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
        <tr style="background: #f8fafc;"><td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: bold;">Total Scanned</td><td style="padding: 8px; border: 1px solid #e2e8f0;">${metrics.totalScanned}</td></tr>
        <tr><td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: bold; color: #166534;">Passed (Bills Created)</td><td style="padding: 8px; border: 1px solid #e2e8f0; color: #166534; font-weight: bold;">${metrics.totalPassed}</td></tr>
        <tr style="background: #f8fafc;"><td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: bold; color: #991b1b;">Failed Errors</td><td style="padding: 8px; border: 1px solid #e2e8f0;">${metrics.totalFailed}</td></tr>
        <tr><td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: bold;">Delivery Notes / Non-Invoices</td><td style="padding: 8px; border: 1px solid #e2e8f0;">${metrics.totalNonInvoices}</td></tr>
        <tr style="background: #f8fafc;"><td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: bold;">Already Invoiced in Odoo</td><td style="padding: 8px; border: 1px solid #e2e8f0;">${metrics.totalAlreadyInvoiced}</td></tr>
        <tr><td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: bold; color: #c2410c;">Unmatched Invoices</td><td style="padding: 8px; border: 1px solid #e2e8f0; color: #c2410c; font-weight: bold;">${metrics.totalUnmatchedInvoices}</td></tr>
        <tr style="background: #f8fafc;"><td style="padding: 8px; border: 1px solid #e2e8f0; font-weight: bold;">Unprocessed Remaining</td><td style="padding: 8px; border: 1px solid #e2e8f0;">${metrics.unprocessedRemaining}</td></tr>
      </table>

      ${
        metrics.unmatchedInvoicesList.length > 0
          ? `
        <h3 style="color: #0f172a; margin-top: 20px;">Unmatched Invoices (Click to view in Odoo):</h3>
        <ul>
          ${metrics.unmatchedInvoicesList
            .map(
              (item) => `
            <li style="margin-bottom: 8px;">
              <strong>${item.fileName}</strong> — 
              <a href="${item.odooUrl}" target="_blank" style="color: #0284c7; text-decoration: underline;">Open in Odoo Documents App</a>
              <br/><span style="font-size: 12px; color: #64748b;">${item.summary}</span>
            </li>
          `,
            )
            .join('')}
        </ul>
      `
          : '<p style="color: #166534; font-weight: bold;">All candidate invoices have been matched or validated!</p>'
      }

      <p style="margin-top: 24px; font-size: 12px; color: #94a3b8;">A complete detailed PDF report is attached to this email.</p>
    </div>
  `;

  try {
    await sendMailWithConfig(settings.mail, {
      to: targetEmail,
      subject: `[PO Bill Scheduler] Campaign Summary Report (May 1st - Date)`,
      html: htmlBody,
      attachments: [
        {
          filename: `PO_Bill_Campaign_Report_${new Date().toISOString().slice(0, 10)}.pdf`,
          content: pdfBuffer,
          contentType: 'application/pdf',
        },
      ],
    } as any);

    await logEvent('info', 'Sent campaign summary report email to dbadmin', {
      recipient: targetEmail,
      metrics,
    });

    return { sent: true, message: `Campaign report emailed successfully to ${targetEmail}.` };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown mail error';
    await logEvent('error', 'Failed sending campaign report email to dbadmin', { error: errorMsg });
    return { sent: false, message: `Failed sending campaign email: ${errorMsg}` };
  }
}
