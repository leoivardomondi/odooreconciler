import assert from 'node:assert/strict';
import test from 'node:test';
import { isAccountDeactivated } from './accountStatus';

test('inactive approved users are deactivated', () => {
  assert.equal(isAccountDeactivated(false), true);
  assert.equal(isAccountDeactivated(true), false);
  assert.equal(isAccountDeactivated(undefined), false);
});

test('the configured local administrator remains available', () => {
  assert.equal(isAccountDeactivated(false, true), false);
});
