import crypto from 'crypto';
import fs from 'fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import {
    getImageHistoryMetaDir,
    getImageHistoryMetaPath,
    getImageHistoryObjectKey,
    getImageOutputDir,
    getImageStorageMode,
    listMinioObjectNames,
    readJsonFromMinio,
    isValidImageFilename
} from '@/lib/server/image-storage';
import { writeImage2RuntimeLog } from '@/lib/server/image2-log';
import { getImage2Session, isSub2ApiSsoEnabled, unauthorizedImage2Response } from '@/lib/server/sub2api-auth';

const imageFilenamePattern = /^(\d+)-(\d+)\.(png|jpe?g|webp)$/i;
const defaultPage = 1;
const defaultPageSize = 20;
const maxPageSize = 1000;

type ImageHistoryItem = {
    timestamp: number;
    images: Array<{ filename: string }>;
    status: 'completed';
    storageModeUsed: 'fs' | 'minio';
    durationMs: number;
    quality: 'auto' | 'low' | 'medium' | 'high' | 'standard' | 'hd';
    background: 'auto' | 'transparent' | 'opaque';
    moderation: 'auto' | 'low';
    prompt: string;
    mode: 'generate' | 'edit';
    costDetails: {
        estimated_cost_usd: number;
        text_input_tokens: number;
        image_input_tokens: number;
        image_output_tokens: number;
    } | null;
    output_format: 'png' | 'jpeg' | 'webp';
    size?: string;
    output_compression?: number;
    streaming?: boolean;
    partialImages?: number;
    sourceImageCount?: number;
    hasMask?: boolean;
    model?: string;
};

function sha256(data: string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
}

function withNoStore(response: NextResponse): NextResponse {
    response.headers.set('Cache-Control', 'private, no-cache, no-store, max-age=0, must-revalidate');
    response.headers.set('Pragma', 'no-cache');
    response.headers.set('Expires', '0');
    response.headers.append('Vary', 'Cookie');
    response.headers.append('Vary', 'Authorization');
    return response;
}

function parsePositiveInt(value: string | null, fallback: number, max?: number): number {
    if (!value) return fallback;
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return max ? Math.min(parsed, max) : parsed;
}

function getPaginationParams(request: NextRequest) {
    const page = parsePositiveInt(request.nextUrl.searchParams.get('page'), defaultPage);
    const pageSize = parsePositiveInt(
        request.nextUrl.searchParams.get('page_size') || request.nextUrl.searchParams.get('limit'),
        defaultPageSize,
        maxPageSize
    );
    return { page, pageSize };
}

function getSinceTimestamp(request: NextRequest): number | null {
    const rawSince = request.nextUrl.searchParams.get('since');
    if (!rawSince) return null;
    const since = Number.parseInt(rawSince, 10);
    return Number.isFinite(since) && since > 0 ? since : null;
}

function getExactTimestamp(request: NextRequest): number | null {
    const rawTimestamp = request.nextUrl.searchParams.get('timestamp');
    if (!rawTimestamp) return null;
    const timestamp = Number.parseInt(rawTimestamp, 10);
    return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
}

function getSortOrder(request: NextRequest): 'asc' | 'desc' {
    return request.nextUrl.searchParams.get('sort_order')?.toLowerCase() === 'asc' ? 'asc' : 'desc';
}

function paginatedResponse(items: ImageHistoryItem[], total: number, page: number, pageSize: number) {
    const pages = Math.max(1, Math.ceil(total / pageSize));
    return withNoStore(
        NextResponse.json({ code: 0, message: 'success', data: { items, total, page, page_size: pageSize, pages } })
    );
}

function singleItemResponse(item: ImageHistoryItem | null) {
    const items = item ? [item] : [];
    return paginatedResponse(items, items.length, 1, 1);
}

function getOutputFormat(filename: string): 'png' | 'jpeg' | 'webp' {
    const extension = filename.split('.').pop()?.toLowerCase();
    if (extension === 'jpg' || extension === 'jpeg') return 'jpeg';
    if (extension === 'webp') return 'webp';
    return 'png';
}

