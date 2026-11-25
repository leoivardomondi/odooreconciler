"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractMaxCutJobNumber = extractMaxCutJobNumber;
exports.addJobSummaries = addJobSummaries;
exports.compareAndCombineJobSummaries = compareAndCombineJobSummaries;
exports.resolveCombinedJobSummaryFromOdooAttachments = resolveCombinedJobSummaryFromOdooAttachments;
const boardProductClassifier_1 = require("./boardProductClassifier");
const pdfParser_1 = require("./pdfParser");
const signatureService_1 = require("./signatureService");
const helpers_1 = require("../utils/helpers");
function extractMaxCutJobNumber(rawText) {
    const text = String(rawText || '');
    const match = text.match(/Job\s+Summary\s*-\s*(\d+)/i);
    return match ? match[1] : null;
}
function buildMaterialFingerprint(parsed) {
    const jobNo = extractMaxCutJobNumber(parsed.rawText) || '';
    const mats = (parsed.sheetMaterials || [])
        .map((m) => `${(0, boardProductClassifier_1.normalizeBoardProductName)(m.name)}:${m.thickness_mm ?? ''}:${m.sheets}:${m.panels ?? ''}`)
        .sort()
        .join('|');
    const edges = (parsed.items || [])
        .map((e) => `${String(e.color || '').toLowerCase().trim()}:${e.thickness_mm}:${e.length_mm}`)
        .sort()
        .join('|');
    return `${jobNo}#${parsed.optimizedSheets ?? ''}#${parsed.totalPanels ?? ''}#${mats}#${edges}`;
}
function areSameSheetMaterial(a, b) {
    const normA = (0, boardProductClassifier_1.normalizeBoardProductName)(a.name);
    const normB = (0, boardProductClassifier_1.normalizeBoardProductName)(b.name);
    if (normA === normB)
        return true;
    const thickA = (0, boardProductClassifier_1.extractThicknessMm)(a.name) ?? a.thickness_mm;
    const thickB = (0, boardProductClassifier_1.extractThicknessMm)(b.name) ?? b.thickness_mm;
    if (thickA !== null && thickB !== null && Math.abs(thickA - thickB) > 0.5) {
        return false;
    }
    const attrA = (0, boardProductClassifier_1.extractBoardAttributes)(a.name);
    const attrB = (0, boardProductClassifier_1.extractBoardAttributes)(b.name);
    if (attrA.colorFamily && attrB.colorFamily && !(0, boardProductClassifier_1.areSameColorFamily)(attrA.colorFamily, attrB.colorFamily)) {
        return false;
    }
    if (attrA.substrate !== 'other' &&
        attrB.substrate !== 'other' &&
        attrA.substrate !== attrB.substrate) {
        return false;
    }
    return Boolean(attrA.colorFamily && attrB.colorFamily);
}
/**
 * Adds/merges multiple ParsedJobSummaryResult objects into a single combined result
 * by summing sheet counts, panel counts, and edging lengths per matching material.
 */
