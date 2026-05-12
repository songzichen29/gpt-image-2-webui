import fs from 'fs/promises';
import path from 'path';
import { Client as MinioClient } from 'minio';

const imageBaseDir = path.resolve(process.cwd(), 'generated-images');
const imageHistoryMetaDirName = '.history';
const minioBucketName = process.env.MINIO_BUCKET_NAME?.trim() || 'gpt-image-2-webui';

let minioClientInstance: MinioClient | null = null;
let minioBucketReady: Promise<void> | null = null;
const MINIO_RETRY_ATTEMPTS = 3;
const MINIO_RETRY_DELAY_MS = 800;

export function getImageBaseDir(): string {
    return imageBaseDir;
}

export function getImageStorageMode(): 'fs' | 'indexeddb' | 'minio' {
    const explicitMode = process.env.NEXT_PUBLIC_IMAGE_STORAGE_MODE;

    if (explicitMode === 'fs' || explicitMode === 'indexeddb' || explicitMode === 'minio') {
        return explicitMode;
    }

    if (process.env.MINIO_SERVER_URL && process.env.MINIO_ROOT_USER && process.env.MINIO_ROOT_PASSWORD) {
        return 'minio';
    }

    return process.env.VERCEL === '1' ? 'indexeddb' : 'fs';
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

export function getImageObjectKey(filename: string, userId?: number): string {
    return path.posix.join(userId ? String(userId) : 'legacy', filename);
}

function joinUrlPath(baseUrl: string, objectKey: string): string {
    const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
    const encodedObjectKey = objectKey
        .split('/')
        .filter(Boolean)
        .map((segment) => encodeURIComponent(segment))
        .join('/');

    return `${normalizedBaseUrl}/${encodedObjectKey}`;
}

export function buildPublicMinioObjectUrl(objectKey: string): string | null {
    const publicBaseUrl = process.env.MINIO_PUBLIC_BASE_URL?.trim();
    if (publicBaseUrl) {
        return joinUrlPath(publicBaseUrl, objectKey);
    }

    const serverUrl = process.env.MINIO_SERVER_URL?.trim();
    if (!serverUrl) {
        return null;
    }

    return joinUrlPath(`${serverUrl.replace(/\/+$/, '')}/${minioBucketName}`, objectKey);
}

export function buildPublicMinioImageUrl(filename: string, userId?: number): string | null {
    return buildPublicMinioObjectUrl(getImageObjectKey(filename, userId));
}

export function getImageHistoryObjectKey(timestamp: number, userId?: number): string {
    return path.posix.join(userId ? String(userId) : 'legacy', '.history', `${timestamp}.json`);
}

export function getImageSourceObjectKey(filename: string, userId?: number, timestamp?: number): string {
    return path.posix.join(userId ? String(userId) : 'legacy', '.sources', `${timestamp ?? Date.now()}-${filename}`);
}

export function getImageMaskObjectKey(filename: string, userId?: number, timestamp?: number): string {
    return path.posix.join(userId ? String(userId) : 'legacy', '.masks', `${timestamp ?? Date.now()}-${filename}`);
}

function getMinioClient(): MinioClient | null {
    const serverUrl = (process.env.MINIO_INTERNAL_SERVER_URL || process.env.MINIO_SERVER_URL)?.trim();
    const accessKey = process.env.MINIO_ROOT_USER?.trim();
    const secretKey = process.env.MINIO_ROOT_PASSWORD?.trim();

    if (!serverUrl || !accessKey || !secretKey) {
        return null;
    }

    const parsedUrl = new URL(serverUrl);
    const useSSL = parsedUrl.protocol === 'https:';
    const port = parsedUrl.port ? Number.parseInt(parsedUrl.port, 10) : useSSL ? 443 : 80;

    if (!minioClientInstance) {
        minioClientInstance = new MinioClient({
            endPoint: parsedUrl.hostname,
            port,
            useSSL,
            accessKey,
            secretKey,
            region: process.env.MINIO_REGION?.trim() || undefined
        });
    }

    return minioClientInstance;
}

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientMinioError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
        return false;
    }

    const code = 'code' in error && typeof error.code === 'string' ? error.code : '';
    const message = 'message' in error && typeof error.message === 'string' ? error.message.toLowerCase() : '';

    return (
        code === 'ECONNRESET' ||
        code === 'ETIMEDOUT' ||
        code === 'ECONNABORTED' ||
        code === 'ESOCKETTIMEDOUT' ||
        message.includes('econnreset') ||
        message.includes('socket hang up') ||
        message.includes('timeout') ||
        message.includes('tls') ||
        message.includes('connection reset')
    );
}

async function withMinioRetry<T>(operationName: string, run: () => Promise<T>): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= MINIO_RETRY_ATTEMPTS; attempt++) {
        try {
            return await run();
        } catch (error) {
            lastError = error;
            const shouldRetry = attempt < MINIO_RETRY_ATTEMPTS && isTransientMinioError(error);

            console.warn(`[MinIO] ${operationName} failed`, {
                attempt,
                maxAttempts: MINIO_RETRY_ATTEMPTS,
                shouldRetry,
                error
            });

            if (!shouldRetry) {
                throw error;
            }

            await sleep(MINIO_RETRY_DELAY_MS * attempt);
        }
    }

    throw lastError;
}