function normalizeQuality(value: unknown): ImageHistoryItem['quality'] {
    return value === 'low' ||
        value === 'medium' ||
        value === 'high' ||
        value === 'standard' ||
        value === 'hd' ||
        value === 'auto'
        ? value
        : 'auto';
}

function normalizeBackground(value: unknown): ImageHistoryItem['background'] {
    return value === 'transparent' || value === 'opaque' || value === 'auto' ? value : 'auto';
}

function normalizeModeration(value: unknown): ImageHistoryItem['moderation'] {
    return value === 'low' || value === 'auto' ? value : 'auto';
}

function normalizeMode(value: unknown): ImageHistoryItem['mode'] {
    return value === 'edit' ? 'edit' : 'generate';
}

function normalizeOutputFormat(value: unknown, fallbackFilename: string): ImageHistoryItem['output_format'] {
    if (value === 'png' || value === 'jpeg' || value === 'webp') return value;
    return getOutputFormat(fallbackFilename);
}

function normalizeCostDetails(value: unknown): ImageHistoryItem['costDetails'] {
    if (!value || typeof value !== 'object') return null;

    const source = value as Partial<NonNullable<ImageHistoryItem['costDetails']>>;
    const estimatedCostUsd = source.estimated_cost_usd;
    const textInputTokens = source.text_input_tokens;
    const imageInputTokens = source.image_input_tokens;
    const imageOutputTokens = source.image_output_tokens;

    if (
        typeof estimatedCostUsd !== 'number' ||
        typeof textInputTokens !== 'number' ||
        typeof imageInputTokens !== 'number' ||
        typeof imageOutputTokens !== 'number'
    ) {
        return null;
    }

    return {
        estimated_cost_usd: estimatedCostUsd,
        text_input_tokens: textInputTokens,
        image_input_tokens: imageInputTokens,
        image_output_tokens: imageOutputTokens
    };
}

function normalizeHistoryItem(value: unknown, timestamp: number): ImageHistoryItem | null {
    if (!value || typeof value !== 'object') return null;

    const source = value as Partial<ImageHistoryItem>;
    if (source.timestamp !== timestamp || !Array.isArray(source.images) || source.status !== 'completed') {
        return null;
    }

    return {
        timestamp: source.timestamp,
        images: source.images
            .map((image) => ({ filename: image.filename }))
            .filter((image) => typeof image.filename === 'string' && image.filename),
        status: 'completed',
        storageModeUsed: source.storageModeUsed === 'minio' ? 'minio' : 'fs',
        durationMs: typeof source.durationMs === 'number' ? source.durationMs : 0,
        quality: normalizeQuality(source.quality),
        background: normalizeBackground(source.background),
        moderation: normalizeModeration(source.moderation),
        prompt: typeof source.prompt === 'string' ? source.prompt : '',
        mode: normalizeMode(source.mode),
        costDetails: normalizeCostDetails(source.costDetails),
        output_format: normalizeOutputFormat(source.output_format, source.images[0]?.filename || ''),
        size: source.size,
        output_compression: source.output_compression,
        streaming: source.streaming,
        partialImages: source.partialImages,
        sourceImageCount: source.sourceImageCount,
        hasMask: source.hasMask,
        model: source.model
    };
}

async function loadFsHistoryItem(timestamp: number, image2UserId?: number): Promise<ImageHistoryItem | null> {
    const metadataPath = getImageHistoryMetaPath(timestamp, image2UserId);

    try {
        const raw = await fs.readFile(metadataPath, 'utf8');
        const parsed = normalizeHistoryItem(JSON.parse(raw), timestamp);
        if (parsed) return parsed;
    } catch (error: unknown) {
        if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')) {
            console.warn(`Failed to read image history metadata ${metadataPath}:`, error);
        }
    }

    try {
        const outputDir = getImageOutputDir(image2UserId);
        const dirEntries = await fs.readdir(outputDir, { withFileTypes: true });
        const images = dirEntries
            .filter((entry) => entry.isFile() && isValidImageFilename(entry.name))
            .map((entry) => {
                const match = entry.name.match(imageFilenamePattern);
                if (!match || Number(match[1]) !== timestamp) return null;
                return {
                    filename: entry.name,
                    index: Number(match[2]),
                    outputFormat: getOutputFormat(entry.name)
                };
            })
            .filter((image): image is { filename: string; index: number; outputFormat: 'png' | 'jpeg' | 'webp' } => {
                return image !== null && Number.isFinite(image.index);
            })
            .sort((left, right) => left.index - right.index);

        if (images.length === 0) return null;

        return {
            timestamp,
            images: images.map((image) => ({ filename: image.filename })),
            status: 'completed',
            storageModeUsed: 'fs',
            durationMs: 0,
            quality: 'auto',
            background: 'auto',
            moderation: 'auto',
            prompt: '',
            mode: 'generate',
            costDetails: null,
            output_format: images[0]?.outputFormat ?? 'png'
        };
    } catch (error: unknown) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
            return null;
        }

        throw error;
    }
}

