"use strict";
/**
 * Global runtime polyfills for Node.js (< 22) and PDF.js v4+ environments.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensurePdfjsGlobals = ensurePdfjsGlobals;
if (typeof Promise.withResolvers !== 'function') {
    Promise.withResolvers = function () {
        let resolve;
        let reject;
        const promise = new Promise((res, rej) => {
            resolve = res;
            reject = rej;
        });
        return { promise, resolve, reject };
    };
}
function ensurePdfjsGlobals(canvasModule) {
    if (typeof Promise.withResolvers !== 'function') {
        Promise.withResolvers = function () {
            let resolve;
            let reject;
            const promise = new Promise((res, rej) => {
                resolve = res;
                reject = rej;
            });
            return { promise, resolve, reject };
        };
    }
    if (canvasModule) {
        if (!globalThis.ImageData && canvasModule.ImageData) {
            globalThis.ImageData = canvasModule.ImageData;
        }
        if (!globalThis.DOMMatrix && canvasModule.DOMMatrix) {
            globalThis.DOMMatrix = canvasModule.DOMMatrix;
        }
        if (!globalThis.Path2D && canvasModule.Path2D) {
            globalThis.Path2D = canvasModule.Path2D;
        }
    }
}