export async function ensureMinioBucketExists(): Promise<void> {
    const client = getMinioClient();
    if (!client) return;

    if (!minioBucketReady) {
        minioBucketReady = (async () => {
            const exists = await withMinioRetry('bucketExists', () => client.bucketExists(minioBucketName));
            if (!exists) {
                await withMinioRetry('makeBucket', () => client.makeBucket(minioBucketName));
            }
        })();
    }

    try {
        await minioBucketReady;
    } catch (error) {
        minioBucketReady = null;
        throw error;
    }
}

export async function uploadImageToMinio(
    filename: string,
    buffer: Buffer,
    userId?: number,
    contentType?: string
): Promise<string> {
    const client = getMinioClient();
    if (!client) throw new Error('MinIO is not configured.');

    await ensureMinioBucketExists();
    const objectKey = getImageObjectKey(filename, userId);
    await withMinioRetry('putObject(image)', () =>
        client.putObject(minioBucketName, objectKey, buffer, undefined, {
            'Content-Type': contentType || 'application/octet-stream',
            'Cache-Control': 'public, max-age=31536000, immutable'
        })
    );

    return objectKey;
}

export async function uploadBufferToMinioByKey(
    objectKey: string,
    buffer: Buffer,
    contentType?: string
): Promise<void> {
    const client = getMinioClient();
    if (!client) throw new Error('MinIO is not configured.');

    await ensureMinioBucketExists();
    await withMinioRetry('putObject(buffer)', () =>
        client.putObject(minioBucketName, objectKey, buffer, undefined, {
            'Content-Type': contentType || 'application/octet-stream',
            'Cache-Control': 'public, max-age=31536000, immutable'
        })
    );
}

export async function deleteImageFromMinio(filename: string, userId?: number): Promise<void> {
    const client = getMinioClient();
    if (!client) return;

    await ensureMinioBucketExists();
    await withMinioRetry('removeObject(image)', () => client.removeObject(minioBucketName, getImageObjectKey(filename, userId)));
}

export async function deleteMinioObjectByKey(objectKey: string): Promise<void> {
    const client = getMinioClient();
    if (!client) return;

    await ensureMinioBucketExists();
    await withMinioRetry('removeObject(key)', () => client.removeObject(minioBucketName, objectKey));
}

export async function getMinioPresignedImageUrl(
    filename: string,
    userId?: number,
    expirySeconds = 3600
): Promise<string | null> {
    const client = getMinioClient();
    if (!client) return null;

    await ensureMinioBucketExists();
    return withMinioRetry('presignedGetObject', () =>
        client.presignedGetObject(minioBucketName, getImageObjectKey(filename, userId), expirySeconds)
    );
}

export async function uploadJsonToMinio(objectKey: string, value: unknown, contentType = 'application/json'): Promise<void> {
    const client = getMinioClient();
    if (!client) throw new Error('MinIO is not configured.');

    await ensureMinioBucketExists();
    const buffer = Buffer.from(JSON.stringify(value, null, 2), 'utf8');
    await withMinioRetry('putObject(json)', () =>
        client.putObject(minioBucketName, objectKey, buffer, undefined, {
            'Content-Type': contentType,
            'Cache-Control': 'no-cache'
        })
    );
}

export async function readJsonFromMinio<T>(objectKey: string): Promise<T | null> {
    const client = getMinioClient();
    if (!client) return null;

    await ensureMinioBucketExists();
    return withMinioRetry('getObject(json)', async () => {
        const stream = await client.getObject(minioBucketName, objectKey);
        const chunks: Buffer[] = [];

        for await (const chunk of stream) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }

        if (chunks.length === 0) return null;
        return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
    });
}

export async function getMinioImageBuffer(filename: string, userId?: number): Promise<Buffer | null> {
    return getMinioObjectBufferByKey(getImageObjectKey(filename, userId));
}

export async function getMinioObjectBufferByKey(objectKey: string): Promise<Buffer | null> {
    const client = getMinioClient();
    if (!client) return null;

    await ensureMinioBucketExists();

    return withMinioRetry(`getObject(image:${objectKey})`, async () => {
        let stream;
        try {
            stream = await client.getObject(minioBucketName, objectKey);
        } catch (error) {
            console.error(`MinIO getObject failed for ${objectKey}:`, error);
            throw error;
        }

        const chunks: Buffer[] = [];

        try {
            for await (const chunk of stream) {
                chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            }
        } catch (error) {
            console.error(`MinIO stream read failed for ${objectKey}:`, error);
            throw error;
        }

        return chunks.length > 0 ? Buffer.concat(chunks) : null;
    });
}

export async function listMinioObjectNames(prefix: string): Promise<string[]> {
    const client = getMinioClient();
    if (!client) return [];

    await ensureMinioBucketExists();
    return withMinioRetry(`listObjectsV2(${prefix})`, async () => {
        const names: string[] = [];
        const stream = client.listObjectsV2(minioBucketName, prefix, true);

        for await (const item of stream) {
            if (item?.name) names.push(item.name);
        }

        return names;
    });
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
