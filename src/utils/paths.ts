import path from 'path';

const rootCandidate = path.resolve(__dirname, '../..');

export const projectRoot =
  path.basename(rootCandidate) === 'dist' ? path.resolve(rootCandidate, '..') : rootCandidate;

export function resolveFromProjectRoot(...segments: string[]) {
  return path.resolve(projectRoot, ...segments);
}

export function resolveProjectFile(inputPath: string, fallbackRelativePath: string) {
  if (!inputPath.trim()) {
    return resolveFromProjectRoot(fallbackRelativePath);
  }

  return path.isAbsolute(inputPath)
    ? inputPath
    : resolveFromProjectRoot(inputPath);
}

export const viewsPath = resolveFromProjectRoot('src', 'views');
export const publicPath = resolveFromProjectRoot('src', 'public');
export const envFilePath = resolveFromProjectRoot('.env');
export const storageDirectoryPath = resolveFromProjectRoot('storage');
