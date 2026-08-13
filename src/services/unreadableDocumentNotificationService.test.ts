import assert from 'node:assert/strict';
import test from 'node:test';
import { isUnreadableDocument } from './unreadableDocumentNotificationService';

test('recognizes a faint document with no readable invoice fields', () => {
  assert.equal(isUnreadableDocument({
    attachmentId: 7,
    attachmentName: 'Scan_20260622.pdf',
    vendorName: null,
    grandTotal: null,
    itemCount: 0,
    rawText: '27 ONYANGO',
    confidenceOverall: 0.3,
  }), true);
});

test('does not notify for a readable invoice', () => {
  assert.equal(isUnreadableDocument({
    attachmentId: 8,
    attachmentName: 'invoice.pdf',
    vendorName: 'Vendor Limited',
    grandTotal: 12000,
    itemCount: 1,
    rawText: 'Vendor Limited Invoice 123 Total 12000',
    confidenceOverall: 0.83,
  }), false);
});
