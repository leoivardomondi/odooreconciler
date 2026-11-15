import test from 'node:test';
import assert from 'node:assert/strict';
import { isEligibleStandaloneEtrPo } from './crossCompanySyncService.js';

test('isEligibleStandaloneEtrPo correctly filters standalone ETR POs', () => {
  // Case 1: Eligible standalone ETR PO in Company 1 from Nov 1st onwards
  const eligiblePo = {
    id: 100,
    name: 'P01409',
    partner_id: [524, 'TINT INTERIORS'] as [number, string],
    company_id: [1, 'URBAN VIBE INTERIOR DESIGN COMPANY LTD'] as [number, string],
    date_order: '2026-11-12 14:45:50',
    date_approve: '2026-11-14 06:01:31',
    origin: false as const,
    state: 'purchase',
    amount_total: 26000,
    order_line: [1],
    x_studio_selection_field_68_1k74mkea1: 'ETR',
  };
  assert.equal(isEligibleStandaloneEtrPo(eligiblePo), true);

  // Case 2: Not eligible because Tax Option is NO ETR
  const noEtrPo = {
    ...eligiblePo,
    x_studio_selection_field_68_1k74mkea1: 'NO ETR',
  };
  assert.equal(isEligibleStandaloneEtrPo(noEtrPo), false);

  // Case 3: Not eligible because it is linked to a Sales Order (not standalone)
  const soLinkedPo = {
    ...eligiblePo,
    origin: 'S03885',
  };
  assert.equal(isEligibleStandaloneEtrPo(soLinkedPo), false);

  // Case 4: Not eligible because date is before November 1st, 2026
  const oldPo = {
    ...eligiblePo,
    date_order: '2026-10-25 10:00:00',
  };
  assert.equal(isEligibleStandaloneEtrPo(oldPo), false);

  // Case 5: Not eligible because it is in Company 3 or Company 2
  const otherCompanyPo = {
    ...eligiblePo,
    company_id: [3, 'URBAN VIBE 2'] as [number, string],
  };
  assert.equal(isEligibleStandaloneEtrPo(otherCompanyPo), false);
});