async function loadFsHistory(request: NextRequest, image2UserId?: number): Promise<ImageHistoryItem[]> {
    const since = getSinceTimestamp(request);
    const sortOrder = getSortOrder(request);
    const outputDir = getImageOutputDir(image2UserId);
    const metadataDir = getImageHistoryMetaDir(image2UserId);
    const dirEntries = await fs.readdir(outputDir, { withFileTypes: true });
    const groups = new Map<number, Array<{ filename: string; index: number; outputFormat: 'png' | 'jpeg' | 'webp' }>>();
    const metadataMap = new Map<number, ImageHistoryItem>();

    try {
        const metadataEntries = await fs.readdir(metadataDir, { withFileTypes: true });
        for (const entry of metadataEntries) {
            if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
            const timestamp = Number.parseInt(entry.name.replace(/\.json$/i, ''), 10);
            if (!Number.isFinite(timestamp) || timestamp <= 0) continue;
            if (since !== null && timestamp < since) continue;
            try {
                const raw = await fs.readFile(`${metadataDir}/${entry.name}`, 'utf8');
                const parsed = normalizeHistoryItem(JSON.parse(raw), timestamp);
                if (parsed) {
                    metadataMap.set(timestamp, parsed);
                }
            } catch {}
        }
    } catch (error: unknown) {
        if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')) throw error;
    }

    dirEntries.forEach((entry) => {
        if (entry.name === '.history') return;
        if (!entry.isFile() || !isValidImageFilename(entry.name)) return;
        const match = entry.name.match(imageFilenamePattern);
        if (!match) return;
        const timestamp = Number(match[1]);
        const imageIndex = Number(match[2]);
        if (!Number.isFinite(timestamp) || !Number.isFinite(imageIndex)) return;
        if (since !== null && timestamp < since) return;
        const images = groups.get(timestamp) ?? [];
        images.push({ filename: entry.name, index: imageIndex, outputFormat: getOutputFormat(entry.name) });
        groups.set(timestamp, images);
    });

    const historyByTimestamp = new Map<number, ImageHistoryItem>();
    for (const [timestamp, metadata] of metadataMap.entries()) historyByTimestamp.set(timestamp, metadata);

    Array.from(groups.entries()).forEach(([timestamp, images]) => {
        if (historyByTimestamp.has(timestamp)) return;
        const orderedImages = images.sort((left, right) => left.index - right.index);
        historyByTimestamp.set(timestamp, {
            timestamp,
            images: orderedImages.map((image) => ({ filename: image.filename })),
            status: 'completed',
            storageModeUsed: 'fs',
            durationMs: 0,
            quality: 'auto',
            background: 'auto',
            moderation: 'auto',
            prompt: '',
            mode: 'generate',
            costDetails: null,
            output_format: orderedImages[0]?.outputFormat ?? 'png'
        });
    });

    return Array.from(historyByTimestamp.values()).sort((left, right) =>
        sortOrder === 'asc' ? left.timestamp - right.timestamp : right.timestamp - left.timestamp
    );
}

type MinioHistoryPage = {
    items: ImageHistoryItem[];
    total: number;
};

