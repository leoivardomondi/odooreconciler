import fs from 'fs/promises';
import path from 'path';
import { resolveProjectFile } from './paths';

export async function cleanupStaleTempFiles(maxAgeMinutes = 30): Promise<number> {
  let cleanedCount = 0;
  try {
    const tempDir = resolveProjectFile(process.env.TEMP_DIR || 'tmp', 'tmp');
    const files = await fs.readdir(tempDir).catch(() => []);
    const now = Date.now();
    const maxAgeMs = Math.max(1, maxAgeMinutes) * 60 * 1000;

    for (const file of files) {
      if (file === '.gitkeep') {
        continue;
      }

      const filePath = path.join(tempDir, file);
      try {
        const stat = await fs.stat(filePath);
        if (stat.isFile() && now - stat.mtimeMs > maxAgeMs) {
          await fs.unlink(filePath).catch(() => undefined);
          cleanedCount += 1;
        }
      } catch {
        // Ignore stat errors for deleted files
      }
    }
  } catch {
    // Ignore cleanup errors
  }
  return cleanedCount;
}
