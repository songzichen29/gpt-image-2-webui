import crypto from 'crypto';
import fs from 'fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import {
    getImageHistoryMetaDir,
    getImageOutputDir,
    getImageStorageMode,
    listMinioObjectNames,
    readJsonFromMinio,
    isValidImageFilename
} from '@/lib/server/image-storage';
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
    quality: 'auto';
    background: 'auto';
    moderation: 'auto';
    prompt: string;
    mode: 'generate';
    costDetails: null;
    output_format: 'png' | 'jpeg' | 'webp';
    revisedPrompt?: string;
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

function getSortOrder(request: NextRequest): 'asc' | 'desc' {
    return request.nextUrl.searchParams.get('sort_order')?.toLowerCase() === 'asc' ? 'asc' : 'desc';
}

function paginatedResponse(items: ImageHistoryItem[], total: number, page: number, pageSize: number) {
    const pages = Math.max(1, Math.ceil(total / pageSize));
    return NextResponse.json({ code: 0, message: 'success', data: { items, total, page, page_size: pageSize, pages } });
}

function getOutputFormat(filename: string): 'png' | 'jpeg' | 'webp' {
    const extension = filename.split('.').pop()?.toLowerCase();
    if (extension === 'jpg' || extension === 'jpeg') return 'jpeg';
    if (extension === 'webp') return 'webp';
    return 'png';
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
                const parsed = JSON.parse(raw) as ImageHistoryItem;
                if (parsed && parsed.timestamp === timestamp && Array.isArray(parsed.images) && parsed.status === 'completed') {
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
            storageModeUsed: 'minio',
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

async function loadMinioHistory(request: NextRequest, image2UserId?: number): Promise<ImageHistoryItem[]> {
    const since = getSinceTimestamp(request);
    const sortOrder = getSortOrder(request);
    const prefix = image2UserId ? `${image2UserId}/.history/` : 'legacy/.history/';
    const names = await listMinioObjectNames(prefix);
    const history: ImageHistoryItem[] = [];

    for (const name of names) {
        const fileName = name.split('/').pop() ?? '';
        const timestamp = Number.parseInt(fileName.replace(/\.json$/i, ''), 10);
        if (!Number.isFinite(timestamp) || timestamp <= 0) continue;
        if (since !== null && timestamp < since) continue;
        const metadata = await readJsonFromMinio<ImageHistoryItem>(name);
        if (metadata?.timestamp === timestamp) history.push(metadata);
    }

    return history.sort((left, right) => (sortOrder === 'asc' ? left.timestamp - right.timestamp : right.timestamp - left.timestamp));
}

export async function GET(request: NextRequest) {
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
        const storageMode = getImageStorageMode();
        const history = storageMode === 'minio' ? await loadMinioHistory(request, image2UserId) : await loadFsHistory(request, image2UserId);
        const total = history.length;
        const start = (page - 1) * pageSize;
        const items = history.slice(start, start + pageSize);
        return paginatedResponse(items, total, page, pageSize);
    } catch (error: unknown) {
        console.error('Error listing image history:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
