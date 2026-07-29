import {
  claimBoardIntakeQueueEntry,
  getBoardIntakeQueueEntry,
  getDueBoardIntakeQueueEntries,
  releaseStaleBoardIntakeQueueEntry,
  updateBoardIntakeQueueEntry,
} from '../models/repositories';
import { getSettings } from '../models/repositories';
import { recordExactStockQuantity, refreshStockMirror } from './stockMirrorService';
import { logEvent } from './logService';
import { OdooClient } from './odooClient';
import { isBoardProductName } from './boardProductClassifier';

const AUTO_RETRY_INTERVAL_MS = 2 * 60 * 1000;
let intervalHandle: NodeJS.Timeout | null = null;
let batchPromise: Promise<void> | null = null;

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export async function syncBoardIntakeEntry(id: string) {
  let entry = await getBoardIntakeQueueEntry(id);
  if (!entry) throw new Error('Board log was not found.');
  if (entry.status === 'synced') return { alreadySynced: true, stockQuantity: entry.odoo_stock_quantity };
  if (entry.status === 'processing') {
    throw new Error('This board log is already synchronizing with Odoo.');
  }
  if (!await claimBoardIntakeQueueEntry(id)) {
    throw new Error('This board log was claimed by another synchronization attempt.');
  }

  try {
    entry = (await getBoardIntakeQueueEntry(id))!;
    const settings = await getSettings();
    const client = new OdooClient(settings.odoo);

    // Persist this checkpoint immediately. If a later Odoo request fails, the
    // retry skips the inventory addition and cannot double-add the boards.
    let stockQuantity = entry.odoo_stock_quantity;
    if (stockQuantity == null) {
      if (!isBoardProductName(entry.product_name)) {
        throw new Error(
          `${entry.product_name} is not recognized as a physical board. Services and non-board products cannot receive stock quantities.`,
        );
      }
      const stockable = await client.ensureBoardProductIsStockable(Number(entry.product_id));
      if (stockable.changed) {
        await logEvent('warn', 'Odoo board product changed from consumable to stockable', {
          boardIntakeId: id,
          productId: entry.product_id,
          productTemplateId: stockable.templateId,
          productName: stockable.productName,
        }).catch(() => undefined);
      }
      const stockResult = await client.addBoardsToStock({
        productId: Number(entry.product_id),
        quantity: Number(entry.quantity),
      });
      stockQuantity = stockResult.newQty;
      await updateBoardIntakeQueueEntry(id, {
        status: 'processing',
        stockQuantity,
      });
      await recordExactStockQuantity(Number(entry.product_id), entry.product_name, stockQuantity);
    }

    const matchingMOs = await client.findMOsForBoardIntake({
      productId: Number(entry.product_id),
      partnerId: Number(entry.partner_id),
    });
    if (matchingMOs.length) {
      const reportDate = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Africa/Nairobi',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
      const note = `<p><strong>Boards logged in Shop Flow</strong><br/>User: ${escapeHtml(entry.actor_name)}<br/>Client: ${escapeHtml(entry.customer_name)}<br/>Board: ${escapeHtml(entry.product_name)}<br/>Quantity: ${Number(entry.quantity)}<br/>Date: ${reportDate}</p>`;
      await Promise.all(matchingMOs.map((mo) =>
        client.postModelChatterMessage('mrp.production', mo.moId, note).catch(() => null),
      ));
      await client.reserveStockOnMOs(matchingMOs.map((mo) => mo.moId));
    }

    await updateBoardIntakeQueueEntry(id, { status: 'synced', stockQuantity });
    void refreshStockMirror();
    await logEvent('info', 'Board intake synchronized with Odoo', {
      boardIntakeId: id,
      productId: entry.product_id,
      partnerId: entry.partner_id,
      quantity: entry.quantity,
      retryCount: entry.retry_count,
      matchingMoCount: matchingMOs.length,
    }).catch(() => undefined);
    return { alreadySynced: false, stockQuantity, matchingMoCount: matchingMOs.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateBoardIntakeQueueEntry(id, { status: 'failed', errorMessage: message }).catch(() => undefined);
    await logEvent('error', 'Board intake Odoo synchronization failed', {
      boardIntakeId: id,
      error: message,
    }).catch(() => undefined);
    throw error;
  }
}

export async function retryDueBoardIntakeEntries() {
  if (batchPromise) return batchPromise;
  batchPromise = (async () => {
    const due = await getDueBoardIntakeQueueEntries(5);
    for (const entry of due) {
      if (entry.status === 'processing') {
        await releaseStaleBoardIntakeQueueEntry(entry.id);
      }
      await syncBoardIntakeEntry(entry.id).catch(() => undefined);
    }
  })().finally(() => {
    batchPromise = null;
  });
  return batchPromise;
}

export function startBoardIntakeSyncInterval() {
  if (intervalHandle) return;
  setTimeout(() => void retryDueBoardIntakeEntries(), 10_000).unref();
  intervalHandle = setInterval(() => void retryDueBoardIntakeEntries(), AUTO_RETRY_INTERVAL_MS);
  intervalHandle.unref();
}
