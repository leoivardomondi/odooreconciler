export function normalizeBoardProductName(value: string | null | undefined): string {
  return String(value || '').toLowerCase().replace(/[×*]/g, ' x ').replace(/\s+/g, ' ').trim();
}

export function isBoardProductName(value: string | null | undefined): boolean {
  const name = normalizeBoardProductName(value);
  if (!name) return false;

  // Services and edge-banding materials are never physical boards.
  if (/\b(service|services)\b/.test(name) || name.includes('edge band') || name.includes('edgeband') || name.includes('edging band')) {
    return false;
  }

  // Material and product-family terms found in the Odoo Goods / Boards export.
  if (/\b(board|boards|panel|panels|particle|chipboard|mdf|waterproof|backer|ply|plywood|marine)\b/.test(name)) return true;
  if (/\b(eco board|fixo board|block board|marble sheet|off cuts|offcuts)\b/.test(name)) return true;

  // Some board colors omit the material family and are named only by thickness,
  // for example "Congo 18mm", "Honey Bee 18mm", and "Mahogany 20mm".
  return /\b(?:3|4|6|8|9|12|15|16|18|20|25|30|36)\s*mm\b/.test(name);
}
