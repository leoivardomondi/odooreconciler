import { getSettings } from '../models/repositories';
import { AttachmentInfo, PoBillAutomationResult, PurchaseOrderSummary } from '../models/types';
import { env } from '../utils/env';
import { logEvent } from './logService';
import { sendMailWithConfig, sendMailWithFallback } from './mailTransport';
import { OdooClient } from './odooClient';

export const DEFAULT_PO_BILL_NOTIFICATION_EMAIL = 'leoivardomondi64@gmail.com';

export function getPoBillNotificationRecipient(): string {
  const configured = String(process.env.PO_BILL_NOTIFICATION_EMAIL || '').trim();
  return configured || DEFAULT_PO_BILL_NOTIFICATION_EMAIL;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (char) => {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return map[char] || char;
  });
}

function formatRelationLabel(rel: [number, string] | false | undefined | null): string {
  if (Array.isArray(rel) && rel[1]) {
    return String(rel[1]);
  }
  return '-';
}

async function deliverNotificationEmail(
  client: OdooClient | null,
  options: {
    to: string;
    subject: string;
    text: string;
    html: string;
    attachment?: {
      filename: string;
      content: Buffer;
      contentType?: string;
    };
  },
): Promise<{ sent: boolean; transport: string; detail: string }> {
  const settings = await getSettings();
  const mailOptions: Record<string, unknown> = {
    to: options.to,
    subject: options.subject,
    text: options.text,
    html: options.html,
  };

  if (options.attachment) {
    mailOptions.attachments = [
      {
        filename: options.attachment.filename,
        content: options.attachment.content,
        contentType: options.attachment.contentType || 'application/pdf',
      },
    ];
  }

  const errors: string[] = [];

  try {
    const res = await sendMailWithConfig(settings.mail, mailOptions);
    return {
      sent: true,
      transport: `smtp:${res.username}`,
      detail: `Sent via configured SMTP (${res.fromEmail})`,
    };
  } catch (configErr) {
    errors.push(`Config SMTP: ${configErr instanceof Error ? configErr.message : String(configErr)}`);
  }

  try {
    const res = await sendMailWithFallback(mailOptions);
    return {
      sent: true,
      transport: `env-smtp:${res.username}`,
      detail: `Sent via environment SMTP (${res.fromEmail})`,
    };
  } catch (fallbackErr) {
    errors.push(`Env SMTP: ${fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)}`);
  }

  if (client) {
    try {
      const fromEmail =
        settings.mail.accounts.find((a) => a.fromEmail?.trim())?.fromEmail?.trim() ||
        env.SMTP_FROM_EMAIL ||
        settings.odoo.username ||
        'dbadmin@urbanvibeinteriordesign.co.ke';

      const attachmentIds: number[] = [];
      if (options.attachment) {
        const createdAttId = await client.createRecord('ir.attachment', {
          name: options.attachment.filename,
          datas: options.attachment.content.toString('base64'),
          mimetype: options.attachment.contentType || 'application/pdf',
          type: 'binary',
        });
        if (createdAttId) {
          attachmentIds.push(createdAttId);
        }
      }

      const mailValues: Record<string, unknown> = {
        subject: options.subject,
        email_from: fromEmail,
        email_to: options.to,
        body_html: options.html,
        auto_delete: false,
      };
      if (attachmentIds.length > 0) {
        mailValues.attachment_ids = [[6, 0, attachmentIds]];
      }

      const mailId = await client.createRecord('mail.mail', mailValues);
      if (mailId) {
        await client.callRecordMethod('mail.mail', 'send', [mailId]);
        return {
          sent: true,
          transport: 'odoo-mail',
          detail: `Sent via Odoo mail.mail (ID: ${mailId})`,
        };
      }
    } catch (odooMailErr) {
      errors.push(`Odoo mail.mail: ${odooMailErr instanceof Error ? odooMailErr.message : String(odooMailErr)}`);
    }
  }

  throw new Error(`All email delivery channels failed: ${errors.join(' | ')}`);
}

export interface PoBillSuccessNotificationInput {
  client: OdooClient;
  attachment: AttachmentInfo & { content?: Buffer; mimetype?: string | null };
  purchaseOrders: Array<PurchaseOrderSummary & { company_id?: [number, string] | false }>;
  parsedInvoice: PoBillAutomationResult['parsedInvoice'];
  vendorBill: {
    id: number;
    name?: string | null;
    ref?: string | null;
    state?: string | null;
    invoice_date?: string | null;
    amount_total?: number | null;
  } | null;
  uploadAttachmentId?: number | null;
  paymentResult?: {
    success: boolean;
    message: string;
    paymentId?: number;
  } | null;
  eventType: 'full_automation' | 'existing_match_attached' | 'payment_retry';
  actionsTaken?: string[];
  actionsPending?: string[];
}