function addJobSummaries(candidates) {
    if (candidates.length === 0) {
        return {
            items: [],
            sectionFound: false,
            sectionText: '',
            rawText: '',
            logs: [],
            clientName: null,
            optimizedSheets: null,
            totalPanels: null,
            sheetMaterials: [],
        };
    }
    if (candidates.length === 1) {
        return candidates[0].parsed;
    }
    const mergedSheets = [];
    for (const cand of candidates) {
        for (const mat of cand.parsed.sheetMaterials || []) {
            const existing = mergedSheets.find((entry) => areSameSheetMaterial(entry.mat, mat));
            if (existing) {
                existing.mat = {
                    ...existing.mat,
                    sheets: Number(existing.mat.sheets || 0) + Number(mat.sheets || 0),
                    panels: existing.mat.panels !== null || mat.panels !== null
                        ? Number(existing.mat.panels || 0) + Number(mat.panels || 0)
                        : null,
                };
                existing.breakdown.push(Number(mat.sheets || 0));
            }
            else {
                mergedSheets.push({
                    mat: { ...mat },
                    breakdown: [Number(mat.sheets || 0)],
                });
            }
        }
    }
    const mergedEdgesMap = new Map();
    for (const cand of candidates) {
        for (const item of cand.parsed.items || []) {
            const key = `${String(item.color || '').toLowerCase().trim()}::${item.thickness_mm}`;
            const existing = mergedEdgesMap.get(key);
            if (existing) {
                mergedEdgesMap.set(key, {
                    ...existing,
                    length_mm: Number(existing.length_mm || 0) + Number(item.length_mm || 0),
                    roll_length_mm: existing.roll_length_mm || item.roll_length_mm,
                });
            }
            else {
                mergedEdgesMap.set(key, { ...item });
            }
        }
    }
    const combinedSheetMaterials = mergedSheets.map((e) => e.mat);
    const sumSheetsFromMaterials = combinedSheetMaterials.reduce((s, m) => s + Number(m.sheets || 0), 0);
    const sumOptimizedHeader = candidates.reduce((s, c) => s + Number(c.parsed.optimizedSheets || 0), 0);
    const sumTotalPanels = candidates.reduce((s, c) => s + Number(c.parsed.totalPanels || 0), 0);
    const labels = candidates.map((c, idx) => {
        const jobNo = extractMaxCutJobNumber(c.parsed.rawText);
        return jobNo ? `Job Summary - ${jobNo}` : (c.attachmentName || `Summary #${idx + 1}`);
    });
    const materialBreakdownDesc = mergedSheets
        .map((e) => e.breakdown.length > 1
        ? `${e.mat.name} (${e.breakdown.join(' + ')} = ${e.mat.sheets} sheets)`
        : `${e.mat.name} (${e.mat.sheets} sheets)`)
        .join(', ');
    const summaryLog = `Combined ${candidates.length} Job Summaries (${labels.join(' + ')}): ${materialBreakdownDesc || 'no sheet materials'}.`;
    return {
        items: [...mergedEdgesMap.values()],
        sectionFound: candidates.some((c) => c.parsed.sectionFound),
        sectionText: candidates.map((c) => c.parsed.sectionText).filter(Boolean).join('\n---\n'),
        rawText: candidates.map((c) => c.parsed.rawText).filter(Boolean).join('\n\n'),
        logs: [summaryLog, ...candidates.flatMap((c) => c.parsed.logs || [])],
        clientName: candidates.find((c) => c.parsed.clientName)?.parsed.clientName || null,
        optimizedSheets: sumSheetsFromMaterials > 0 ? sumSheetsFromMaterials : (sumOptimizedHeader > 0 ? sumOptimizedHeader : null),
        totalPanels: sumTotalPanels > 0 ? sumTotalPanels : null,
        sheetMaterials: combinedSheetMaterials,
    };
}
/**
 * Computes how well a ParsedJobSummaryResult's sheetMaterials match the Sales Order's
 * board / cutting lines. Lower score = closer match (0 = exact match on all boards).
 */
function scoreAgainstSaleOrderBoardLines(parsed, soLines) {
    const boardSoLines = (soLines || []).filter((l) => {
        const label = String(l.productName || l.description || '').trim();
        if (!label || l.quantity <= 0)
            return false;
        if (/optimis?ed\s+panels?/i.test(label) || /example\s+board/i.test(label))
            return false;
        return (0, boardProductClassifier_1.isBoardProductName)(label) || /^cutting\b/i.test(label);
    });
    if (boardSoLines.length === 0)
        return null;
    let totalError = 0;
    const mats = parsed.sheetMaterials || [];
    for (const line of boardSoLines) {
        const label = String(line.productName || line.description || '').trim();
        const lineThickness = (0, boardProductClassifier_1.extractThicknessMm)(label);
        const lineAttr = (0, boardProductClassifier_1.extractBoardAttributes)(label);
        const matchedMat = mats.find((m) => {
            const mThick = (0, boardProductClassifier_1.extractThicknessMm)(m.name) ?? m.thickness_mm;
            if (lineThickness !== null && mThick !== null && Math.abs(lineThickness - mThick) > 0.5) {
                return false;
            }
            const mAttr = (0, boardProductClassifier_1.extractBoardAttributes)(m.name);
            if (lineAttr.colorFamily && mAttr.colorFamily) {
                return (0, boardProductClassifier_1.areSameColorFamily)(lineAttr.colorFamily, mAttr.colorFamily);
            }
            return true;
        });
        const matSheets = matchedMat ? Number(matchedMat.sheets || 0) : 0;
        // Allow 1-sheet offcut variance without penalty when sheets >= 2
        const diff = Math.abs(matSheets - Number(line.quantity || 0));
        const effectiveError = matSheets >= 2 && Number(line.quantity || 0) === matSheets - 1 ? 0 : diff;
        totalError += effectiveError;
    }
    return totalError;
}
/**
 * Compares 2 or more Job Summary PDFs attached to a Sales Order, deduplicates identical uploads,
 * and determines whether to ADD/combine them (e.g. main summary + addendum summary, or different
 * MaxCut job numbers, or sum matches SO lines better) vs. using the latest revision alone.
 */
