import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isBitcherOnyangoUser,
  isTintInteriorVendor,
  isBitcherOnyangoRestrictedFromReceipt,
} from './shopFloor';

test('isBitcherOnyangoUser identifies user Bitcher Onyango correctly', () => {
  assert.equal(isBitcherOnyangoUser({ displayName: 'BITCHER ONYANGO', email: 'bitcher@urbanvibe.co.ke' }), true);
  assert.equal(isBitcherOnyangoUser({ displayName: 'Bitcher Onyango', email: 'bitcher.onyango@gmail.com' }), true);
  assert.equal(isBitcherOnyangoUser({ displayName: 'bitcher', email: 'operator@urbanvibe.co.ke' }), true);
  assert.equal(isBitcherOnyangoUser({ displayName: 'Operator 1', email: 'bitcher@urbanvibe.co.ke' }), true);

  // Other operators must NOT be flagged
  assert.equal(isBitcherOnyangoUser({ displayName: 'Raphael Onyango', email: 'raphael@urbanvibe.co.ke' }), false);
  assert.equal(isBitcherOnyangoUser({ displayName: 'Charles', email: 'charles@urbanvibe.co.ke' }), false);
  assert.equal(isBitcherOnyangoUser({ displayName: 'Leoivard Ongule', email: 'leoivard@urbanvibe.co.ke' }), false);
  assert.equal(isBitcherOnyangoUser(null), false);
  assert.equal(isBitcherOnyangoUser(undefined), false);
});

test('isTintInteriorVendor detects vendor Tint Interior across formats', () => {
  assert.equal(isTintInteriorVendor('TINT INTERIOR'), true);
  assert.equal(isTintInteriorVendor('Tint Interior Limited'), true);
  assert.equal(isTintInteriorVendor('TINT INTERIORS'), true);
  assert.equal(isTintInteriorVendor([42, 'TINT INTERIOR']), true);
  assert.equal(isTintInteriorVendor([42, 'Tint Interior Ltd']), true);
  assert.equal(isTintInteriorVendor({ name: 'TINT INTERIOR' }), true);

  // Other vendors must NOT match
  assert.equal(isTintInteriorVendor('TIMBER WORLD LTD'), false);
  assert.equal(isTintInteriorVendor([15, 'HARDWARE CITY']), false);
  assert.equal(isTintInteriorVendor('URBAN VIBE INTERIOR DESIGN'), false);
  assert.equal(isTintInteriorVendor(null), false);
  assert.equal(isTintInteriorVendor(undefined), false);
});

test('isBitcherOnyangoRestrictedFromReceipt restricts ONLY Bitcher Onyango from Tint Interior', () => {
  const bitcherUser = { displayName: 'BITCHER ONYANGO', email: 'bitcher@urbanvibe.co.ke' };
  const raphaelUser = { displayName: 'Raphael Onyango', email: 'raphael@urbanvibe.co.ke' };
  const charlesUser = { displayName: 'Charles', email: 'charles@urbanvibe.co.ke' };

  const tintReceipt = { partner_id: [101, 'TINT INTERIOR'] };
  const timberReceipt = { partner_id: [102, 'TIMBER WORLD LTD'] };

  // Bitcher Onyango is restricted from Tint Interior
  assert.equal(isBitcherOnyangoRestrictedFromReceipt(bitcherUser, tintReceipt), true);

  // Bitcher Onyango CAN receive from other vendors
  assert.equal(isBitcherOnyangoRestrictedFromReceipt(bitcherUser, timberReceipt), false);

  // Other operators (Raphael, Charles) CAN receive from Tint Interior
  assert.equal(isBitcherOnyangoRestrictedFromReceipt(raphaelUser, tintReceipt), false);
  assert.equal(isBitcherOnyangoRestrictedFromReceipt(charlesUser, tintReceipt), false);

  // Fallbacks
  assert.equal(isBitcherOnyangoRestrictedFromReceipt(null, tintReceipt), false);
  assert.equal(isBitcherOnyangoRestrictedFromReceipt(bitcherUser, null), false);
});
