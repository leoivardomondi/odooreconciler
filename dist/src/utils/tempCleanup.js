"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanupStaleTempFiles = cleanupStaleTempFiles;
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const paths_1 = require("./paths");
async function cleanupStaleTempFiles(maxAgeMinutes = 30) {
    let cleanedCount = 0;
    try {
        const tempDir = (0, paths_1.resolveProjectFile)(process.env.TEMP_DIR || 'tmp', 'tmp');
        const files = await promises_1.default.readdir(tempDir).catch(() => []);
        const now = Date.now();
        const maxAgeMs = Math.max(1, maxAgeMinutes) * 60 * 1000;
        for (const file of files) {
            if (file === '.gitkeep') {
                continue;
            }
            const filePath = path_1.default.join(tempDir, file);
            try {
                const stat = await promises_1.default.stat(filePath);
                if (stat.isFile() && now - stat.mtimeMs > maxAgeMs) {
                    await promises_1.default.unlink(filePath).catch(() => undefined);
                    cleanedCount += 1;
                }
            }
            catch {
                // Ignore stat errors for deleted files
            }
        }
    }
    catch {
        // Ignore cleanup errors
    }
    return cleanedCount;
}
