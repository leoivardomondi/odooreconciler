"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeColor = normalizeColor;
exports.matchSoLine = matchSoLine;
exports.matchSoLines = matchSoLines;
exports.computeExtractedMeters = computeExtractedMeters;
exports.computeQuantityToAdd = computeQuantityToAdd;
exports.logMissingItemsToChatter = logMissingItemsToChatter;
exports.processStockItem = processStockItem;
exports.processAllItems = processAllItems;
exports.previewSaleOrderStockProcessing = previewSaleOrderStockProcessing;
exports.processSaleOrderStock = processSaleOrderStock;
exports.reverseSaleOrderStockAdditions = reverseSaleOrderStockAdditions;
const repositories_1 = require("../models/repositories");
const helpers_1 = require("../utils/helpers");
const env_1 = require("../utils/env");
const logService_1 = require("./logService");
const manufacturingStatus_1 = require("./manufacturingStatus");
const odooClient_1 = require("./odooClient");
const odooActivityService_1 = require("./odooActivityService");
const ALLOWED_NOTIFICATION_USER_NAME = 'Leoivard Ongule';
const MISSING_EDGE_BANDING_ACTIVITY_SUMMARY = 'MISSING EDGE BANDING ITEM(S)';
async function getConfiguredClient() {
    const settings = await (0, repositories_1.getSettings)();
    if (!(0, helpers_1.hasOdooConfiguration)(settings)) {
        throw new Error('Odoo is not configured yet. Complete the setup page first.');
    }
    return {
        client: new odooClient_1.OdooClient(settings.odoo),
        settings,
    };
}
function splitJoinedWords(value) {
    return value.replace(/([a-z])([A-Z])/g, '$1 $2');
}
function toTitleCase(value) {
    return value
        .split(' ')
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}
const EDGE_BAND_SERVICE_VARIANT_MAPPINGS = [
    { serviceColor: '8-13', serviceNames: ['Edge Band Service 8-13'], variantColor: '8-13', variantType: '1mm' },
    { serviceColor: '9-2', serviceNames: ['Edge Band Service 9-2'], variantColor: '9-2', variantType: '1mm' },
    { serviceColor: 'Etimo', serviceNames: ['Edge Band Service Etimo'], variantColor: 'Etimo', variantType: '1mm' },
    { serviceColor: 'Gloss White', serviceNames: ['Edge Band Service Gloss White'], variantColor: 'Gloss White', variantType: '1mm' },
    { serviceColor: 'American Walnut', serviceNames: ['Edge Banding  Service American Walnut'], variantColor: 'American Walnut', variantType: '1mm' },
    { serviceColor: 'Black', serviceNames: ['Edge Banding  Service Black'], variantColor: 'Black', variantType: '1mm' },
    { serviceColor: 'Dark Grey', serviceNames: ['Edge Banding  Service Dark Grey'], variantColor: 'Dark grey', variantType: '1mm' },
    { serviceColor: 'Esperanza', serviceNames: ['Edge Banding  Service Esperanza'], variantColor: 'Esperanza', variantType: '1mm' },
    { serviceColor: 'Honey Oak', serviceNames: ['Edge Banding  Service Honey Oak'], variantColor: 'Honey oak', variantType: '1mm' },
    { serviceColor: 'Monument Oak', serviceNames: ['Edge Banding  Service Monument Oak'], variantColor: 'Monument Oak', variantType: '1mm' },
    { serviceColor: 'Beech', serviceNames: ['Edge Banding Service Beech'], variantColor: 'Beech', variantType: '1mm' },
    { serviceColor: 'Black Cherry', serviceNames: ['Edge Banding Service Black Cherry'], variantColor: 'Black Cherry', variantType: '1mm' },
    { serviceColor: 'Cappuccino Gloss', serviceNames: ['Edge Banding Service Cappuccino Gloss'], variantColor: 'Cappuccino Gloss', variantType: '1mm' },
    { serviceColor: 'Cherry', serviceNames: ['Edge Banding Service Cherry'], variantColor: 'Cherry', variantType: '1mm' },
    { serviceColor: 'Light Grey', serviceNames: ['Edge Banding Service Light Grey'], variantColor: 'Light grey', variantType: '1mm' },
    { serviceColor: 'Light Grey', serviceNames: ['Edge Banding Service Light Grey 36mm'], variantColor: 'Light grey', variantType: '36mm' },
    { serviceColor: 'Neuro', serviceNames: ['Edge Banding Service Neuro'], variantColor: 'Neuro', variantType: '1mm' },
    { serviceColor: 'Petrol Blue', serviceNames: ['Edge Banding Service Petrol Blue'], variantColor: 'petrol blue', variantType: '1mm' },
    { serviceColor: 'Royal Teak', serviceNames: ['Edge Banding Service Royal Teak'], variantColor: 'Royal Teak', variantType: '1mm' },
    { serviceColor: 'Sapeli', serviceNames: ['Edge Banding Service Sapeli'], variantColor: 'Sapeli', variantType: '1mm' },
    { serviceColor: 'White', serviceNames: ['Edge Banding Service White'], variantColor: 'White', variantType: '1mm' },
    { serviceColor: 'White', serviceNames: [], variantColor: 'White', variantType: '36mm' },
    { serviceColor: 'Zalzach', serviceNames: ['Edge Banding Service Zalzach'], variantColor: 'Zalzach', variantType: '1mm' },
    { serviceColor: 'White Cherry', serviceNames: ['Edge Banding White Cherry 1mm'], variantColor: 'White Cherry', variantType: '1mm' },
    { serviceColor: 'Coimbra', serviceNames: ['Edge Banding  Service Coimbra'], variantColor: 'Coimbra', variantType: '1mm' },
    { serviceColor: 'White Oak', serviceNames: ['Edge Banding  Service White Oak'], variantColor: 'White oak', variantType: '1mm' },
    { serviceColor: 'Cappuccino', serviceNames: ['Edge Banding Service Cappuccino'], variantColor: 'Cappuccino', variantType: '1mm' },
    { serviceColor: 'Harbour Grey', serviceNames: ['Edge Banding Service Harbour Grey'], variantColor: 'Harbour Grey', variantType: '1mm' },
    { serviceColor: 'Cadbury oak', serviceNames: ['Edge banding service Cadbury oak'], variantColor: 'Cadbury Oak', variantType: '1mm' },
    { serviceColor: 'Caraz', serviceNames: ['Edge banding service Caraz'], variantColor: 'caraz', variantType: '1mm' },
    { serviceColor: 'High Gloss Dark grey', serviceNames: ['Edge Band Service High Gloss Dark grey'], variantColor: 'Dark Grey Gloss', variantType: '1mm' },
    { serviceColor: 'Havard Cherry', serviceNames: ['Edge Banding  Service Havard Cherry'], variantColor: 'Harvard Cherry', variantType: '1mm' },
    { serviceColor: 'Silver Brush', serviceNames: ['Edge Banding  Service Silver Brush'], variantColor: 'Siver Brush', variantType: '1mm' },
    { serviceColor: 'Darkwalnut', serviceNames: ['Edge Banding Service Darkwalnut'], variantColor: 'Dark Walnut', variantType: '1mm' },
    { serviceColor: 'Versasca', serviceNames: ['Edge Banding Service Versasca'], variantColor: 'Verzasca', variantType: '1mm' },
    { serviceColor: 'White Marble', serviceNames: ['Edge banding service White Marble'], variantColor: 'Marble white', variantType: '1mm' },
];
function normalizeColor(value) {
    const aliases = {
        'petro blue': 'petrol blue',
        petrolblue: 'petrol blue',
        'petrol blues': 'petrol blue',
        darkwalnut: 'dark walnut',
        'darkwal nut': 'dark walnut',
        versasca: 'verzasca',
        gloss: 'gloss white',
        'havard cherry': 'harvard cherry',
        'siver brush': 'silver brush',
        'white marble': 'marble white',
        'high gloss dark grey': 'dark grey gloss',
        'dark gloss grey': 'dark grey gloss',
    };
    const pluralMap = {
        blues: 'blue',
    };
    const spaced = splitJoinedWords(value).replace(/\s+/g, ' ').trim().toLowerCase();
    const aliasResolved = aliases[spaced] || spaced;
    const normalizedWords = aliasResolved
        .split(' ')
        .filter(Boolean)
        .map((word) => pluralMap[word] || word);
    return normalizedWords.join(' ');
}
function buildExpectedSoProduct(normalizedColor) {
    return `Edge Banding Service ${toTitleCase(normalizedColor)}`;
}
function normalizeEdgeBandType(thicknessMm) {
    const thickness = Number(thicknessMm || 0);
    return thickness >= 30 ? '36mm' : '1mm';
}
function resolveEdgeBandMapping(normalizedColor, thicknessMm) {
    const preferredType = normalizeEdgeBandType(thicknessMm);
    const matches = EDGE_BAND_SERVICE_VARIANT_MAPPINGS.filter((mapping) => normalizeColor(mapping.serviceColor) === normalizedColor);
    return matches.find((mapping) => mapping.variantType === preferredType) || matches[0] || null;
}
function splitColorWords(value) {
    return normalizeColor(value)
        .split(' ')
        .map((part) => part.trim())
        .filter(Boolean);
}
function colorsAreEquivalent(left, right) {
    const leftWords = splitColorWords(left);
    const rightWords = splitColorWords(right);
    if (leftWords.length !== rightWords.length) {
        return false;
    }
    return [...leftWords].sort().join(' ') === [...rightWords].sort().join(' ');
}
function extractItemsFromJson(rawJson) {
    const parsed = JSON.parse(rawJson);
    if (Array.isArray(parsed)) {
        return parsed.filter((item) => Boolean(item && typeof item === 'object'));
    }
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.items)) {
        return parsed.items;
    }
    return [];
}
function parseIsoDate(value) {
    if (!value) {
        return 0;
    }
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
}
function shouldPreferLatestExtraction(handoffJson, currentSignature, latestExtracted) {
    if (!latestExtracted) {
        return false;
    }
    const latestSignature = latestExtracted.pdfSignature?.trim() || '';
    if (!latestSignature) {
        return false;
    }
    if (!handoffJson.trim()) {
        return true;
    }
    if (currentSignature.trim() && latestSignature === currentSignature.trim()) {
        return true;
    }
    return parseIsoDate(latestExtracted.createdAt) > 0 && !currentSignature.trim();
}
function aggregateItems(items) {
    const byColor = new Map();
    items.forEach((item) => {
        const extractedColor = String(item.color || '').trim();
        if (!extractedColor) {
            return;
        }
        const normalizedColor = normalizeColor(extractedColor);
        if (!normalizedColor) {
            return;
        }
        const mapping = resolveEdgeBandMapping(normalizedColor, item.thickness_mm);
        const componentColor = normalizeColor(mapping?.variantColor || normalizedColor);
        const componentType = mapping?.variantType || normalizeEdgeBandType(item.thickness_mm);
        const aggregateKey = `${normalizedColor}|${componentType}`;
        const existing = byColor.get(aggregateKey);
        const nextLength = Math.max(0, Number(item.length_mm || 0));
        if (existing) {
            existing.lengthMm += nextLength;
            if (!existing.extractedColor.includes(extractedColor)) {
                existing.extractedColor = `${existing.extractedColor}, ${extractedColor}`;
            }
            return;
        }
        byColor.set(aggregateKey, {
            extractedColor,
            normalizedColor,
            componentColor,
            componentType,
            lengthMm: nextLength,
            expectedSoProduct: mapping?.serviceNames[0] || buildExpectedSoProduct(normalizedColor),
            serviceNameCandidates: [
                ...(mapping?.serviceNames || []),
                buildExpectedSoProduct(normalizedColor),
                `Edge Band Service ${toTitleCase(normalizedColor)}`,
            ],
        });
    });
    return [...byColor.values()];
}
function normalizeServiceProductName(value) {
    const trimmed = value.replace(/\s+/g, ' ').trim();
    const lower = trimmed.toLowerCase();
    // Odoo can prefix a product display name with an internal reference, for
    // example "[EB-MARBLE] Edge Banding Service Marble". Find the service name
    // inside the display value instead of requiring it to begin at character 1.
    const servicePattern = /\bedge\s+band(?:ing)?\s+service\s+(.+)$/i;
    const serviceMatch = trimmed.match(servicePattern);
    if (serviceMatch) {
        return `edge banding service ${normalizeColor(serviceMatch[1].replace(/\b1mm\b|\b36mm\b/gi, '').trim())}`;
    }
    const compactBandingMatch = lower.match(/\bedge\s+banding\s+(.+?)\s+1mm$/i);
    if (compactBandingMatch) {
        return `edge banding service ${normalizeColor(compactBandingMatch[1])}`;
    }
    return lower;
}
function getLineDescriptionCandidates(value) {
    return value
        .split(/\r?\n/)
        .map((part) => part.trim())
        .filter(Boolean);
}
function extractServiceColor(value) {
    const normalized = normalizeServiceProductName(value);
    const prefix = 'edge banding service ';
    return normalized.startsWith(prefix) ? normalized.slice(prefix.length).trim() || null : null;
}
function getLineServiceColors(line) {
    const values = [
        ...(Array.isArray(line.product_id) ? [line.product_id[1]] : []),
        ...getLineDescriptionCandidates(line.name || ''),
    ];
    return [...new Set(values.map(extractServiceColor).filter((value) => Boolean(value)))];
}
function levenshteinDistance(left, right) {
    const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
    for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
        const current = [leftIndex];
        for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
            current[rightIndex] = Math.min(current[rightIndex - 1] + 1, previous[rightIndex] + 1, previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1));
        }
        previous.splice(0, previous.length, ...current);
    }
    return previous[right.length];
}
function colorSimilarity(left, right) {
    const normalizedLeft = normalizeColor(left);
    const normalizedRight = normalizeColor(right);
    if (!normalizedLeft || !normalizedRight)
        return 0;
    if (colorsAreEquivalent(normalizedLeft, normalizedRight))
        return 1;
    const leftWords = new Set(splitColorWords(normalizedLeft));
    const rightWords = new Set(splitColorWords(normalizedRight));
    const intersection = [...leftWords].filter((word) => rightWords.has(word)).length;
    const union = new Set([...leftWords, ...rightWords]).size;
    const tokenScore = union > 0 ? intersection / union : 0;
    const editScore = 1 - levenshteinDistance(normalizedLeft, normalizedRight) /
        Math.max(normalizedLeft.length, normalizedRight.length, 1);
    const containsScore = normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)
        ? 0.86
        : 0;
    return Math.max(tokenScore, editScore, containsScore);
}
function matchSoLine(item, lines) {
    const expectedNames = item.serviceNameCandidates.map((candidate) => normalizeServiceProductName(candidate));
    const matchesExpectedName = (candidate) => expectedNames.includes(normalizeServiceProductName(candidate));
    // The linked Odoo product is authoritative. The editable line description
    // may contain a floor substitution (for example a Marble product whose note
    // says White Marble), so it must not override a valid product match.
    const productMatch = lines.find((line) => {
        const productName = Array.isArray(line.product_id) ? line.product_id[1] : '';
        return Boolean(productName && matchesExpectedName(productName));
    });
    if (productMatch) {
        return productMatch;
    }
    // Some imported/manual lines have no linked product. Retain description
    // matching as a fallback, evaluating each newline independently so an Odoo
    // multi-line description does not turn one valid name into a false mismatch.
    return (lines.find((line) => getLineDescriptionCandidates(line.name || '').some(matchesExpectedName)) || null);
}
function matchSoLines(items, lines) {
    const matches = new Map();
    const usedLineIds = new Set();
    // Preserve the deterministic exact matcher and prevent one SO line from
    // satisfying multiple extracted materials.
    for (const item of items) {
        const exact = matchSoLine(item, lines.filter((line) => !usedLineIds.has(line.id)));
        if (exact) {
            matches.set(item, exact);
            usedLineIds.add(exact.id);
        }
    }
    const unmatchedItems = items.filter((item) => !matches.has(item));
    const unmatchedLines = lines.filter((line) => !usedLineIds.has(line.id) && !line.display_type && getLineServiceColors(line).length > 0);
    // Fuzzy matching is allowed only for a complete one-to-one remainder. This
    // makes material count a safety gate and avoids guessing against extra SO
    // edging lines that may represent unrelated or substituted products.
    if (unmatchedItems.length === 0 || unmatchedItems.length !== unmatchedLines.length) {
        return matches;
    }
    const scores = unmatchedItems.map((item) => unmatchedLines.map((line) => Math.max(0, ...getLineServiceColors(line).map((color) => colorSimilarity(item.normalizedColor, color)))));
    const candidates = [];
    scores.forEach((row, itemIndex) => {
        row.forEach((score, lineIndex) => {
            if (score >= 0.72)
                candidates.push({ itemIndex, lineIndex, score });
        });
    });
    candidates.sort((left, right) => right.score - left.score);
    const usedItems = new Set();
    const usedLines = new Set();
    for (const candidate of candidates) {
        if (usedItems.has(candidate.itemIndex) || usedLines.has(candidate.lineIndex))
            continue;
        const itemAlternatives = scores[candidate.itemIndex]
            .filter((_score, index) => index !== candidate.lineIndex)
            .sort((a, b) => b - a);
        const lineAlternatives = scores
            .map((row) => row[candidate.lineIndex])
            .filter((_score, index) => index !== candidate.itemIndex)
            .sort((a, b) => b - a);
        const nextItemScore = itemAlternatives[0] || 0;
        const nextLineScore = lineAlternatives[0] || 0;
        // Close alternatives are ambiguous (for example Marble against both White
        // Marble and Black Marble), so leave them unmatched for human review.
        if (candidate.score - nextItemScore < 0.12 || candidate.score - nextLineScore < 0.12)
            continue;
        matches.set(unmatchedItems[candidate.itemIndex], unmatchedLines[candidate.lineIndex]);
        usedItems.add(candidate.itemIndex);
        usedLines.add(candidate.lineIndex);
    }
    return matches;
}
function extractEdgeBandRollColor(value) {
    const trimmed = value.trim();
    const lower = trimmed.toLowerCase();
    const prefixes = [
        'edge band roll ',
        'edge band rolls ',
        'edge banding roll ',
        'edge banding rolls ',
    ];
    const prefix = prefixes.find((entry) => lower.startsWith(entry));
    if (!prefix) {
        return null;
    }
    const remainder = trimmed.slice(prefix.length).trim();
    const parenthesizedColorMatch = remainder.match(/\(([^)]+)\)\s*$/);
    const candidateColor = parenthesizedColorMatch
        ? parenthesizedColorMatch[1]
        : remainder.replace(/\b\d+(?:\.\d+)?\s*mm\b/gi, '').trim();
    const normalized = normalizeColor(candidateColor);
    return normalized || null;
}
function extractEdgeBandRollType(value) {
    const typeMatch = value.match(/\b(36|1)\s*mm\b/i);
    return typeMatch ? `${typeMatch[1]}mm` : '1mm';
}
function computeExtractedMeters(lengthMm) {
    return Math.round(Math.max(0, lengthMm) / 1000);
}
function computeQuantityToAdd(lengthMm, soLineQuantity) {
    const usedMeters = computeExtractedMeters(lengthMm);
    const orderedMeters = Math.round(Math.max(0, Number(soLineQuantity || 0)));
    return orderedMeters - usedMeters;
}
async function resolveStockLocation(client) {
    const settings = await (0, repositories_1.getSettings)();
    const configuredId = Number(settings.stock.locationId || 0);
    const configuredName = settings.stock.locationName.trim();
    if (configuredId > 0) {
        const location = await client.getStockLocationById(configuredId);
        if (!location) {
            throw new Error(`Configured stock location ${configuredId} was not found in Odoo.`);
        }
        return {
            id: location.id,
            label: location.complete_name || location.name,
        };
    }
    if (!configuredName) {
        throw new Error('Stock location is not configured.');
    }
    const matches = await client.findStockLocationsByName(configuredName);
    if (matches.length === 0) {
        throw new Error(`Stock location "${configuredName}" was not found in Odoo.`);
    }
    if (matches.length > 1) {
        throw new Error(`Stock location "${configuredName}" is ambiguous in Odoo.`);
    }
    return {
        id: matches[0].id,
        label: matches[0].complete_name || matches[0].name,
    };
}
async function resolveComponentFromBOM(client, item, matchedLine) {
    const matchedProductId = Array.isArray(matchedLine.product_id) ? matchedLine.product_id[0] : 0;
    if (!matchedProductId) {
        return {
            found: false,
            componentName: '',
            variantId: null,
            failed: true,
            reason: `Matched Sales Order line does not have a product for ${item.expectedSoProduct}`,
        };
    }
    const product = await client.getProductVariant(matchedProductId);
    const templateId = Array.isArray(product?.product_tmpl_id) ? product.product_tmpl_id[0] : 0;
    if (!product || !templateId) {
        return {
            found: false,
            componentName: '',
            variantId: null,
            failed: true,
            reason: `Could not load the Sales Order product for ${item.expectedSoProduct}`,
        };
    }
    const bomCandidates = await client.getBomCandidatesForProduct(product.id, templateId);
    const companySpecificBoms = bomCandidates.filter((candidate) => Array.isArray(candidate.company_id));
    const scopedBomCandidates = companySpecificBoms.length > 0 ? companySpecificBoms : bomCandidates;
    const exactVariantBoms = scopedBomCandidates.filter((candidate) => Array.isArray(candidate.product_id) && candidate.product_id[0] === product.id);
    const templateBoms = scopedBomCandidates.filter((candidate) => !Array.isArray(candidate.product_id) &&
        Array.isArray(candidate.product_tmpl_id) &&
        candidate.product_tmpl_id[0] === templateId);
    const selectedBom = exactVariantBoms.length === 1
        ? exactVariantBoms[0]
        : exactVariantBoms.length > 1
            ? null
            : templateBoms.length === 1
                ? templateBoms[0]
                : null;
    if (exactVariantBoms.length > 1 || templateBoms.length > 1) {
        return {
            found: false,
            componentName: '',
            variantId: null,
            failed: true,
            reason: `Multiple BOMs matched ${item.expectedSoProduct}`,
        };
    }
    if (!selectedBom) {
        return {
            found: false,
            componentName: '',
            variantId: null,
            failed: true,
            reason: `No BOM found for ${item.expectedSoProduct}`,
        };
    }
    const bomLines = await client.getBomLines(selectedBom.id);
    const matchingLines = bomLines.filter((line) => {
        const relationLabel = Array.isArray(line.product_id)
            ? line.product_id[1]
            : Array.isArray(line.product_tmpl_id)
                ? line.product_tmpl_id[1]
                : '';
        const componentColor = extractEdgeBandRollColor(relationLabel);
        const componentType = extractEdgeBandRollType(relationLabel);
        return componentColor
            ? colorsAreEquivalent(componentColor, item.componentColor) && componentType === item.componentType
            : false;
    });
    if (matchingLines.length === 0) {
        return {
            found: false,
            componentName: '',
            variantId: null,
            failed: true,
            reason: `ATTENTION: Component missing in BOM for ${item.expectedSoProduct}`,
        };
    }
    if (matchingLines.length > 1) {
        return {
            found: false,
            componentName: '',
            variantId: null,
            failed: true,
            reason: `Multiple BOM components matched ${item.expectedSoProduct}`,
        };
    }
    const componentLine = matchingLines[0];
    if (Array.isArray(componentLine.product_id)) {
        return {
            found: true,
            componentName: componentLine.product_id[1],
            variantId: componentLine.product_id[0],
            failed: false,
            reason: '',
        };
    }
    const templateIdFromComponent = Array.isArray(componentLine.product_tmpl_id)
        ? componentLine.product_tmpl_id[0]
        : 0;
    if (!templateIdFromComponent) {
        return {
            found: false,
            componentName: '',
            variantId: null,
            failed: true,
            reason: `Could not resolve the BOM component variant for ${item.expectedSoProduct}`,
        };
    }
    const variants = await client.getProductVariantsByTemplate(templateIdFromComponent);
    const matchingVariants = variants.filter((variant) => {
        const label = variant.display_name || variant.name;
        const componentColor = extractEdgeBandRollColor(label);
        const componentType = extractEdgeBandRollType(label);
        return componentColor
            ? colorsAreEquivalent(componentColor, item.componentColor) && componentType === item.componentType
            : false;
    });
    if (matchingVariants.length !== 1) {
        return {
            found: false,
            componentName: '',
            variantId: null,
            failed: true,
            reason: `Could not resolve a unique BOM component variant for ${item.expectedSoProduct}`,
        };
    }
    return {
        found: true,
        componentName: matchingVariants[0].display_name || matchingVariants[0].name,
        variantId: matchingVariants[0].id,
        failed: false,
        reason: '',
    };
}
async function ensureSignatureStillCurrent(client, orderId, signature) {
    const settings = await (0, repositories_1.getSettings)();
    const availableFields = await client.getSaleOrderFields();
    const mappings = (0, helpers_1.resolveFieldMappings)(settings.fieldMappings, availableFields);
    const latest = await client.getSaleOrderStockHandoff(orderId, mappings);
    if (latest.signature.trim() !== signature.trim()) {
        throw new Error('The Job Summary signature changed while stock reconciliation was running.');
    }
    const unreversedProcessedItems = await (0, repositories_1.getProcessedStockVariantIds)(orderId, signature);
    if (latest.signature.trim() &&
        latest.signature.trim() === latest.stockSignature.trim() &&
        unreversedProcessedItems.length > 0) {
        throw new Error('This Job Summary has already been fully processed for stock.');
    }
}
function appendProcessingLog(existingLog, nextEntry) {
    return existingLog.trim() ? `${existingLog.trim()}\n\n${nextEntry}` : nextEntry;
}
function buildSummaryLog(result) {
    const timestamp = (0, helpers_1.formatOdooDateTime)(new Date());
    const previewLabel = result.preview ? 'Preview' : 'Process';
    const sourceLabel = result.source === 'stock_adjustment_input_json'
        ? 'Stock Adjustment Input JSON'
        : 'Latest Extracted Job Summary';
    return [
        `[${timestamp}] Stock reconciliation ${previewLabel}`,
        `Signature: ${result.signature || 'missing'}`,
        `Source: ${sourceLabel}`,
        'Usage difference calculated',
        `Total: ${result.summary.totalItems}`,
        `Processed: ${result.summary.processedCount}`,
        `Skipped: ${result.summary.skippedCount}`,
        `Failed: ${result.summary.failedCount}`,
        `Missing SO: ${result.summary.missingSoItemsCount}`,
        `Missing Component: ${result.summary.missingComponentCount}`,
        `Zero Quantity: ${result.summary.zeroQuantityCount}`,
    ].join(' | ');
}
function createBaseItemResult(item) {
    return {
        extractedColor: item.extractedColor,
        normalizedColor: toTitleCase(item.normalizedColor),
        lengthMm: item.lengthMm,
        usedMeters: computeExtractedMeters(item.lengthMm),
        orderedMeters: null,
        expectedSoProduct: item.expectedSoProduct,
        soMatched: false,
        matchedSoProductName: '',
        moMatched: false,
        moState: '',
        componentFound: false,
        componentName: '',
        variantId: null,
        quantityToAddMeters: 0,
        currentStock: null,
        newStock: null,
        status: 'preview',
        skipReason: '',
    };
}
async function buildStockRun(orderId) {
    const { client, settings } = await getConfiguredClient();
    const availableFields = await client.getSaleOrderFields();
    const mappings = (0, helpers_1.resolveFieldMappings)(settings.fieldMappings, availableFields);
    const requiredMappings = [
        'signatureField',
        'stockProcessedField',
        'stockSignatureField',
        'deltaJsonField',
        'logField',
    ];
    const missingMappings = requiredMappings.filter((key) => !mappings[key].trim());
    if (missingMappings.length > 0) {
        throw new Error(`Required stock field mappings are unavailable: ${missingMappings.join(', ')}`);
    }
    const handoff = await client.getSaleOrderStockHandoff(orderId, mappings);
    const latestExtracted = await (0, repositories_1.getLatestExtractedResultByOrderId)(orderId);
    let source = 'latest_extraction';
    let sourceItems = [];
    let signature = handoff.signature.trim();
    const preferLatestExtraction = shouldPreferLatestExtraction(handoff.stockAdjustmentInputJson, signature, latestExtracted);
    if (preferLatestExtraction && latestExtracted) {
        sourceItems = latestExtracted.resultJson.items || [];
        signature = latestExtracted.pdfSignature || signature;
        source = 'latest_extraction';
    }
    else if (handoff.stockAdjustmentInputJson.trim()) {
        sourceItems = extractItemsFromJson(handoff.stockAdjustmentInputJson);
        source = 'stock_adjustment_input_json';
    }
    else if (latestExtracted) {
        sourceItems = latestExtracted.resultJson.items || [];
        signature = signature || latestExtracted.pdfSignature || '';
    }
    if (!signature.trim()) {
        throw new Error('No Job Summary signature is available for stock reconciliation.');
    }
    if (!sourceItems.length) {
        throw new Error('No Job Summary edge banding items are available for stock reconciliation.');
    }
    return {
        client,
        orderName: handoff.orderName,
        signature,
        source,
        handoffLog: handoff.processingLog,
        items: aggregateItems(sourceItems),
        mappings,
    };
}
async function postMissingItemsToActivities(client, orderId, missingProducts, salespersonUserId) {
    if (!missingProducts.length) {
        return;
    }
    const uniqueProducts = [...new Set(missingProducts)];
    const dbAdmin = await client.findUserByLoginOrEmail(env_1.env.DBADMIN_EMAIL);
    const assigneeIds = [...new Set([salespersonUserId || null, dbAdmin?.id || null].filter((id) => Boolean(id)))];
    if (!assigneeIds.length) {
        await (0, logService_1.logEvent)('warn', 'Skipped missing edge banding activity because no assignees were resolved', {
            orderId,
            missingProducts: uniqueProducts,
        });
        return;
    }
    const existingActivities = await (0, odooActivityService_1.findOpenActivities)(client, {
        modelName: 'sale.order',
        recordId: orderId,
        summary: MISSING_EDGE_BANDING_ACTIVITY_SUMMARY,
    });
    const existingAssigneeIds = new Set(existingActivities
        .map((activity) => Array.isArray(activity.user_id) ? Number(activity.user_id[0]) : null)
        .filter((id) => Boolean(id)));
    for (const userId of assigneeIds) {
        if (existingAssigneeIds.has(userId))
            continue;
        await (0, odooActivityService_1.createTodoActivity)(client, {
            modelName: 'sale.order',
            recordId: orderId,
            userId,
            summary: MISSING_EDGE_BANDING_ACTIVITY_SUMMARY,
            noteLines: [
                'ATTENTION: The Sales Order has missing edge banding item(s) found in the Job Summary.',
                `Missing item(s): ${uniqueProducts.join(', ')}`,
            ],
        });
    }
}
async function logMissingItemsToChatter(orderId, missingProducts) {
    const { client } = await getConfiguredClient();
    const order = await client.getSaleOrder(orderId);
    const salespersonUserId = Array.isArray(order.user_id) ? Number(order.user_id[0]) : null;
    await postMissingItemsToActivities(client, orderId, missingProducts, salespersonUserId);
}
async function resolveAllowedNotificationRecipient(client, kind) {
    const user = await client.findUserByNameLoginOrEmail(ALLOWED_NOTIFICATION_USER_NAME);
    if (!user) {
        await (0, logService_1.logEvent)('warn', 'Allowed stock alert user could not be resolved in Odoo', {
            kind,
            allowedUser: ALLOWED_NOTIFICATION_USER_NAME,
        });
        return null;
    }
    return {
        configuredLogin: ALLOWED_NOTIFICATION_USER_NAME,
        userName: user.name || user.login,
        partnerId: user.partnerId,
    };
}
async function processStockItem(client, orderId, item, lines, location, signature, preview, processedVariantIds, matchedLineOverride) {
    const result = createBaseItemResult(item);
    const matchedLine = matchedLineOverride === undefined ? matchSoLine(item, lines) : matchedLineOverride;
    if (!matchedLine) {
        result.status = 'skipped';
        result.skipReason = 'No matching Sales Order line';
        return result;
    }
    result.soMatched = true;
    result.matchedSoProductName =
        (Array.isArray(matchedLine.product_id) ? matchedLine.product_id[1] : '') || matchedLine.name;
    result.orderedMeters = Math.round(Math.max(0, Number(matchedLine.product_uom_qty || 0)));
    const manufacturingOrders = await client.getManufacturingOrdersBySaleLineId(matchedLine.id);
    const readyManufacturingOrder = manufacturingOrders.find((order) => (0, manufacturingStatus_1.isManufacturingOrderReady)(order.state)) || null;
    const latestManufacturingOrder = readyManufacturingOrder || manufacturingOrders[0] || null;
    if (!latestManufacturingOrder) {
        result.status = 'skipped';
        result.skipReason = 'No matching Manufacturing Order for Sales Order line';
        return result;
    }
    result.moMatched = true;
    result.moState = latestManufacturingOrder.state;
    if (!readyManufacturingOrder) {
        result.status = 'skipped';
        result.skipReason = 'Manufacturing Order is not in progress or done';
        return result;
    }
    const quantityToAddMeters = computeQuantityToAdd(item.lengthMm, matchedLine.product_uom_qty);
    result.quantityToAddMeters = quantityToAddMeters;
    if (quantityToAddMeters <= 0) {
        result.status = 'skipped';
        result.skipReason =
            quantityToAddMeters < 0
                ? `Job Summary usage exceeds Sales Order quantity for ${result.normalizedColor}`
                : 'No unused quantity to add';
        return result;
    }
    const component = await resolveComponentFromBOM(client, item, matchedLine);
    result.componentFound = component.found;
    result.componentName = component.componentName;
    result.variantId = component.variantId;
    if (component.failed || !component.variantId) {
        result.status = 'failed';
        result.skipReason = component.reason || 'Could not resolve BOM component';
        return result;
    }
    if (processedVariantIds.has(component.variantId)) {
        result.status = 'skipped';
        result.skipReason = 'Already processed for this Job Summary signature';
        return result;
    }
    const quants = await client.getStockQuants(component.variantId, location.id);
    if (quants.length > 1) {
        result.status = 'failed';
        result.skipReason = `Multiple stock quants found at ${location.label}`;
        return result;
    }
    const currentStock = Number(quants[0]?.quantity || 0);
    result.currentStock = currentStock;
    result.newStock = currentStock + quantityToAddMeters;
    if (preview) {
        result.status = 'preview';
        result.skipReason = '';
        return result;
    }
    await ensureSignatureStillCurrent(client, orderId, signature);
    await client.adjustStockAtLocation(component.variantId, location.id, result.newStock);
    processedVariantIds.add(component.variantId);
    result.status = 'processed';
    result.skipReason = '';
    return result;
}
async function processAllItems(orderId, options = {}) {
    const preview = Boolean(options.preview);
    const run = await buildStockRun(orderId);
    const { client } = run;
    const lockSkipped = !preview && (await (0, repositories_1.isStockProcessingLocked)(orderId, run.signature));
    const initialResult = {
        orderId,
        orderName: run.orderName,
        signature: run.signature,
        preview,
        source: run.source,
        items: [],
        summary: {
            totalItems: run.items.length,
            processedCount: 0,
            skippedCount: 0,
            failedCount: 0,
            missingSoItemsCount: 0,
            missingComponentCount: 0,
            zeroQuantityCount: 0,
        },
        missingSoProducts: [],
        alreadyProcessed: false,
        lockSkipped,
        writeBackApplied: false,
        statusMessage: '',
    };
    const availableFields = await client.getSaleOrderFields();
    const mappings = (0, helpers_1.resolveFieldMappings)((await (0, repositories_1.getSettings)()).fieldMappings, availableFields);
    const handoff = await client.getSaleOrderStockHandoff(orderId, mappings);
    const unreversedProcessedItems = await (0, repositories_1.getProcessedStockVariantIds)(orderId, run.signature);
    if (handoff.signature.trim() &&
        handoff.signature.trim() === handoff.stockSignature.trim() &&
        unreversedProcessedItems.length > 0) {
        return {
            ...initialResult,
            alreadyProcessed: true,
            statusMessage: 'This Job Summary signature already matches the stored stock reconciliation signature.',
        };
    }
    if (lockSkipped) {
        return {
            ...initialResult,
            statusMessage: 'Stock reconciliation skipped because another run is already in progress for this Sales Order.',
        };
    }
    const lockAcquired = preview ? true : await (0, repositories_1.acquireStockProcessingLock)(orderId, run.signature);
    if (!preview && !lockAcquired) {
        return {
            ...initialResult,
            lockSkipped: true,
            statusMessage: 'Stock reconciliation skipped because another run acquired the lock first.',
        };
    }
    try {
        const location = await resolveStockLocation(client);
        const lines = await client.getSaleOrderLines(orderId);
        const missingComponentAlertRecipient = preview
            ? null
            : await resolveAllowedNotificationRecipient(client, 'missing_component');
        const processedVariantIds = new Set(await (0, repositories_1.getProcessedStockVariantIds)(orderId, run.signature));
        const matchedLines = matchSoLines(run.items, lines);
        const results = [];
        const missingSoProducts = [];
        const componentMissingMessages = new Set();
        for (const item of run.items) {
            const result = await processStockItem(client, orderId, item, lines, location, run.signature, preview, processedVariantIds, matchedLines.get(item) || null);
            if (!preview && result.status === 'processed' && result.variantId) {
                await (0, repositories_1.insertProcessedStockItem)({
                    orderId,
                    extractionSignature: run.signature,
                    variantId: result.variantId,
                    normalizedColor: result.normalizedColor,
                    quantityAddedMeters: result.quantityToAddMeters,
                    historyId: (await (0, repositories_1.getLatestExtractedResultByOrderId)(orderId))?.historyId || null,
                });
            }
            if (result.status === 'skipped' && result.skipReason === 'No matching Sales Order line') {
                missingSoProducts.push(result.expectedSoProduct);
            }
            if (result.status === 'failed' && result.skipReason.startsWith('ATTENTION: Component missing in BOM')) {
                componentMissingMessages.add(result.skipReason);
            }
            results.push(result);
        }
        const summary = {
            totalItems: results.length,
            processedCount: results.filter((item) => item.status === 'processed').length,
            skippedCount: results.filter((item) => item.status === 'skipped').length,
            failedCount: results.filter((item) => item.status === 'failed').length,
            missingSoItemsCount: results.filter((item) => item.status === 'skipped' && item.skipReason === 'No matching Sales Order line').length,
            missingComponentCount: results.filter((item) => item.skipReason.startsWith('ATTENTION: Component missing in BOM')).length,
            zeroQuantityCount: results.filter((item) => item.status === 'skipped' && item.skipReason === 'No unused quantity to add').length,
        };
        const alreadyProcessedOnly = !preview &&
            results.length > 0 &&
            results.every((item) => item.status === 'skipped' && item.skipReason === 'Already processed for this Job Summary signature');
        const finalResult = {
            ...initialResult,
            items: results,
            summary,
            alreadyProcessed: alreadyProcessedOnly,
            missingSoProducts,
            statusMessage: preview
                ? 'Stock reconciliation preview completed. No stock, Odoo fields, chatter, or processed-item records were changed.'
                : alreadyProcessedOnly
                    ? 'This Job Summary signature was already processed locally; no stock changes were applied.'
                    : summary.failedCount > 0
                        ? 'Stock reconciliation finished with failures.'
                        : 'Stock reconciliation completed successfully.',
        };
        if (!preview) {
            if (alreadyProcessedOnly) {
                const payload = {};
                if (!handoff.stockProcessed) {
                    payload[mappings.stockProcessedField] = true;
                }
                if (handoff.stockSignature.trim() !== run.signature.trim()) {
                    payload[mappings.stockSignatureField] = run.signature;
                }
                if (Object.keys(payload).length > 0) {
                    const writeResult = await client.safeUpdateSaleOrder(orderId, payload, availableFields);
                    if (!writeResult.success) {
                        throw new Error(writeResult.message);
                    }
                    finalResult.writeBackApplied = true;
                }
            }
            else {
                if (missingSoProducts.length > 0) {
                    const order = await client.getSaleOrder(orderId);
                    const salespersonUserId = Array.isArray(order.user_id) ? Number(order.user_id[0]) : null;
                    await postMissingItemsToActivities(client, orderId, missingSoProducts, salespersonUserId);
                }
                for (const message of componentMissingMessages) {
                    if (!missingComponentAlertRecipient?.partnerId) {
                        await (0, logService_1.logEvent)('warn', 'Skipped missing component chatter alert because the allowed notification user was not resolved', {
                            orderId,
                            allowedUser: ALLOWED_NOTIFICATION_USER_NAME,
                            message,
                        });
                        continue;
                    }
                    const recipientPrefix = missingComponentAlertRecipient?.userName
                        ? `${missingComponentAlertRecipient.userName}\n`
                        : '';
                    await client.postChatterAlert(orderId, `${recipientPrefix}${message}`, [missingComponentAlertRecipient.partnerId]);
                }
                const summaryLog = buildSummaryLog(finalResult);
                const payload = {
                    [mappings.logField]: appendProcessingLog(handoff.processingLog, summaryLog),
                };
                if (summary.failedCount === 0) {
                    payload[mappings.stockProcessedField] = true;
                    payload[mappings.stockSignatureField] = run.signature;
                }
                const writeResult = await client.safeUpdateSaleOrder(orderId, payload, availableFields);
                if (!writeResult.success) {
                    throw new Error(writeResult.message);
                }
                finalResult.writeBackApplied = true;
            }
        }
        await (0, logService_1.logEvent)('info', preview ? 'Stock reconciliation preview completed' : 'Stock reconciliation completed', {
            orderId,
            orderName: run.orderName,
            signature: run.signature,
            preview,
            source: run.source,
            summary: finalResult.summary,
            missingSoProducts,
            missingEdgeBandingActivity: missingSoProducts.length > 0,
            missingComponentAlertRecipient: missingComponentAlertRecipient?.configuredLogin || null,
            items: finalResult.items.map((item) => ({
                extractedColor: item.extractedColor,
                normalizedColor: item.normalizedColor,
                length_mm: item.lengthMm,
                usedMeters: item.usedMeters,
                orderedMeters: item.orderedMeters,
                quantityToAddMeters: item.quantityToAddMeters,
                expectedSoProduct: item.expectedSoProduct,
                matchedSoProductName: item.matchedSoProductName,
                moMatched: item.moMatched,
                moState: item.moState,
                componentName: item.componentName,
                variantId: item.variantId,
                currentStock: item.currentStock,
                newStock: item.newStock,
                status: item.status,
                skipReason: item.skipReason,
            })),
        });
        return finalResult;
    }
    catch (error) {
        await (0, logService_1.logEvent)('error', preview ? 'Stock reconciliation preview failed' : 'Stock reconciliation failed', {
            orderId,
            signature: run.signature,
            preview,
            error: error instanceof Error ? error.message : 'Unknown stock reconciliation failure.',
        });
        throw error;
    }
    finally {
        if (!preview) {
            await (0, repositories_1.releaseStockProcessingLock)(orderId, run.signature);
        }
    }
}
async function previewSaleOrderStockProcessing(orderId) {
    return processAllItems(orderId, { preview: true });
}
async function processSaleOrderStock(orderId) {
    return processAllItems(orderId, { preview: false });
}
async function reverseSaleOrderStockAdditions(orderId) {
    const { client, settings } = await getConfiguredClient();
    const availableFields = await client.getSaleOrderFields();
    const mappings = (0, helpers_1.resolveFieldMappings)(settings.fieldMappings, availableFields);
    const handoff = await client.getSaleOrderStockHandoff(orderId, mappings);
    const reverseLockSignature = 'reverse-all';
    if (await (0, repositories_1.isStockProcessingLocked)(orderId, reverseLockSignature)) {
        throw new Error('A stock reversal is already in progress for this Sales Order.');
    }
    const lockAcquired = await (0, repositories_1.acquireStockProcessingLock)(orderId, reverseLockSignature);
    if (!lockAcquired) {
        throw new Error('Could not acquire the stock reversal lock for this Sales Order.');
    }
    try {
        const location = await resolveStockLocation(client);
        const items = await (0, repositories_1.getUnreversedProcessedStockItemsForOrder)(orderId);
        let reversedCount = 0;
        let affectedVariants = 0;
        if (items.length > 0) {
            const grouped = new Map();
            for (const item of items) {
                const existing = grouped.get(item.variantId) || { totalMeters: 0, itemIds: [], colors: [] };
                existing.totalMeters += item.quantityAddedMeters;
                existing.itemIds.push(item.id);
                if (!existing.colors.includes(item.normalizedColor)) {
                    existing.colors.push(item.normalizedColor);
                }
                grouped.set(item.variantId, existing);
            }
            for (const [variantId, group] of grouped.entries()) {
                const quants = await client.getStockQuants(variantId, location.id);
                if (quants.length > 1) {
                    throw new Error(`Multiple stock quants were found for variant ${variantId} at ${location.label}.`);
                }
                const currentStock = Number(quants[0]?.quantity || 0);
                const newStock = currentStock - group.totalMeters;
                if (newStock < 0) {
                    throw new Error(`Cannot reverse ${group.totalMeters}m for variant ${variantId}; current stock at ${location.label} is only ${currentStock}.`);
                }
                await client.adjustStockAtLocation(variantId, location.id, newStock);
                for (const itemId of group.itemIds) {
                    await (0, repositories_1.markProcessedStockItemReversed)(itemId, orderId);
                }
            }
            reversedCount = items.length;
            affectedVariants = grouped.size;
        }
        const summaryMessage = items.length > 0
            ? `Reversed ${reversedCount} recorded stock addition(s) across ${affectedVariants} variant(s).`
            : 'No unreversed stock additions were recorded, but the stock reconciliation proof was cleared.';
        const payload = {
            [mappings.logField]: appendProcessingLog(handoff.processingLog, `[${(0, helpers_1.formatOdooDateTime)(new Date())}] Stock reversal | ${summaryMessage}`),
            [mappings.stockProcessedField]: false,
            [mappings.stockSignatureField]: '',
        };
        const writeBack = await client.safeUpdateSaleOrder(orderId, payload, availableFields);
        if (!writeBack.success) {
            throw new Error(writeBack.message);
        }
        await (0, logService_1.logEvent)('warn', 'Stock additions reversed', {
            orderId,
            reversedCount,
            affectedVariants,
            itemIds: items.map((item) => item.id),
        });
        return {
            orderId,
            reversedCount,
            affectedVariants,
            message: summaryMessage,
        };
    }
    finally {
        await (0, repositories_1.releaseStockProcessingLock)(orderId, reverseLockSignature);
    }
}