function compareAndCombineJobSummaries(candidates, soLines = []) {
    if (!candidates || candidates.length === 0) {
        const empty = addJobSummaries([]);
        return {
            mode: 'single',
            combined: empty,
            includedAttachments: [],
            comparisonSummary: 'No Job Summary attachments found.',
        };
    }
    if (candidates.length === 1) {
        const c = candidates[0];
        return {
            mode: 'single',
            combined: c.parsed,
            includedAttachments: [
                {
                    attachmentId: c.attachmentId,
                    attachmentName: c.attachmentName,
                    jobNumber: extractMaxCutJobNumber(c.parsed.rawText),
                    optimizedSheets: c.parsed.optimizedSheets,
                    totalPanels: c.parsed.totalPanels,
                },
            ],
            comparisonSummary: 'Single Job Summary attachment.',
        };
    }
    // 1. Deduplicate exact duplicate PDF uploads (preserving order)
    const seenFingerprints = new Set();
    const distinct = [];
    for (const cand of candidates) {
        const fp = cand.signature || buildMaterialFingerprint(cand.parsed);
        const matFp = buildMaterialFingerprint(cand.parsed);
        if (seenFingerprints.has(fp) || seenFingerprints.has(matFp)) {
            continue;
        }
        seenFingerprints.add(fp);
        seenFingerprints.add(matFp);
        distinct.push(cand);
    }
    if (distinct.length === 1) {
        const c = distinct[0];
        return {
            mode: 'deduplicated_single',
            combined: c.parsed,
            includedAttachments: [
                {
                    attachmentId: c.attachmentId,
                    attachmentName: c.attachmentName,
                    jobNumber: extractMaxCutJobNumber(c.parsed.rawText),
                    optimizedSheets: c.parsed.optimizedSheets,
                    totalPanels: c.parsed.totalPanels,
                },
            ],
            comparisonSummary: `Deduplicated ${candidates.length} identical Job Summary uploads into 1.`,
        };
    }
    // 2. Compare latest single PDF vs summed combination of all distinct PDFs
    const latest = distinct[0];
    const summed = addJobSummaries(distinct);
    const jobNumbers = distinct.map((d) => extractMaxCutJobNumber(d.parsed.rawText)).filter(Boolean);
    const uniqueJobNumbers = new Set(jobNumbers);
    const hasDifferentJobNumbers = uniqueJobNumbers.size > 1;
    // Check if earlier summaries contain board materials completely absent from the latest summary
    const latestMats = latest.parsed.sheetMaterials || [];
    const earlierHasAdditionalMaterials = distinct.slice(1).some((d) => (d.parsed.sheetMaterials || []).some((m) => !latestMats.some((lm) => areSameSheetMaterial(lm, m))));
    const latestError = scoreAgainstSaleOrderBoardLines(latest.parsed, soLines);
    const summedError = scoreAgainstSaleOrderBoardLines(summed, soLines);
    let shouldAdd = false;
    let reason = '';
    if (summedError !== null && latestError !== null) {
        if (summedError < latestError) {
            shouldAdd = true;
            reason = `Combined sum of ${distinct.length} Job Summaries matches Sales Order board quantities (variance ${summedError} vs single-PDF variance ${latestError}).`;
        }
        else if (summedError === latestError && (hasDifferentJobNumbers || earlierHasAdditionalMaterials)) {
            shouldAdd = true;
            reason = `Distinct MaxCut Job Summaries (${[...uniqueJobNumbers].join(', ')}) with complementary materials combined.`;
        }
        else {
            shouldAdd = false;
            reason = `Latest Job Summary alone matches Sales Order board quantities (variance ${latestError} vs combined variance ${summedError}); treating earlier upload as superseded revision.`;
        }
    }
    else if (hasDifferentJobNumbers || earlierHasAdditionalMaterials) {
        shouldAdd = true;
        reason = hasDifferentJobNumbers
            ? `Multiple distinct MaxCut Job Summary numbers (${[...uniqueJobNumbers].join(' + ')}) detected on this Sales Order; added quantities together.`
            : `Multiple Job Summaries with complementary board materials detected; added quantities together.`;
    }
    if (shouldAdd) {
        return {
            mode: 'combined_sum',
            combined: summed,
            includedAttachments: distinct.map((c) => ({
                attachmentId: c.attachmentId,
                attachmentName: c.attachmentName,
                jobNumber: extractMaxCutJobNumber(c.parsed.rawText),
                optimizedSheets: c.parsed.optimizedSheets,
                totalPanels: c.parsed.totalPanels,
            })),
            comparisonSummary: reason,
        };
    }
    return {
        mode: 'latest_revision',
        combined: latest.parsed,
        includedAttachments: [
            {
                attachmentId: latest.attachmentId,
                attachmentName: latest.attachmentName,
                jobNumber: extractMaxCutJobNumber(latest.parsed.rawText),
                optimizedSheets: latest.parsed.optimizedSheets,
                totalPanels: latest.parsed.totalPanels,
            },
        ],
        comparisonSummary: reason || 'Latest Job Summary selected as newest revision.',
    };
}
/**
 * Fetches all Job Summary PDF attachments on a Sales Order, parses and compares them
 * against the Sales Order's lines, and returns the combined (or latest revision) result.
 */
