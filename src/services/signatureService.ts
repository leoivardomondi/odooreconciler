import { createHash } from 'node:crypto';
import { SignatureComparisonResult } from '../models/types';

export function computePdfSignature(pdfBuffer: Buffer): string {
  return createHash('sha256').update(pdfBuffer).digest('hex');
}

export function compareSignature(
  computed: string | null | undefined,
  stored: string | null | undefined,
): SignatureComparisonResult {
  const normalizedComputed = String(computed || '').trim();
  const normalizedStored = String(stored || '').trim();

  if (!normalizedStored) {
    return 'missing';
  }

  return normalizedComputed === normalizedStored ? 'match' : 'different';
}

export function getSignatureComparisonLabel(
  value: SignatureComparisonResult | null,
): string {
  if (value === 'match') {
    return 'MATCH';
  }

  if (value === 'different') {
    return 'DIFFERENT';
  }

  if (value === 'missing') {
    return 'MISSING IN ODOO';
  }

  return 'NOT COMPARED';
}
