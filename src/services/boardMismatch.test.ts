import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractBoardAttributes,
  detectBoardMismatch,
  areSameColorFamily,
} from './boardProductClassifier';

test('Board attribute extraction correctly parses thickness, substrate, and color', () => {
  const whiteMdf = extractBoardAttributes('WHITE MDF 18mm');
  assert.equal(whiteMdf.thickness, '18mm');
  assert.equal(whiteMdf.thicknessMm, 18);
  assert.equal(whiteMdf.substrate, 'mdf');
  assert.equal(whiteMdf.colorFamily, 'WHITE');

  const whiteParticle = extractBoardAttributes('White Particle Board 18mm');
  assert.equal(whiteParticle.thickness, '18mm');
  assert.equal(whiteParticle.thicknessMm, 18);
  assert.equal(whiteParticle.substrate, 'particle');
  assert.equal(whiteParticle.colorFamily, 'WHITE');

  const suezOak = extractBoardAttributes('Suez Oak MDF 18mm 8x4');
  assert.equal(suezOak.thickness, '18mm');
  assert.equal(suezOak.thicknessMm, 18);
  assert.equal(suezOak.substrate, 'mdf');
  assert.equal(suezOak.colorFamily, 'SUEZ OAK');

  const marinePly = extractBoardAttributes('18mm Marine Plywood 2440x1220');
  assert.equal(marinePly.thickness, '18mm');
  assert.equal(marinePly.substrate, 'plywood');
});

test('detectBoardMismatch flags wrong substrate of same color (e.g. White Particle 18mm vs White MDF 18mm)', () => {
  const mismatch = detectBoardMismatch('WHITE MDF 18mm', 'WHITE PARTICLE 18mm');
  assert.ok(mismatch);
  assert.equal(mismatch.hasMismatch, true);
  assert.equal(mismatch.mismatchType, 'substrate');
  assert.match(mismatch.description, /Substrate mismatch/i);
  assert.match(mismatch.description, /MDF/);
  assert.match(mismatch.description, /Particle Board/);
});

test('detectBoardMismatch flags wrong thickness of same color and substrate (e.g. 18mm vs 16mm)', () => {
  const mismatch = detectBoardMismatch('WHITE MDF 18mm', 'WHITE MDF 16mm');
  assert.ok(mismatch);
  assert.equal(mismatch.hasMismatch, true);
  assert.equal(mismatch.mismatchType, 'size');
  assert.match(mismatch.description, /Thickness mismatch/i);
  assert.match(mismatch.description, /18mm vs logged 16mm/);
});

test('detectBoardMismatch flags both substrate and thickness mismatch', () => {
  const mismatch = detectBoardMismatch('WHITE MDF 18mm', 'WHITE PARTICLE 16mm');
  assert.ok(mismatch);
  assert.equal(mismatch.hasMismatch, true);
  assert.equal(mismatch.mismatchType, 'substrate_and_size');
  assert.match(mismatch.description, /Substrate mismatch/i);
  assert.match(mismatch.description, /Thickness mismatch/i);
});

test('detectBoardMismatch ignores matching boards or different colors', () => {
  // Exact match
  assert.equal(detectBoardMismatch('WHITE MDF 18mm', 'WHITE MDF 18mm'), null);

  // Completely different color family
  assert.equal(detectBoardMismatch('WHITE MDF 18mm', 'SUEZ OAK PARTICLE 18mm'), null);

  // Non-board product
  assert.equal(detectBoardMismatch('Soft Close Hinge', 'WHITE MDF 18mm'), null);
});
