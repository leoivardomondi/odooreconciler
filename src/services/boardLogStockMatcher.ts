import { normalizeBoardProductName, isBoardProductName } from './boardProductClassifier';
import { extractSoNameFromOrigin } from '../utils/helpers';

export interface BoardLogCandidate {
  id?: string;
  partner_id?: number | null;
  customer_name?: string | null;
  product_id?: number | null;
  product_name?: string | null;
  quantity?: number | null;
  purchase_order_reference?: string | null;
}

export interface LoadedProcessCandidate {
  id?: string;
  mo_id?: number | null;
  mo_name?: string | null;
  origin?: string | null;
  partner_id?: number | null;
  partner_name?: string | null;
  product_id?: number | null;
  product_name?: string | null;
  status?: string | null;
  qty_missing?: number | null;
  qty_reserved?: number | null;
  qty_needed?: number | null;
}

export interface PoLineCandidate {
  orderName?: string;
  productId: number;
  productName?: string;
  productQty: number;
  qtyReceived: number;
}

export interface BoardLogMatchQuery {
  moId?: number | null;
  moName?: string | null;
  origin?: string | null;
  partnerId?: number | null;
  partnerName?: string | null;
  productId: number;
  productName: string;
  relatedPoNames?: string[];
  activeLogs?: BoardLogCandidate[];
  loadedProcesses?: LoadedProcessCandidate[];
  poLines?: PoLineCandidate[];
}

export interface BoardLogMatchResult {
  hasMatch: boolean;
  source: 'board_intake_queue' | 'shop_floor_pending_processes' | 'purchase_receipt' | 'none';
  matchedQuantity: number;
  reason?: string;
}

export function isMatchingBoardProduct(
  prodA: string | undefined | null,
  prodB: string | undefined | null,
  idA?: number | null,
  idB?: number | null,
): boolean {
  if (idA && idB && idA > 0 && idB > 0 && idA === idB) {
    return true;
  }
  const normA = normalizeBoardProductName(prodA);
  const normB = normalizeBoardProductName(prodB);
  if (!normA || !normB) {
    return false;
  }
  if (normA === normB) {
    return true;
  }
  if (normA.includes(normB) || normB.includes(normA)) {
    return true;
  }
  return false;
}

export function isMatchingClient(
  nameA: string | undefined | null,
  nameB: string | undefined | null,
  idA?: number | null,
  idB?: number | null,
): boolean {
  if (idA && idB && idA > 0 && idB > 0 && idA === idB) {
    return true;
  }
  const cleanA = String(nameA || '').trim().toLowerCase();
  const cleanB = String(nameB || '').trim().toLowerCase();
  if (!cleanA || !cleanB) {
    return false;
  }
  if (cleanA === cleanB) {
    return true;
  }
  if (cleanA.length >= 3 && cleanB.length >= 3) {
    if (cleanA.includes(cleanB) || cleanB.includes(cleanA)) {
      return true;
    }
  }
  return false;
}

/**
 * Checks whether a board component requirement for a Manufacturing Order is satisfied
 * by existing records (active board intake logs, loaded pending processes, or fulfilled PO receipts),
 * even if Odoo's internal stock reservation shows partially_available or unavailable due to
 * older jobs causing negative stock.
 */
export function findMatchingBoardLog(query: BoardLogMatchQuery): BoardLogMatchResult {
  const {
    moId,
    moName,
    origin,
    partnerId,
    partnerName,
    productId,
    productName,
    relatedPoNames = [],
    activeLogs = [],
    loadedProcesses = [],
    poLines = [],
  } = query;

  // 1. Check shop_floor_pending_processes (already fulfilled and loaded board requirements)
  if (loadedProcesses && loadedProcesses.length > 0) {
    const cleanOrigin = origin ? origin.trim().toUpperCase() : null;
    const extractedSo = origin ? extractSoNameFromOrigin(origin) : null;
    const cleanExtractedSo = extractedSo ? extractedSo.trim().toUpperCase() : null;

    for (const p of loadedProcesses) {
      const pMoIdMatch = Boolean(moId && p.mo_id === moId);
      const pMoNameMatch = Boolean(moName && p.mo_name && p.mo_name.trim().toUpperCase() === moName.trim().toUpperCase());
      const pOrigin = p.origin ? p.origin.trim().toUpperCase() : null;
      const pOriginMatch = Boolean(
        cleanOrigin && pOrigin && (pOrigin === cleanOrigin || (cleanExtractedSo && pOrigin === cleanExtractedSo)),
      );
      const clientMatch = isMatchingClient(partnerName, p.partner_name, partnerId, p.partner_id);

      if (
        (pMoIdMatch || pMoNameMatch || pOriginMatch || clientMatch) &&
        isMatchingBoardProduct(productName, p.product_name, productId, p.product_id)
      ) {
        const isLoaded = p.status === 'loaded'
          || (typeof p.qty_missing === 'number' && p.qty_missing === 0)
          || (Number(p.qty_reserved || 0) >= Number(p.qty_needed || 0));

        if (isLoaded) {
          const qty = Number(p.qty_reserved || p.qty_needed || 1);
          return {
            hasMatch: true,
            source: 'shop_floor_pending_processes',
            matchedQuantity: qty,
            reason: `Matched loaded pending process ${p.id} for MO ${p.mo_name || moName || moId}`,
          };
        }
      }
    }
  }

  // 2. Check active non-reverted board intake logs (board_intake_queue)
  if (activeLogs && activeLogs.length > 0) {
    const poSet = new Set(relatedPoNames.map((po) => po.trim().toUpperCase()));

    for (const log of activeLogs) {
      if (!isMatchingBoardProduct(productName, log.product_name, productId, log.product_id)) {
        continue;
      }

      const clientMatch = isMatchingClient(partnerName, log.customer_name, partnerId, log.partner_id);
      const logPo = log.purchase_order_reference ? log.purchase_order_reference.trim().toUpperCase() : null;
      const poMatch = Boolean(logPo && poSet.has(logPo));

      if (clientMatch || poMatch) {
        const qty = Number(log.quantity || 0);
        if (qty > 0) {
          return {
            hasMatch: true,
            source: 'board_intake_queue',
            matchedQuantity: qty,
            reason: `Matched active gate board intake log ${log.id} for client ${log.customer_name || partnerName || 'Unknown'} (${qty} sheets logged)`,
          };
        }
      }
    }
  }

  // 3. Check PO lines in Odoo: If PO lines for this board are already received (qty_received >= product_qty)
  if (poLines && poLines.length > 0) {
    for (const line of poLines) {
      if (
        line.productId === productId ||
        isMatchingBoardProduct(productName, line.productName, productId, line.productId)
      ) {
        const received = Number(line.qtyReceived || 0);
        const ordered = Number(line.productQty || 0);
        if (received > 0 && (received >= ordered || received >= 1)) {
          return {
            hasMatch: true,
            source: 'purchase_receipt',
            matchedQuantity: received,
            reason: `Matching PO line on ${line.orderName || 'Purchase Order'} was already received in Odoo (${received} of ${ordered} received)`,
          };
        }
      }
    }
  }

  return {
    hasMatch: false,
    source: 'none',
    matchedQuantity: 0,
  };
}