async function loadMinioHistoryPage(request: NextRequest, page: number, pageSize: number, image2UserId?: number): Promise<MinioHistoryPage> {
    const since = getSinceTimestamp(request);
    const sortOrder = getSortOrder(request);
    const prefix = image2UserId ? `${image2UserId}/.history/` : 'legacy/.history/';
    const names = await listMinioObjectNames(prefix);
    const orderedObjects = names
        .map((name) => {
            const fileName = name.split('/').pop() ?? '';
            const timestamp = Number.parseInt(fileName.replace(/\.json$/i, ''), 10);

            return { name, timestamp };
        })
        .filter(({ timestamp }) => Number.isFinite(timestamp) && timestamp > 0 && (since === null || timestamp >= since))
        .sort((left, right) => (sortOrder === 'asc' ? left.timestamp - right.timestamp : right.timestamp - left.timestamp));
    const selectedObjects = orderedObjects.slice((page - 1) * pageSize, page * pageSize);
    const items: ImageHistoryItem[] = [];

    for (const { name, timestamp } of selectedObjects) {
        try {
            const metadata = normalizeHistoryItem(await readJsonFromMinio<unknown>(name), timestamp);
            if (metadata) items.push(metadata);
        } catch (error) {
            console.warn(`Failed to read MinIO history metadata ${name}:`, error);
        }
    }

    return { items, total: orderedObjects.length };
}

async function loadMinioHistoryItem(timestamp: number, image2UserId?: number): Promise<ImageHistoryItem | null> {
    const objectKey = getImageHistoryObjectKey(timestamp, image2UserId);

    try {
        return normalizeHistoryItem(await readJsonFromMinio<unknown>(objectKey), timestamp);
    } catch (error: unknown) {
        if (
            typeof error === 'object' &&
            error !== null &&
            (
                ('code' in error && (error.code === 'NoSuchKey' || error.code === 'NotFound')) ||
                ('name' in error && error.name === 'S3Error')
            )
        ) {
            return null;
        }

        console.warn(`Failed to read MinIO history metadata ${objectKey}:`, error);
        return null;
    }
}

export async function GET(request: NextRequest) {
    const startedAt = Date.now();
    const image2Session = getImage2Session(request);
    const image2UserId = image2Session?.user.id;

    if (isSub2ApiSsoEnabled() && !image2UserId) {
        return unauthorizedImage2Response(request);
    }

    if (!isSub2ApiSsoEnabled() && process.env.APP_PASSWORD) {
        const clientPasswordHash = request.nextUrl.searchParams.get('passwordHash');
        const serverPasswordHash = sha256(process.env.APP_PASSWORD);
        if (!clientPasswordHash || clientPasswordHash !== serverPasswordHash) {
            return NextResponse.json({ error: 'Unauthorized: Invalid password.' }, { status: 401 });
        }
    }

    try {
        const { page, pageSize } = getPaginationParams(request);
        const exactTimestamp = getExactTimestamp(request);
        const storageMode = getImageStorageMode();
        if (exactTimestamp !== null) {
            const item =
                storageMode === 'minio'
                    ? await loadMinioHistoryItem(exactTimestamp, image2UserId)
                    : await loadFsHistoryItem(exactTimestamp, image2UserId);
            return singleItemResponse(item);
        }

        if (storageMode === 'minio') {
            const { items, total } = await loadMinioHistoryPage(request, page, pageSize, image2UserId);
            await writeImage2RuntimeLog('api_image_history_success', {
                storageMode,
                durationMs: Date.now() - startedAt,
                total,
                page,
                pageSize
            });
            return paginatedResponse(items, total, page, pageSize);
        }

        const history = await loadFsHistory(request, image2UserId);
        const total = history.length;
        const start = (page - 1) * pageSize;
        const items = history.slice(start, start + pageSize);
        await writeImage2RuntimeLog('api_image_history_success', {
            storageMode,
            durationMs: Date.now() - startedAt,
            total,
            page,
            pageSize
        });
        return paginatedResponse(items, total, page, pageSize);
    } catch (error: unknown) {
        console.error('Error listing image history:', error);
        await writeImage2RuntimeLog('api_image_history_error', {
            durationMs: Date.now() - startedAt,
            error: error instanceof Error ? error.message : String(error)
        });
        return withNoStore(NextResponse.json({ error: 'Internal server error' }, { status: 500 }));
    }
}
