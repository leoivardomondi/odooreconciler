"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const boardProductClassifier_1 = require("./boardProductClassifier");
(0, node_test_1.default)('Board attribute extraction correctly parses thickness, substrate, and color', () => {
    const whiteMdf = (0, boardProductClassifier_1.extractBoardAttributes)('WHITE MDF 18mm');
    strict_1.default.equal(whiteMdf.thickness, '18mm');
    strict_1.default.equal(whiteMdf.thicknessMm, 18);
    strict_1.default.equal(whiteMdf.substrate, 'mdf');
    strict_1.default.equal(whiteMdf.colorFamily, 'WHITE');
    const whiteParticle = (0, boardProductClassifier_1.extractBoardAttributes)('White Particle Board 18mm');
    strict_1.default.equal(whiteParticle.thickness, '18mm');
    strict_1.default.equal(whiteParticle.thicknessMm, 18);
    strict_1.default.equal(whiteParticle.substrate, 'particle');
    strict_1.default.equal(whiteParticle.colorFamily, 'WHITE');
    const suezOak = (0, boardProductClassifier_1.extractBoardAttributes)('Suez Oak MDF 18mm 8x4');
    strict_1.default.equal(suezOak.thickness, '18mm');
    strict_1.default.equal(suezOak.thicknessMm, 18);
    strict_1.default.equal(suezOak.substrate, 'mdf');
    strict_1.default.equal(suezOak.colorFamily, 'SUEZ OAK');
    const marinePly = (0, boardProductClassifier_1.extractBoardAttributes)('18mm Marine Plywood 2440x1220');
    strict_1.default.equal(marinePly.thickness, '18mm');
    strict_1.default.equal(marinePly.substrate, 'plywood');
});
(0, node_test_1.default)('detectBoardMismatch flags wrong substrate of same color (e.g. White Particle 18mm vs White MDF 18mm)', () => {
    const mismatch = (0, boardProductClassifier_1.detectBoardMismatch)('WHITE MDF 18mm', 'WHITE PARTICLE 18mm');
    strict_1.default.ok(mismatch);
    strict_1.default.equal(mismatch.hasMismatch, true);
    strict_1.default.equal(mismatch.mismatchType, 'substrate');
    strict_1.default.match(mismatch.description, /Substrate mismatch/i);
    strict_1.default.match(mismatch.description, /MDF/);
    strict_1.default.match(mismatch.description, /Particle Board/);
});
(0, node_test_1.default)('detectBoardMismatch flags wrong thickness of same color and substrate (e.g. 18mm vs 16mm)', () => {
    const mismatch = (0, boardProductClassifier_1.detectBoardMismatch)('WHITE MDF 18mm', 'WHITE MDF 16mm');
    strict_1.default.ok(mismatch);
    strict_1.default.equal(mismatch.hasMismatch, true);
    strict_1.default.equal(mismatch.mismatchType, 'size');
    strict_1.default.match(mismatch.description, /Thickness mismatch/i);
    strict_1.default.match(mismatch.description, /18mm vs logged 16mm/);
});
(0, node_test_1.default)('detectBoardMismatch flags both substrate and thickness mismatch', () => {
    const mismatch = (0, boardProductClassifier_1.detectBoardMismatch)('WHITE MDF 18mm', 'WHITE PARTICLE 16mm');
    strict_1.default.ok(mismatch);
    strict_1.default.equal(mismatch.hasMismatch, true);
    strict_1.default.equal(mismatch.mismatchType, 'substrate_and_size');
    strict_1.default.match(mismatch.description, /Substrate mismatch/i);
    strict_1.default.match(mismatch.description, /Thickness mismatch/i);
});
(0, node_test_1.default)('detectBoardMismatch ignores matching boards or different colors', () => {
    // Exact match
    strict_1.default.equal((0, boardProductClassifier_1.detectBoardMismatch)('WHITE MDF 18mm', 'WHITE MDF 18mm'), null);
    // Completely different color family
    strict_1.default.equal((0, boardProductClassifier_1.detectBoardMismatch)('WHITE MDF 18mm', 'SUEZ OAK PARTICLE 18mm'), null);
    // Non-board product
    strict_1.default.equal((0, boardProductClassifier_1.detectBoardMismatch)('Soft Close Hinge', 'WHITE MDF 18mm'), null);
});
