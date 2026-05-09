import fs from 'fs/promises';
import path from 'path';

const imageBaseDir = path.resolve(process.cwd(), 'generated-images');
const imageHistoryMetaDirName = '.history';

export function getImageBaseDir(): string {
    return imageBaseDir;
}

function getUserDirName(userId: number): string {
    return String(userId);
}

export function isValidImageFilename(filename: string): boolean {
    return Boolean(filename) && !filename.includes('..') && !filename.includes('/') && !filename.includes('\\');
}

export function getImageOutputDir(userId?: number): string {
    if (!userId) return imageBaseDir;

    return path.join(imageBaseDir, getUserDirName(userId));
}

export function getImageFilePath(filename: string, userId?: number): string {
    return path.join(getImageOutputDir(userId), filename);
}

export function getImageHistoryMetaDir(userId?: number): string {
    return path.join(getImageOutputDir(userId), imageHistoryMetaDirName);
}

export function getImageHistoryMetaPath(timestamp: number, userId?: number): string {
    return path.join(getImageHistoryMetaDir(userId), `${timestamp}.json`);
}

export async function ensureImageOutputDirExists(userId?: number): Promise<void> {
    const outputDir = getImageOutputDir(userId);

    try {
        await fs.access(outputDir);
    } catch (error: unknown) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
            await fs.mkdir(outputDir, { recursive: true });
            return;
        }

        throw error;
    }
}

export async function ensureImageHistoryMetaDirExists(userId?: number): Promise<void> {
    const metadataDir = getImageHistoryMetaDir(userId);

    try {
        await fs.access(metadataDir);
    } catch (error: unknown) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
            await fs.mkdir(metadataDir, { recursive: true });
            return;
        }

        throw error;
    }
}