async function resolveCombinedJobSummaryFromOdooAttachments(client, saleOrderId, parserConfig = helpers_1.DEFAULT_PARSER_CONFIG, options) {
    const attachments = await client.getAttachments(saleOrderId).catch(() => []);
    const jobSummaryAttachments = attachments
        .filter((a) => (0, helpers_1.isJobSummaryAttachment)(a, parserConfig.filenameKeyword || 'job summary'))
        .sort(helpers_1.sortAttachmentsNewestFirst);
    if (jobSummaryAttachments.length === 0) {
        return null;
    }
    if (options?.onlyWhenMultiple && jobSummaryAttachments.length <= 1) {
        return null;
    }
    const rawSoLines = await client
        .searchReadRecords('sale.order.line', {
        domain: [['order_id', '=', saleOrderId]],
        fields: ['id', 'name', 'product_id', 'product_uom_qty', 'display_type'],
        limit: 100,
    })
        .catch(() => []);
    const candidates = [];
    for (const att of jobSummaryAttachments) {
        try {
            const downloaded = await client.downloadAttachment(att.id);
            const sig = (0, signatureService_1.computePdfSignature)(downloaded.content);
            const parsed = await (0, pdfParser_1.parseJobSummaryPdf)(downloaded.content, parserConfig);
            candidates.push({
                attachmentId: att.id,
                attachmentName: att.name,
                createDate: att.create_date,
                signature: sig,
                parsed,
            });
        }
        catch {
            // Skip unreadable attachment
        }
    }
    if (candidates.length === 0) {
        return null;
    }
    const soLineHints = rawSoLines
        .filter((l) => !l.display_type)
        .map((l) => ({
        productName: Array.isArray(l.product_id) ? String(l.product_id[1] || '') : '',
        description: l.name || '',
        quantity: Number(l.product_uom_qty || 0),
    }));
    return compareAndCombineJobSummaries(candidates, soLineHints);
}
