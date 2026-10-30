/**
 * Global runtime polyfills for Node.js (< 22) and PDF.js v4+ environments.
 */

if (typeof (Promise as any).withResolvers !== 'function') {
  (Promise as any).withResolvers = function <T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: any) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

export function ensurePdfjsGlobals(canvasModule?: any) {
  if (typeof (Promise as any).withResolvers !== 'function') {
    (Promise as any).withResolvers = function <T>() {
      let resolve!: (value: T | PromiseLike<T>) => void;
      let reject!: (reason?: any) => void;
      const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    };
  }

  if (canvasModule) {
    if (!(globalThis as any).ImageData && canvasModule.ImageData) {
      (globalThis as any).ImageData = canvasModule.ImageData;
    }
    if (!(globalThis as any).DOMMatrix && canvasModule.DOMMatrix) {
      (globalThis as any).DOMMatrix = canvasModule.DOMMatrix;
    }
    if (!(globalThis as any).Path2D && canvasModule.Path2D) {
      (globalThis as any).Path2D = canvasModule.Path2D;
    }
  }
}
