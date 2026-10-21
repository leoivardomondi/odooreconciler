import test from 'node:test';
import assert from 'node:assert/strict';
import { canAccessPath } from './authService';
import { AppFeature, AuthRole } from '../models/types';

test('authService - canAccessPath allows /shop-floor and aliases for shop-floor operators', () => {
  const operatorUser = {
    email: 'operator@urbanvibeinteriordesign.co.ke',
    role: 'user' as AuthRole,
    apps: ['shop-floor' as AppFeature],
  };

  assert.equal(canAccessPath(operatorUser, 'GET', '/shop-floor'), true);
  assert.equal(canAccessPath(operatorUser, 'POST', '/shop-floor'), true);
  assert.equal(canAccessPath(operatorUser, 'GET', '/shop-floor/work-order/10/stock-check'), true);
  assert.equal(canAccessPath(operatorUser, 'POST', '/shop-floor/work-order/10/advance'), true);
  assert.equal(canAccessPath(operatorUser, 'POST', '/shop-floor/work-order/10/pause'), true);

  // Aliases that previously caused 404/403:
  assert.equal(canAccessPath(operatorUser, 'GET', '/shopfloor'), true);
  assert.equal(canAccessPath(operatorUser, 'GET', '/shop_floor'), true);
  assert.equal(canAccessPath(operatorUser, 'GET', '/shop'), true);
  assert.equal(canAccessPath(operatorUser, 'POST', '/shopfloor'), true);
  assert.equal(canAccessPath(operatorUser, 'POST', '/shop_floor'), true);

  // Non-shop-floor user denied
  const guestUser = {
    email: 'guest@urbanvibeinteriordesign.co.ke',
    role: 'user' as AuthRole,
    apps: [] as AppFeature[],
  };
  assert.equal(canAccessPath(guestUser, 'GET', '/shop-floor'), false);
  assert.equal(canAccessPath(guestUser, 'GET', '/shopfloor'), false);
});
