"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clearDuplicateBomNotifiedCache = clearDuplicateBomNotifiedCache;
exports.filterSingleBoardComponentForCuttingMo = filterSingleBoardComponentForCuttingMo;
exports.selectBestBoardComponent = selectBestBoardComponent;
exports.notifyLeoivardDuplicateBoardComponent = notifyLeoivardDuplicateBoardComponent;
const boardProductClassifier_1 = require("./boardProductClassifier");
const workOrderQuantityReconciliationService_1 = require("./workOrderQuantityReconciliationService");
const repositories_1 = require("../models/repositories");
const poJobSummaryAuditService_1 = require("./poJobSummaryAuditService");
const mailTransport_1 = require("./mailTransport");
const poBillNotificationService_1 = require("./poBillNotificationService");
const logService_1 = require("./logService");
const poJobSummaryAuditService_2 = require("./poJobSummaryAuditService");
// In-memory deduplication cache for duplicate BoM notifications to Leoivard (24h cooldown)
const duplicateBomNotifiedCache = new Map();
const NOTIFICATION_COOLDOWN_MS = 24 * 60 * 60 * 1000;
function clearDuplicateBomNotifiedCache() {
    duplicateBomNotifiedCache.clear();
}
/**
 * Checks if a manufacturing order is for a cutting product and has 2 or more board component moves.
 * If 2 board components are detected, it selects ONLY ONE component quantity aligned with the Job Summary,
 * disregards the duplicate component to prevent double stock need, and alerts Leoivard.
 */
async function filterSingleBoardComponentForCuttingMo(input) {
    const { mo, boardMoves, client, settings } = input;
    const moProductName = Array.isArray(mo.product_id) ? mo.product_id[1] : '';
    // Only cutting operations enforce the strict single-board-component rule
    if (!(0, workOrderQuantityReconciliationService_1.isCuttingProductOrWorkOrder)(moProductName, mo.name)) {
        return boardMoves;
    }
    // Filter out any moves that are already cancelled in Odoo
    const activeBoardMoves = boardMoves.filter((m) => m.state !== 'cancel');
    if (activeBoardMoves.length <= 1) {
        return activeBoardMoves;
    }
    // ⚠️ TWO OR MORE BOARD COMPONENTS DETECTED ON A CUTTING PRODUCT!
    // A BoM for cutting must always have ONE board component. Having 2 causes double stock need.
    let parsed = input.parsedJobSummary || null;
    // Attempt to fetch latest extracted Job Summary for this order if not passed
    if (!parsed && mo.origin) {
        const cleanSo = (0, poJobSummaryAuditService_2.extractSoNameFromOrigin)(mo.origin);
        if (cleanSo) {
            try {
                const latest = await (0, repositories_1.getLatestExtractedResultByOrderName)(cleanSo);
                if (latest?.resultJson) {
                    parsed = latest.resultJson;
                }
            }
            catch {
                // Non-fatal
            }
        }
    }
    // Find the single best board component matching Job Summary sheet materials or the cutting product
    const chosenResult = selectBestBoardComponent({
        moProductName,
        moQty: mo.product_qty,
        boardMoves: activeBoardMoves,
        sheetMaterials: parsed?.sheetMaterials || [],
    });
    const chosenMove = chosenResult.chosenMove;
    const alignedQty = chosenResult.alignedQty;
    const matchedMaterialName = chosenResult.matchedMaterialName;
    // Notify Leoivard with error handling
    try {
        await notifyLeoivardDuplicateBoardComponent({
            mo,
            moProductName,
            components: activeBoardMoves,
            chosenComponent: chosenMove,
            alignedQty,
            jobSummaryMaterial: matchedMaterialName,
            client,
            settings,
        });
    }
    catch (err) {
        console.error(`[CuttingBoMReconciliation] Failed to notify Leoivard for MO ${mo.name}:`, err);
    }
    // Return ONLY the single chosen component with its aligned quantity
    return [
        {
            ...chosenMove,
            product_uom_qty: alignedQty,
        },
    ];
}
/**
 * Selects the single best board component from multiple candidate moves, aligning with Job Summary.
 */
