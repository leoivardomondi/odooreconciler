import { getSettings } from '../models/repositories';
import { sendMailWithConfig } from './mailTransport';
import { logEvent } from './logService';
import { env } from '../utils/env';
import { normalizeBoardLogRecipients } from '../utils/helpers';

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export interface BoardIntakeEmailNotificationInput {
  boardIntakeId: string;
  customerName: string;
  productName: string;
  quantity: number;
  actorName: string;
  actorEmail?: string | null;
  matchedBy?: string | null;
  vehicleRegistration?: string | null;
  arrivalTime?: string | null;
  gate?: string | null;
  arrivalDate?: string | null;
  isPurchase?: boolean;
  purchaseOrderReference?: string | null;
  moNames?: string | null;
  totalNeeded?: number | null;
  totalMissing?: number | null;
}

/**
 * Dispatch the email notification when a board intake is logged (or matched).
 * Only called when a client is confirmed/matched, never for pending/unknown client entries.
 */
export async function sendBoardIntakeEmailNotification(
  input: BoardIntakeEmailNotificationInput,
): Promise<{ sent: boolean; recipients?: string; error?: string }> {
  try {
    const settings = await getSettings();
    const rawRecipients = normalizeBoardLogRecipients(settings.stock?.boardLogNotificationEmail);
    const recipientList = [
      ...new Set(
        rawRecipients
          .split(/[,\s;\n]+/)
          .map((e) => e.trim().toLowerCase())
          .filter((e) => e.includes('@')),
      ),
    ];
    if (recipientList.length === 0) {
      return { sent: false, error: 'No valid recipient email configured' };
    }
    const toRecipients = recipientList.join(', ');

    const reportDate =
      input.arrivalDate ||
      new Intl.DateTimeFormat('en-CA', {
        timeZone: env.APP_TIMEZONE || 'Africa/Nairobi',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());

    const safeCustomerName = escapeHtml(input.customerName);
    const safeProductName = escapeHtml(input.productName);
    const safeVehicleReg = escapeHtml(input.vehicleRegistration || '—');
    const safeArrivalTime = escapeHtml(input.arrivalTime || '—');
    const safeGate = escapeHtml(input.gate || '—');
    const safeActorEmail = escapeHtml(input.actorName || input.actorEmail || 'Operator');
    const subjectCustomerName = input.customerName.replace(/[\r\n]+/g, ' ').trim();

    const effectiveIsPurchase = Boolean(input.isPurchase);
    const purchaseSubjectTag = effectiveIsPurchase ? ' [PURCHASE]' : ' [CLIENT SUPPLY]';
    const purchaseLabel = effectiveIsPurchase
      ? input.purchaseOrderReference
        ? `Yes (PO: ${escapeHtml(input.purchaseOrderReference)})`
        : 'Yes (Company Purchase)'
      : 'No (Client Supplied)';

    const hasMoReq = Boolean(input.moNames) || (input.totalNeeded != null && input.totalNeeded > 0);
    const partialSubjectTag =
      hasMoReq && input.totalMissing != null && input.totalMissing > 0
        ? ` (Partial: ${input.quantity} Logged, Balance ${input.totalMissing} Needed)`
        : input.moNames
        ? ` (${input.moNames})`
        : '';

    let reqDetailsHtml = '';
    if (hasMoReq && input.totalNeeded != null) {
      reqDetailsHtml += `<br>Total Required: ${input.totalNeeded} sheets`;
      if (input.totalMissing != null) {
        if (input.totalMissing > 0) {
          reqDetailsHtml += `<br>Balance Remaining: <strong style="color:#b91c1c;">${input.totalMissing} sheet${input.totalMissing === 1 ? '' : 's'} needed</strong>`;
        } else {
          reqDetailsHtml += `<br>Balance Remaining: <strong style="color:#15803d;">0 sheets (Fully supplied)</strong>`;
        }
      }
    }
    if (input.moNames) {
      reqDetailsHtml += `<br>Manufacturing Order: ${escapeHtml(input.moNames)}`;
    }

    let calloutHtml = '';
    if (hasMoReq && input.totalNeeded != null && input.totalMissing != null) {
      if (input.totalMissing > 0) {
        calloutHtml =
          `<p style="margin-top:12px;padding:8px 12px;background:#fef2f2;border-left:4px solid #ef4444;color:#991b1b;border-radius:4px;">` +
          `⚠️ <strong>PARTIAL INTAKE:</strong> ${input.quantity} sheet${input.quantity === 1 ? '' : 's'} logged, balance <strong>${input.totalMissing} sheet${input.totalMissing === 1 ? '' : 's'}</strong> still required for ${escapeHtml(input.moNames || 'MO')}. Stock requirement of ${input.totalMissing} board${input.totalMissing === 1 ? '' : 's'} remains active before cutting/completion can start.` +
          `</p>`;
      } else {
        calloutHtml =
          `<p style="margin-top:12px;padding:8px 12px;background:#f0fdf4;border-left:4px solid #22c55e;color:#166534;border-radius:4px;">` +
          `✅ <strong>COMPLETE INTAKE:</strong> All ${input.totalNeeded} sheets received and allocated in stock for ${escapeHtml(input.moNames || 'MO')}.` +
          `</p>`;
      }
    } else if (input.moNames) {
      calloutHtml =
        `<p style="margin-top:12px;padding:8px 12px;background:#f0fdf4;border-left:4px solid #22c55e;color:#166534;border-radius:4px;">` +
        `✅ <strong>BOARD INTAKE:</strong> ${input.quantity} sheet${input.quantity === 1 ? '' : 's'} logged and allocated for ${escapeHtml(input.moNames)}.` +
        `</p>`;
    }

    const matchedInfoHtml = input.matchedBy
      ? `<br>Matched by: <strong>${escapeHtml(input.matchedBy)}</strong> (Attributed Operator)`
      : '';

    const appBaseUrl = String(env.APP_BASE_URL || 'https://app.urbanvibeinteriordesign.co.ke').replace(/\/+$/, '');
    const fullListUrl = `${appBaseUrl}/public/board-logs?date=${encodeURIComponent(reportDate)}#date-${encodeURIComponent(reportDate)}`;
    const buttonHtml =
      `<div style="margin-top:20px;margin-bottom:12px;">` +
      `<a href="${fullListUrl}" style="display:inline-block;background-color:#0f172a;color:#ffffff;text-decoration:none;padding:10px 22px;font-size:14px;font-weight:600;border-radius:8px;box-shadow:0 1px 2px rgba(0,0,0,0.08);letter-spacing:0.01em;" target="_blank">` +
      `📋 View Full Board Logs List &rarr;` +
      `</a>` +
      `</div>`;

    const matchedSubjectTag = input.matchedBy ? ` (Matched to ${subjectCustomerName})` : '';

    await sendMailWithConfig(settings.mail, {
      to: toRecipients,
      subject: `${subjectCustomerName} - Board Log${matchedSubjectTag}${purchaseSubjectTag}${partialSubjectTag} - ${reportDate}`,
      html: `<p><strong>Board log completed</strong></p><p>Client: ${safeCustomerName}<br>Board: ${safeProductName}<br>Purchase: <strong style="${effectiveIsPurchase ? 'color:#1d4ed8;' : 'color:#475569;'}">${purchaseLabel}</strong><br>Quantity: ${input.quantity} sheet${input.quantity === 1 ? '' : 's'}${reqDetailsHtml}<br>Gate: ${safeGate}<br>Vehicle Reg: ${safeVehicleReg}<br>Arrival Time: ${safeArrivalTime}<br>Date: ${reportDate}<br>Logged by: ${safeActorEmail}${matchedInfoHtml}</p>${calloutHtml}${buttonHtml}`,
    });

    await logEvent('info', 'Board log notification email sent', {
      boardIntakeId: input.boardIntakeId,
      to: toRecipients,
      customerName: input.customerName,
      productName: input.productName,
      quantity: input.quantity,
      actor: input.actorName,
      matchedBy: input.matchedBy || null,
    }).catch(() => undefined);

    return { sent: true, recipients: toRecipients };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await logEvent('error', 'Board log email failed', {
      boardIntakeId: input.boardIntakeId,
      customerName: input.customerName,
      productName: input.productName,
      quantity: input.quantity,
      error: errorMsg,
    }).catch(() => undefined);
    return { sent: false, error: errorMsg };
  }
}