export async function sendPoBillSuccessNotification(
  input: PoBillSuccessNotificationInput,
): Promise<{ sent: boolean; recipient: string; message: string }> {
  const recipient = getPoBillNotificationRecipient();
  const settings = await getSettings();
  const baseUrl = (settings.odoo.baseUrl || env.ODOO_BASE_URL || 'https://urban-vibe-interior-design.odoo.com').replace(/\/+$/, '');

  const poNames = input.purchaseOrders.map((po) => po.name).join(', ') || 'N/A';
  const primaryPo = input.purchaseOrders[0] || null;
  const vendorName =
    (primaryPo ? formatRelationLabel(primaryPo.partner_id) : null) ||
    input.parsedInvoice?.vendorName ||
    'Unknown Vendor';
  const companyName =
    input.attachment.companyName ||
    (primaryPo ? formatRelationLabel(primaryPo.company_id) : null) ||
    'Urban Vibe';
  const billLabel = input.vendorBill?.name || (input.vendorBill?.id ? `Bill #${input.vendorBill.id}` : 'Not Created');
  const billState = input.vendorBill?.state || 'N/A';
  const billRef = input.vendorBill?.ref || input.parsedInvoice?.invoiceNumber || '-';
  const totalAmount =
    input.vendorBill?.amount_total ??
    input.parsedInvoice?.grandTotal ??
    primaryPo?.amount_total ??
    0;

  const paymentStatusText = input.paymentResult
    ? input.paymentResult.success
      ? `SUCCESS - ${input.paymentResult.message}`
      : `PENDING/WARN - ${input.paymentResult.message}`
    : input.eventType === 'existing_match_attached'
      ? 'Existing Vendor Bill Linked / Verified'
      : 'Not Attempted';

  const stagesCompleted: string[] = [];
  if (input.purchaseOrders.length > 0) {
    stagesCompleted.push('PO Match');
  }
  if (input.vendorBill) {
    stagesCompleted.push('Vendor Bill Created/Attached');
  } else if (input.uploadAttachmentId) {
    stagesCompleted.push('Receipt Attached');
  }
  if (input.paymentResult?.success) {
    stagesCompleted.push('Payment Registered');
  }

  const subject = `[PO Bill Scheduler] ${stagesCompleted.join(' + ')}: ${poNames} | ${billLabel} (${vendorName})`;

  const poUrl = primaryPo ? `${baseUrl}/web#id=${primaryPo.id}&model=purchase.order&view_type=form` : null;
  const billUrl = input.vendorBill?.id ? `${baseUrl}/web#id=${input.vendorBill.id}&model=account.move&view_type=form` : null;

  const textLines = [
    `PO Bill Scheduler Notification (${stagesCompleted.join(' / ')})`,
    '============================================================',
    `Company: ${companyName}`,
    `Purchase Order(s): ${poNames}`,
    `Vendor: ${vendorName}`,
    `Invoice / Receipt File: ${input.attachment.name} (Attachment ID: ${input.attachment.id})`,
    `Uploaded Attachment ID: ${input.uploadAttachmentId || input.attachment.id}`,
    `Invoice Number: ${billRef}`,
    `Invoice Date: ${input.parsedInvoice?.invoiceDate || input.vendorBill?.invoice_date || '-'}`,
    `Total Amount: ${totalAmount} KES`,
    `PIN Status: ${input.parsedInvoice?.pinNote || '-'}`,
    '',
    `Vendor Bill: ${billLabel} (State: ${billState})`,
    `Payment Registration: ${paymentStatusText}`,
    '',
    ...(poUrl ? [`View Purchase Order in Odoo: ${poUrl}`] : []),
    ...(billUrl ? [`View Vendor Bill in Odoo: ${billUrl}`] : []),
    '',
    ...(input.actionsTaken && input.actionsTaken.length > 0
      ? ['Actions Taken:', ...input.actionsTaken.map((a) => `  - ${a}`)]
      : []),
    ...(input.actionsPending && input.actionsPending.length > 0
      ? ['', 'Actions Pending:', ...input.actionsPending.map((a) => `  - ${a}`)]
      : []),
  ];

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 680px; margin: 0 auto; color: #1e293b; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
      <div style="background: #0f172a; color: #ffffff; padding: 16px 20px;">
        <h2 style="margin: 0; font-size: 18px;">PO Bill Scheduler — Automated Processing Report</h2>
        <p style="margin: 4px 0 0; font-size: 13px; color: #94a3b8;">${escapeHtml(stagesCompleted.join(' • '))}</p>
      </div>
      <div style="padding: 20px;">
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 14px;">
          <tr style="background: #f8fafc;">
            <td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-weight: bold; width: 38%;">Company</td>
            <td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${escapeHtml(companyName)}</td>
          </tr>
          <tr>
            <td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-weight: bold;">Matched Purchase Order(s)</td>
            <td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-weight: bold; color: #0284c7;">
              ${escapeHtml(poNames)}
              ${poUrl ? ` &mdash; <a href="${escapeHtml(poUrl)}" target="_blank" style="color: #0284c7;">Open PO in Odoo</a>` : ''}
            </td>
          </tr>
          <tr style="background: #f8fafc;">
            <td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-weight: bold;">Vendor</td>
            <td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${escapeHtml(vendorName)}</td>
          </tr>
          <tr>
            <td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-weight: bold;">Vendor Bill</td>
            <td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-weight: bold; color: #166534;">
              ${escapeHtml(billLabel)} (${escapeHtml(billState)})
              ${billUrl ? ` &mdash; <a href="${escapeHtml(billUrl)}" target="_blank" style="color: #166534;">Open Bill in Odoo</a>` : ''}
            </td>
          </tr>
          <tr style="background: #f8fafc;">
            <td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-weight: bold;">Invoice / Receipt Attachment</td>
            <td style="padding: 8px 12px; border: 1px solid #e2e8f0;">
              ${escapeHtml(input.attachment.name)} (Source ID: ${escapeHtml(input.attachment.id)}${input.uploadAttachmentId ? `, Uploaded ID: ${escapeHtml(input.uploadAttachmentId)}` : ''})
            </td>
          </tr>
          <tr>
            <td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-weight: bold;">Invoice Reference &amp; Date</td>
            <td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${escapeHtml(billRef)} | Date: ${escapeHtml(input.parsedInvoice?.invoiceDate || input.vendorBill?.invoice_date || '-')}</td>
          </tr>
          <tr style="background: #f8fafc;">
            <td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-weight: bold;">Total Amount</td>
            <td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-weight: bold;">KES ${escapeHtml(Number(totalAmount || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))} (PIN: ${escapeHtml(input.parsedInvoice?.pinNote || '-')})</td>
          </tr>
          <tr>
            <td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-weight: bold;">Payment Registration</td>
            <td style="padding: 8px 12px; border: 1px solid #e2e8f0; color: ${input.paymentResult?.success ? '#166534' : '#b45309'}; font-weight: bold;">
              ${escapeHtml(paymentStatusText)}
            </td>
          </tr>
        </table>

        ${
          input.actionsTaken && input.actionsTaken.length > 0
            ? `
          <h4 style="margin: 16px 0 8px; color: #0f172a;">Actions Taken:</h4>
          <ul style="margin: 0 0 12px; padding-left: 20px; font-size: 13px; color: #334155;">
            ${input.actionsTaken.map((action) => `<li style="margin-bottom: 4px;">${escapeHtml(action)}</li>`).join('')}
          </ul>
        `
            : ''
        }

        ${
          input.actionsPending && input.actionsPending.length > 0
            ? `
          <h4 style="margin: 16px 0 8px; color: #b45309;">Follow-up / Pending Notes:</h4>
          <ul style="margin: 0 0 12px; padding-left: 20px; font-size: 13px; color: #92400e;">
            ${input.actionsPending.map((action) => `<li style="margin-bottom: 4px;">${escapeHtml(action)}</li>`).join('')}
          </ul>
        `
            : ''
        }
      </div>
    </div>
  `;

  try {
    const delivery = await deliverNotificationEmail(input.client, {
      to: recipient,
      subject,
      text: textLines.join('\n'),
      html,
      attachment: input.attachment.content
        ? {
            filename: input.attachment.name || `invoice-${input.attachment.id}.pdf`,
            content: input.attachment.content,
            contentType: input.attachment.mimetype || 'application/pdf',
          }
        : undefined,
    });

    await logEvent('info', `Sent PO Bill notification email to ${recipient}`, {
      recipient,
      eventType: input.eventType,
      purchaseOrders: poNames,
      vendorBill: billLabel,
      attachmentId: input.attachment.id,
      attachmentName: input.attachment.name,
      paymentRegistered: Boolean(input.paymentResult?.success),
      transport: delivery.transport,
    });

    return {
      sent: true,
      recipient,
      message: `Sent PO Bill notification email to ${recipient} (${delivery.detail}).`,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    await logEvent('error', `Failed to send PO Bill notification email to ${recipient}`, {
      recipient,
      eventType: input.eventType,
      purchaseOrders: poNames,
      vendorBill: billLabel,
      attachmentId: input.attachment.id,
      error: errMsg,
    }).catch(() => undefined);

    return {
      sent: false,
      recipient,
      message: `Could not send PO Bill notification email to ${recipient}: ${errMsg}`,
    };
  }
}
