"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeBoardProductName = normalizeBoardProductName;
exports.isBoardProductName = isBoardProductName;
exports.isStockExemptEdgeBandingService = isStockExemptEdgeBandingService;
exports.extractBoardAttributes = extractBoardAttributes;
exports.areSameColorFamily = areSameColorFamily;
exports.detectBoardMismatch = detectBoardMismatch;
exports.scoreBoardLineAgainstMaterial = scoreBoardLineAgainstMaterial;
exports.assignBoardLinesToSheetMaterials = assignBoardLinesToSheetMaterials;
function normalizeBoardProductName(value) {
    return String(value || '').toLowerCase().replace(/[×*]/g, ' x ').replace(/\s+/g, ' ').trim();
}
function isBoardProductName(value) {
    const name = normalizeBoardProductName(value);
    if (!name)
        return false;
    // Services and edge-banding materials are never physical boards.
    if (/\b(service|services)\b/.test(name) || name.includes('edge band') || name.includes('edgeband') || name.includes('edging band')) {
        return false;
    }
    // Material and product-family terms found in the Odoo Goods / Boards export.
    if (/\b(board|boards|panel|panels|particle|chipboard|mdf|waterproof|backer|ply|plywood|marine)\b/.test(name))
        return true;
    if (/\b(eco board|fixo board|block board|marble sheet|off cuts|offcuts)\b/.test(name))
        return true;
    // Some board colors omit the material family and are named only by thickness,
    // for example "Congo 18mm", "Honey Bee 18mm", and "Mahogany 20mm".
    return /\b(?:3|4|6|8|9|12|15|16|18|20|25|30|36)\s*mm\b/.test(name);
}
function isStockExemptEdgeBandingService(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized.includes('edge banding service') || normalized.includes('edging banding service');
}
function extractBoardAttributes(value) {
    const rawName = String(value || '').trim();
    const normalized = normalizeBoardProductName(rawName);
    const thickMatch = normalized.match(/\b(\d+(?:\.\d+)?)\s*mm\b/);
    const thickness = thickMatch ? `${thickMatch[1]}mm` : null;
    const thicknessMm = thickMatch ? parseFloat(thickMatch[1]) : null;
    let substrate = 'other';
    if (/\b(hardboard|backer)\b/.test(normalized)) {
        substrate = 'hardboard';
    }
    else if (/\b(mdf|medium density fiberboard|hdf)\b/.test(normalized)) {
        substrate = 'mdf';
    }
    else if (/\b(waterproof|water-proof|wpc|pvc)\b/.test(normalized)) {
        substrate = 'waterproof';
    }
    else if (/\b(particle|chipboard|pb|mfc)\b/.test(normalized)) {
        substrate = 'particle';
    }
    else if (/\b(ply|plywood|marine)\b/.test(normalized)) {
        substrate = 'plywood';
    }
    else if (/\b(block board|blockboard)\b/.test(normalized)) {
        substrate = 'block_board';
    }
    else if (/\b(eco board|fixo board)\b/.test(normalized)) {
        substrate = 'eco_board';
    }
    const color = normalized
        .replace(/\b\d+(?:\.\d+)?\s*mm\b/g, ' ')
        .replace(/\b\d+\s*[xX]\s*\d+\b/g, ' ')
        .replace(/\b(mdf|medium density fiberboard|hdf|particle board|particle|chipboard|pb|mfc|plywood|ply|marine|block board|blockboard|eco board|fixo board|hardboard|backer|waterproof|water-proof|wpc|pvc)\b/g, ' ')
        .replace(/\b(board|boards|sheet|sheets|panel|panels|wood|timber|finish|standard|gloss|matt|embossed|textured|egger|kronospan|alvic)\b/g, ' ')
        .replace(/[^a-zA-Z0-9\s-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toUpperCase();
    return {
        rawName,
        thickness,
        thicknessMm,
        substrate,
        colorFamily: color,
    };
}
function areSameColorFamily(colorA, colorB) {
    if (!colorA || !colorB)
        return false;
    const a = colorA.trim().toUpperCase();
    const b = colorB.trim().toUpperCase();
    if (!a || !b)
        return false;
    if (a === b)
        return true;
    if (a.length >= 3 && b.length >= 3) {
        if (a.includes(b) || b.includes(a))
            return true;
    }
    return false;
}
function detectBoardMismatch(requiredName, loggedName) {
    const reqAttr = extractBoardAttributes(requiredName);
    const logAttr = extractBoardAttributes(loggedName);
    if (!isBoardProductName(requiredName) || !isBoardProductName(loggedName)) {
        return null;
    }
    const sameColor = areSameColorFamily(reqAttr.colorFamily, logAttr.colorFamily);
    if (!sameColor) {
        return null;
    }
    const substrateDiff = reqAttr.substrate !== 'other' &&
        logAttr.substrate !== 'other' &&
        reqAttr.substrate !== logAttr.substrate;
    const sizeDiff = reqAttr.thicknessMm !== null &&
        logAttr.thicknessMm !== null &&
        Math.abs(reqAttr.thicknessMm - logAttr.thicknessMm) > 0.1;
    if (!substrateDiff && !sizeDiff) {
        return null;
    }
    let mismatchType = 'substrate';
    if (substrateDiff && sizeDiff) {
        mismatchType = 'substrate_and_size';
    }
    else if (sizeDiff) {
        mismatchType = 'size';
    }
    const substrateLabels = {
        mdf: 'MDF',
        particle: 'Particle Board',
        plywood: 'Plywood',
        block_board: 'Block Board',
        eco_board: 'Eco Board',
        hardboard: 'Hardboard',
        waterproof: 'Waterproof Board',
        other: 'Other Substrate',
    };
    const reasons = [];
    if (substrateDiff) {
        reasons.push(`Substrate mismatch: required ${substrateLabels[reqAttr.substrate]} vs logged ${substrateLabels[logAttr.substrate]}`);
    }
    if (sizeDiff) {
        reasons.push(`Thickness mismatch: required ${reqAttr.thickness || 'unspecified'} vs logged ${logAttr.thickness || 'unspecified'}`);
    }
    return {
        hasMismatch: true,
        mismatchType,
        requiredAttributes: reqAttr,
        loggedAttributes: logAttr,
        description: reasons.join('; '),
    };
}
function scoreBoardLineAgainstMaterial(lineName, material) {
    const normLine = normalizeBoardProductName(lineName);
    const normMat = normalizeBoardProductName(material.name);
    const lineAttr = extractBoardAttributes(lineName);
    const matAttr = extractBoardAttributes(material.name);
    let score = 0;
    // 1. Thickness check
    const targetThickness = material.thickness_mm ?? matAttr.thicknessMm;
    if (targetThickness && lineAttr.thicknessMm) {
        if (Math.abs(targetThickness - lineAttr.thicknessMm) <= 0.1) {
            score += 30;
        }
        else {
            score -= 80;
        }
    }
    // 2. Substrate check
    if (matAttr.substrate !== 'other' && lineAttr.substrate !== 'other') {
        const isBackerPair = (normLine.includes('backer') || lineAttr.substrate === 'hardboard') &&
            (normMat.includes('backer') || matAttr.substrate === 'hardboard') &&
            ((lineAttr.substrate === 'mdf' && matAttr.substrate === 'hardboard') ||
                (lineAttr.substrate === 'hardboard' && matAttr.substrate === 'mdf') ||
                lineAttr.substrate === matAttr.substrate);
        if (matAttr.substrate === lineAttr.substrate || isBackerPair) {
            score += 50;
        }
        else {
            score -= 100;
        }
    }
    // 3. Keyword / Material term checks
    const matWords = normMat
        .split(/[\s_\-/]+/)
        .filter((w) => w.length > 2 &&
        !['board', 'boards', 'sheet', 'sheets', 'panel', 'panels', 'cutting'].includes(w));
    for (const word of matWords) {
        if (normLine.includes(word)) {
            score += 15;
        }
    }
    // 4. Color family check
    if (matAttr.colorFamily && lineAttr.colorFamily) {
        if (areSameColorFamily(matAttr.colorFamily, lineAttr.colorFamily)) {
            score += 20;
        }
    }
    return score;
}
function assignBoardLinesToSheetMaterials(lines, sheetMaterials, getLineDisplayName) {
    const result = new Map();
    for (const mat of sheetMaterials) {
        result.set(mat, []);
    }
    if (sheetMaterials.length === 0)
        return result;
    const boardLines = lines.filter((l) => {
        const displayName = getLineDisplayName(l);
        if (!isBoardProductName(displayName))
            return false;
        if (/example\s+board/i.test(displayName))
            return false;
        if (/optimis?ed\s+panels?/i.test(displayName))
            return false;
        return true;
    });
    if (sheetMaterials.length === 1) {
        const mat = sheetMaterials[0];
        result.set(mat, boardLines);
        return result;
    }
    for (const line of boardLines) {
        const displayName = getLineDisplayName(line);
        let bestMat = null;
        let bestScore = 0;
        for (const mat of sheetMaterials) {
            const score = scoreBoardLineAgainstMaterial(displayName, mat);
            if (score > bestScore) {
                bestScore = score;
                bestMat = mat;
            }
        }
        if (bestMat && bestScore > 0) {
            result.get(bestMat)?.push(line);
        }
    }
    return result;
}