function selectBestBoardComponent(input) {
    const { moProductName, moQty, boardMoves, sheetMaterials } = input;
    const targetMoQty = typeof moQty === 'number' && moQty > 0 ? moQty : 0;
    // 1. If Job Summary has sheet materials, score moves against them
    if (sheetMaterials.length > 0) {
        let bestMove = boardMoves[0];
        let bestScore = -1;
        let bestMat = null;
        for (const move of boardMoves) {
            const moveProdName = Array.isArray(move.product_id) ? move.product_id[1] : (move.name || '');
            const moveAttr = (0, boardProductClassifier_1.extractBoardAttributes)(moveProdName);
            const moveThickness = (0, boardProductClassifier_1.extractThicknessMm)(moveProdName);
            for (const mat of sheetMaterials) {
                let score = 0;
                const matAttr = (0, boardProductClassifier_1.extractBoardAttributes)(mat.name);
                const matThickness = (0, boardProductClassifier_1.extractThicknessMm)(mat.name) ?? mat.thickness_mm;
                // Thickness match
                if (moveThickness !== null && matThickness !== null && Math.abs(moveThickness - matThickness) < 1.0) {
                    score += 40;
                }
                // Color match
                if (moveAttr.colorFamily && matAttr.colorFamily && (0, boardProductClassifier_1.areSameColorFamily)(moveAttr.colorFamily, matAttr.colorFamily)) {
                    score += 50;
                }
                // Substrate match
                if (moveAttr.substrate && matAttr.substrate && moveAttr.substrate === matAttr.substrate) {
                    score += 30;
                }
                // Quantity similarity match to Job Summary sheets
                if (typeof mat.sheets === 'number' && mat.sheets > 0) {
                    if (Math.abs(Number(move.product_uom_qty || 0) - mat.sheets) < 0.001) {
                        score += 25;
                    }
                }
                if (score > bestScore) {
                    bestScore = score;
                    bestMove = move;
                    bestMat = mat;
                }
            }
        }
        // Determine aligned quantity
        let alignedQty = targetMoQty > 0 ? targetMoQty : Number(bestMove.product_uom_qty || 0);
        if (bestMat && typeof bestMat.sheets === 'number' && bestMat.sheets > 0) {
            alignedQty = bestMat.sheets;
        }
        else if (targetMoQty > 0) {
            alignedQty = targetMoQty;
        }
        return {
            chosenMove: bestMove,
            alignedQty,
            matchedMaterialName: bestMat?.name || '',
        };
    }
    // 2. If NO Job Summary available, score moves against the cutting product name
    let bestMove = boardMoves[0];
    let bestScore = -1;
    const moAttr = (0, boardProductClassifier_1.extractBoardAttributes)(moProductName);
    const moThickness = (0, boardProductClassifier_1.extractThicknessMm)(moProductName);
    for (const move of boardMoves) {
        const moveProdName = Array.isArray(move.product_id) ? move.product_id[1] : (move.name || '');
        const moveAttr = (0, boardProductClassifier_1.extractBoardAttributes)(moveProdName);
        const moveThickness = (0, boardProductClassifier_1.extractThicknessMm)(moveProdName);
        let score = 0;
        if (moThickness !== null && moveThickness !== null && Math.abs(moThickness - moveThickness) < 1.0) {
            score += 40;
        }
        if (moAttr.colorFamily && moveAttr.colorFamily && (0, boardProductClassifier_1.areSameColorFamily)(moAttr.colorFamily, moveAttr.colorFamily)) {
            score += 50;
        }
        if (moAttr.substrate && moveAttr.substrate && moAttr.substrate === moveAttr.substrate) {
            score += 30;
        }
        if (targetMoQty > 0 && Math.abs(Number(move.product_uom_qty || 0) - targetMoQty) < 0.001) {
            score += 20;
        }
        if (score > bestScore) {
            bestScore = score;
            bestMove = move;
        }
    }
    const alignedQty = targetMoQty > 0 ? targetMoQty : Number(bestMove.product_uom_qty || 0);
    return {
        chosenMove: bestMove,
        alignedQty,
        matchedMaterialName: '',
    };
}
/**
 * Notifies Leoivard Ongule via Email and Odoo Chatter when a cutting BoM contains duplicate board components.
 */
