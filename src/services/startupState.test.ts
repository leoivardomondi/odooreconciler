import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getStartupState,
  markStartupFailed,
  markStartupReady,
  markStartupStep,
  resetStartupStateForTests,
  waitForStartupSettlement,
} from './startupState';

test('waitForStartupSettlement resolves immediately when startup finishes', async () => {
  resetStartupStateForTests();
  markStartupStep('initializing database');

  const startedAt = Date.now();
  setTimeout(() => {
    markStartupReady();
  }, 40);

  const state = await waitForStartupSettlement(5000);
  const elapsedMs = Date.now() - startedAt;

  assert.equal(state.status, 'ready');
  assert.equal(getStartupState().status, 'ready');
  assert.ok(elapsedMs < 1500, `Expected fast settlement, got ${elapsedMs}ms`);
});

test('waitForStartupSettlement resolves immediately when startup fails', async () => {
  resetStartupStateForTests();
  markStartupStep('initializing database');

  const startedAt = Date.now();
  setTimeout(() => {
    markStartupFailed('MySQL connection refused');
  }, 30);

  const state = await waitForStartupSettlement(5000);
  const elapsedMs = Date.now() - startedAt;

  assert.equal(state.status, 'failed');
  assert.equal(state.errorMessage, 'MySQL connection refused');
  assert.ok(elapsedMs < 1500, `Expected fast failure settlement, got ${elapsedMs}ms`);
});

test('waitForStartupSettlement falls back cleanly on timeout while still starting', async () => {
  resetStartupStateForTests();
  markStartupStep('initializing database');

  const state = await waitForStartupSettlement(60);
  assert.equal(state.status, 'starting');
  assert.equal(state.step, 'initializing database');
});

test('waitForStartupSettlement returns immediately when already ready', async () => {
  resetStartupStateForTests();
  markStartupReady();

  const startedAt = Date.now();
  const state = await waitForStartupSettlement(5000);
  assert.equal(state.status, 'ready');
  assert.ok(Date.now() - startedAt < 50);
});
