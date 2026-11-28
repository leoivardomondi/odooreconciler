"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PIE_CHART_PALETTE = void 0;
exports.drawPdfPieChart = drawPdfPieChart;
exports.PIE_CHART_PALETTE = [
    '#2563eb', // Royal Blue
    '#059669', // Emerald
    '#7c3aed', // Violet
    '#d97706', // Amber
    '#0891b2', // Cyan
    '#db2777', // Rose
    '#4f46e5', // Indigo
    '#65a30d', // Lime
];
/**
 * Draws a crisp vector pie or donut chart using PDFKit path primitives,
 * with optional white inner cutout, slice percentage labels, and side legend.
 */
function drawPdfPieChart(doc, options) {
    const { cx, cy, radius, slices } = options;
    const innerRadius = Math.max(0, Math.min(options.innerRadius || 0, radius - 6));
    const positiveSlices = slices.filter((s) => Number(s.value) > 0);
    const total = positiveSlices.reduce((sum, s) => sum + Number(s.value), 0);
    doc.save();
    if (total <= 0) {
        // Empty ring state
        doc.circle(cx, cy, radius).fill('#e2e8f0');
        if (innerRadius > 0) {
            doc.circle(cx, cy, innerRadius).fill('#ffffff');
        }
        doc.font('Helvetica-Bold').fontSize(8).fillColor('#64748b')
            .text(options.emptyLabel || 'No data', cx - radius + 6, cy - 5, { width: (radius - 6) * 2, align: 'center' });
    }
    else if (positiveSlices.length === 1) {
        // Single 100% slice
        const only = positiveSlices[0];
        doc.circle(cx, cy, radius).fill(only.color);
        doc.circle(cx, cy, radius).lineWidth(1.2).strokeColor('#ffffff').stroke();
        if (innerRadius > 0) {
            doc.circle(cx, cy, innerRadius).fill('#ffffff');
        }
        else {
            doc.font('Helvetica-Bold').fontSize(9).fillColor('#ffffff')
                .text('100%', cx - 20, cy - 5, { width: 40, align: 'center' });
        }
    }
    else {
        let startAngle = -Math.PI / 2; // Start at 12 o'clock
        for (const slice of positiveSlices) {
            const fraction = slice.value / total;
            const sweep = fraction * Math.PI * 2;
            const endAngle = startAngle + sweep;
            const steps = Math.max(12, Math.ceil((sweep * 180) / Math.PI / 2));
            doc.moveTo(cx, cy);
            for (let i = 0; i <= steps; i += 1) {
                const angle = startAngle + (sweep * i) / steps;
                const px = cx + Math.cos(angle) * radius;
                const py = cy + Math.sin(angle) * radius;
                doc.lineTo(px, py);
            }
            doc.closePath();
            doc.fillAndStroke(slice.color, '#ffffff');
            // Percentage label inside slice if large enough (>= 8%)
            if (fraction >= 0.08) {
                const midAngle = startAngle + sweep / 2;
                const labelR = innerRadius > 0
                    ? innerRadius + (radius - innerRadius) * 0.54
                    : radius * 0.62;
                const lx = cx + Math.cos(midAngle) * labelR;
                const ly = cy + Math.sin(midAngle) * labelR;
                const pct = Math.round(fraction * 100);
                doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#ffffff')
                    .text(`${pct}%`, lx - 14, ly - 4, { width: 28, align: 'center', lineBreak: false });
            }
            startAngle = endAngle;
        }
        // Punch center donut cutout
        if (innerRadius > 0) {
            doc.circle(cx, cy, innerRadius).fill('#ffffff');
        }
    }
    // Center text inside donut hole
    if (innerRadius >= 18 && total > 0 && (options.centerTopText || options.centerBottomText)) {
        const innerW = innerRadius * 1.85;
        if (options.centerTopText) {
            doc.font('Helvetica-Bold').fontSize(11).fillColor('#0f172a')
                .text(options.centerTopText, cx - innerW / 2, cy - 10, { width: innerW, align: 'center', lineBreak: false });
        }
        if (options.centerBottomText) {
            doc.font('Helvetica').fontSize(6.5).fillColor('#64748b')
                .text(options.centerBottomText, cx - innerW / 2, cy + 3, { width: innerW, align: 'center', lineBreak: false });
        }
    }
    doc.restore();
    let bottomY = cy + radius + 6;
    // Optional right-side legend
    if (options.legend) {
        const { x, width } = options.legend;
        let ly = options.legend.y;
        const rowH = options.legend.rowHeight || 24;
        if (options.legend.title) {
            doc.font('Helvetica-Bold').fontSize(8).fillColor('#17162d')
                .text(options.legend.title, x, ly, { width });
            ly += 14;
        }
        const legendTotal = slices.reduce((sum, s) => sum + Math.max(0, Number(s.value) || 0), 0);
        for (const slice of slices) {
            const val = Math.max(0, Number(slice.value) || 0);
            const pct = legendTotal > 0 ? Math.round((val / legendTotal) * 100) : 0;
            // Swatch dot
            doc.roundedRect(x, ly + 3, 8, 8, 2).fill(val > 0 ? slice.color : '#cbd5e1');
            // Badge on right if provided
            const badgeW = slice.badgeText ? 68 : 0;
            const pctW = 34;
            const labelW = Math.max(60, width - 14 - pctW - badgeW - (badgeW ? 6 : 0));
            doc.font('Helvetica-Bold').fontSize(7.8).fillColor('#0f172a')
                .text(slice.label, x + 13, ly + 1, { width: labelW, height: 10, ellipsis: true });
            if (slice.sublabel) {
                doc.font('Helvetica').fontSize(6.4).fillColor('#64748b')
                    .text(slice.sublabel, x + 13, ly + 11, { width: labelW + pctW, height: 9, ellipsis: true });
            }
            doc.font('Helvetica-Bold').fontSize(8).fillColor(val > 0 ? '#0f172a' : '#dc2626')
                .text(`${pct}%`, x + 13 + labelW, ly + 1, { width: pctW, align: 'right', lineBreak: false });
            if (slice.badgeText) {
                const bx = x + width - badgeW;
                doc.roundedRect(bx, ly + 1, badgeW, 13, 4).fill(slice.badgeBg || '#f1f5f9');
                doc.font('Helvetica-Bold').fontSize(6.3).fillColor(slice.badgeColor || '#334155')
                    .text(slice.badgeText, bx + 2, ly + 4, { width: badgeW - 4, align: 'center', lineBreak: false });
            }
            ly += rowH;
        }
        bottomY = Math.max(bottomY, ly + 2);
    }
    return { bottomY };
}
