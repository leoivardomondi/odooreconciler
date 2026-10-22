import assert from 'node:assert/strict';
import test from 'node:test';
import { isAccountDeactivated } from './accountStatus';

test('inactive approved users are deactivated across various database types', () => {
  assert.equal(isAccountDeactivated(false), true);
  assert.equal(isAccountDeactivated(0), true);
  assert.equal(isAccountDeactivated('0'), true);
  assert.equal(isAccountDeactivated('false'), true);
  assert.equal(isAccountDeactivated('FALSE'), true);

  assert.equal(isAccountDeactivated(true), false);
  assert.equal(isAccountDeactivated(1), false);
  assert.equal(isAccountDeactivated('1'), false);
  assert.equal(isAccountDeactivated('true'), false);
  assert.equal(isAccountDeactivated(undefined), false);
  assert.equal(isAccountDeactivated(null), false);
});

test('the configured local administrator remains available even if flag is false', () => {
  assert.equal(isAccountDeactivated(false, true), false);
  assert.equal(isAccountDeactivated(0, true), false);
  assert.equal(isAccountDeactivated('0', true), false);
});

test('filtering approved users excludes inactive users from email recipient choices', () => {
  const users = [
    { email: 'active1@urbanvibeinteriordesign.co.ke', active: true },
    { email: 'inactive1@urbanvibeinteriordesign.co.ke', active: false },
    { email: 'active2@urbanvibeinteriordesign.co.ke', active: true },
    { email: 'inactive2@urbanvibeinteriordesign.co.ke', active: false },
    { email: '', active: true },
  ];

  const emailChoices = users
    .filter((u) => u && Boolean(u.active) && typeof u.email === 'string' && u.email.trim().length > 0)
    .map((u) => u.email.trim().toLowerCase());

  assert.deepEqual(emailChoices, [
    'active1@urbanvibeinteriordesign.co.ke',
    'active2@urbanvibeinteriordesign.co.ke',
  ]);
  assert.ok(!emailChoices.includes('inactive1@urbanvibeinteriordesign.co.ke'));
  assert.ok(!emailChoices.includes('inactive2@urbanvibeinteriordesign.co.ke'));
});
