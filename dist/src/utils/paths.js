"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.storageDirectoryPath = exports.envFilePath = exports.publicPath = exports.viewsPath = exports.projectRoot = void 0;
exports.resolveFromProjectRoot = resolveFromProjectRoot;
exports.resolveProjectFile = resolveProjectFile;
const path_1 = __importDefault(require("path"));
const rootCandidate = path_1.default.resolve(__dirname, '../..');
exports.projectRoot = path_1.default.basename(rootCandidate) === 'dist' ? path_1.default.resolve(rootCandidate, '..') : rootCandidate;
function resolveFromProjectRoot(...segments) {
    return path_1.default.resolve(exports.projectRoot, ...segments);
}
function resolveProjectFile(inputPath, fallbackRelativePath) {
    if (!inputPath.trim()) {
        return resolveFromProjectRoot(fallbackRelativePath);
    }
    return path_1.default.isAbsolute(inputPath)
        ? inputPath
        : resolveFromProjectRoot(inputPath);
}
exports.viewsPath = resolveFromProjectRoot('src', 'views');
exports.publicPath = resolveFromProjectRoot('src', 'public');
exports.envFilePath = resolveFromProjectRoot('.env');
exports.storageDirectoryPath = resolveFromProjectRoot('storage');