async function notifyLeoivardDuplicateBoardComponent(input) {
    const { mo, moProductName, components, chosenComponent, alignedQty, jobSummaryMaterial, client, settings } = input;
    // Deduplication check: only notify once every 24 hours per MO
    const lastNotified = duplicateBomNotifiedCache.get(mo.id);
    const now = Date.now();
    if (lastNotified && now - lastNotified < NOTIFICATION_COOLDOWN_MS) {
        return;
    }
    duplicateBomNotifiedCache.set(mo.id, now);
    const chosenCompName = Array.isArray(chosenComponent.product_id)
        ? chosenComponent.product_id[1]
        : (chosenComponent.name || 'Unknown Board');
    const componentList = components.map((c) => {
        const name = Array.isArray(c.product_id) ? c.product_id[1] : (c.name || 'Board');
        return { name, qty: Number(c.product_uom_qty || 0), id: c.id };
    });
    // 1. Post warning note in Odoo chatter on the MO (with @Leoivard mention)
    let leoivardPartnerId = null;
    if (client) {
        try {
            const leoivardUser = await (0, poJobSummaryAuditService_1.findOdooUserByTerm)(client, 'Leoivard');
            leoivardPartnerId = leoivardUser?.partnerId || null;
            const leoivardMention = leoivardPartnerId
                ? `<a href="#" data-oe-model="res.partner" data-oe-id="${leoivardPartnerId}">@${leoivardUser?.name || 'Leoivard Ongule'}</a>`
                : '@Leoivard Ongule';
            const componentItemsHtml = componentList
                .map((c) => `<li><b>${escapeHtml(c.name)}</b>: ${c.qty} sheets (Move #${c.id})</li>`)
                .join('');
            const alignmentText = jobSummaryMaterial
                ? `aligned with Job Summary material <em>${escapeHtml(jobSummaryMaterial)}</em>`
                : `aligned with cutting order target quantity`;
            const chatterHtml = `
        <div style="font-size:13px; color:#9c4221; background:#fffaf0; border-left:4px solid #dd6b20; padding:10px 14px; border-radius:4px; margin-bottom:8px;">
          <p style="margin:0 0 6px 0; font-weight:bold; font-size:14px; color:#c05621;">
            ⚠️ Duplicate Board Component Detected on Cutting BoM
          </p>
          <p style="margin:0 0 6px 0;">
            A cutting operation must only have <b>one</b> board component. Found <b>${components.length} board components</b> on this MO:
          </p>
          <ul style="margin:0 0 8px 18px; padding:0;">
            ${componentItemsHtml}
          </ul>
          <p style="margin:0 0 6px 0;">
            <b>Automated Adjustment:</b> To prevent duplicate stock requirement on the shop floor, the reconciler app only considered <b>${escapeHtml(chosenCompName)} (${alignedQty} sheets)</b> (${alignmentText}).
          </p>
          <p style="margin:0; font-weight:bold; color:#7b341e;">
            Please inspect and clean up the duplicate component on the BoM / MO in Odoo. cc ${leoivardMention}
          </p>
        </div>
      `;
            await client.postModelChatterMessage('mrp.production', mo.id, chatterHtml, leoivardPartnerId ? [leoivardPartnerId] : undefined);
        }
        catch (chatterErr) {
            console.warn(`[CuttingBoMReconciliation] Could not post chatter warning on MO ${mo.name}:`, chatterErr);
        }
    }
    // 2. Send email alert to Leoivard
    const recipientEmail = String(process.env.PO_BILL_NOTIFICATION_EMAIL ||
        settings?.mail?.automations?.find((a) => a.systemKey === 'po-bill-notifications')?.recipients ||
        poBillNotificationService_1.DEFAULT_PO_BILL_NOTIFICATION_EMAIL).trim();
    if (recipientEmail && settings?.mail) {
        try {
            const subject = `⚠️ Duplicate Board Component in BoM — ${mo.name} (${moProductName})`;
            const emailHtml = `
        <div style="font-family: Arial, sans-serif; font-size: 14px; color: #2d3748; line-height: 1.6; max-width: 650px;">
          <h2 style="color: #c53030; margin-top: 0;">⚠️ Duplicate Board Component Detected on Cutting BoM</h2>
          <p>Hello Leoivard,</p>
          <p>
            The reconciler detected that Manufacturing Order <b>${escapeHtml(mo.name)}</b>
            (<em>${escapeHtml(moProductName)}</em>${mo.origin ? `, Origin: <b>${escapeHtml(mo.origin)}</b>` : ''})
            has <b>${components.length} board components</b> defined on its Bill of Materials / components list.
          </p>
          <p>
            <b>Factory Rule:</b> A Bill of Materials for a cutting product must always have only <b>ONE</b> board component.
            Multiple components cause double stock requirements and incorrect shortage alerts on the production floor.
          </p>
          <div style="background: #fff5f5; border-left: 4px solid #e53e3e; padding: 12px 16px; margin: 16px 0; border-radius: 4px;">
            <p style="margin: 0 0 8px 0; font-weight: bold; color: #9b2c2c;">Components found on MO in Odoo:</p>
            <ul style="margin: 0; padding-left: 20px;">
              ${componentList.map((c) => `<li><b>${escapeHtml(c.name)}</b>: ${c.qty} sheets (Move #${c.id})</li>`).join('')}
            </ul>
            <p style="margin: 12px 0 0 0; color: #742a2a;">
              <b>Automated Floor Safeguard:</b> The app disregarded the duplicate and <b>only considered ONE component: ${escapeHtml(chosenCompName)} (${alignedQty} sheets)</b>
              ${jobSummaryMaterial ? `to align with Job Summary material (<em>${escapeHtml(jobSummaryMaterial)}</em>)` : ''}.
            </p>
          </div>
          <p>
            Please review the Bill of Materials (BoM) and component lines for <b>${escapeHtml(mo.name)}</b> in Odoo and remove the redundant component to keep Odoo inventory aligned.
          </p>
          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
          <p style="font-size: 12px; color: #718096; margin-bottom: 0;">
            Sent automatically by Urban Vibe Reconciler Shop Floor Monitor.
          </p>
        </div>
      `;
            await (0, mailTransport_1.sendMailWithConfig)(settings.mail, {
                to: recipientEmail,
                subject,
                html: emailHtml,
                text: `Duplicate Board Component in BoM for ${mo.name} (${moProductName}). Reconciler only considered ${chosenCompName} (${alignedQty} sheets). Please clean up in Odoo.`,
            });
        }
        catch (emailErr) {
            console.warn(`[CuttingBoMReconciliation] Could not send email alert to Leoivard:`, emailErr);
        }
    }
    void (0, logService_1.logEvent)('warn', 'Duplicate board component detected on cutting BoM', {
        moId: mo.id,
        moName: mo.name,
        moProductName,
        components: componentList,
        chosenComponent: chosenCompName,
        alignedQty,
        notifiedUser: 'Leoivard Ongule',
        recipientEmail,
    }).catch(() => null);
}
function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => {
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
        };
        return map[char] || char;
    });
}
