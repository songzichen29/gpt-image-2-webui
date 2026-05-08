import crypto from 'crypto';
import fs from 'fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import { getImageOutputDir, isValidImageFilename } from '@/lib/server/image-storage';
import { getImage2Session, isSub2ApiSsoEnabled, unauthorizedImage2Response } from '@/lib/server/sub2api-auth';

const imageFilenamePattern = /^(\d+)-(\d+)\.(png|jpe?g|webp)$/i;
const defaultPage = 1;
const defaultPageSize = 20;
const maxPageSize = 1000;

type ImageHistoryItem = {
    timestamp: number;
    images: Array<{ filename: string }>;
    status: 'completed';
    storageModeUsed: 'fs';
    durationMs: number;
    quality: 'auto';
    background: 'auto';
    moderation: 'auto';
    prompt: string;
    mode: 'generate';
    costDetails: null;
    output_format: 'png' | 'jpeg' | 'webp';
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

    return NextResponse.json({
        code: 0,
        message: 'success',
        data: {
            items,
            total,
            page,
            page_size: pageSize,
            pages
        }
    });
}

function getOutputFormat(filename: string): 'png' | 'jpeg' | 'webp' {
    const extension = filename.split('.').pop()?.toLowerCase();
    if (extension === 'jpg' || extension === 'jpeg') return 'jpeg';
    if (extension === 'webp') return 'webp';
    return 'png';
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
        const since = getSinceTimestamp(request);
        const sortOrder = getSortOrder(request);
        const outputDir = getImageOutputDir(image2UserId);
        const dirEntries = await fs.readdir(outputDir, { withFileTypes: true });
        const groups = new Map<number, Array<{ filename: string; index: number; outputFormat: 'png' | 'jpeg' | 'webp' }>>();

        dirEntries.forEach((entry) => {
            if (!entry.isFile() || !isValidImageFilename(entry.name)) return;

            const match = entry.name.match(imageFilenamePattern);
            if (!match) return;

            const timestamp = Number(match[1]);
            const imageIndex = Number(match[2]);
            if (!Number.isFinite(timestamp) || !Number.isFinite(imageIndex)) return;
            if (since !== null && timestamp < since) return;

            const images = groups.get(timestamp) ?? [];
            images.push({
                filename: entry.name,
                index: imageIndex,
                outputFormat: getOutputFormat(entry.name)
            });
            groups.set(timestamp, images);
        });

        const history: ImageHistoryItem[] = Array.from(groups.entries())
            .map(([timestamp, images]) => {
                const orderedImages = images.sort((left, right) => left.index - right.index);
                return {
                    timestamp,
                    images: orderedImages.map((image) => ({ filename: image.filename })),
                    status: 'completed' as const,
                    storageModeUsed: 'fs' as const,
                    durationMs: 0,
                    quality: 'auto' as const,
                    background: 'auto' as const,
                    moderation: 'auto' as const,
                    prompt: '',
                    mode: 'generate' as const,
                    costDetails: null,
                    output_format: orderedImages[0]?.outputFormat ?? 'png'
                };
            })
            .sort((left, right) =>
                sortOrder === 'asc' ? left.timestamp - right.timestamp : right.timestamp - left.timestamp
            );

        const total = history.length;
        const start = (page - 1) * pageSize;
        const items = history.slice(start, start + pageSize);

        return paginatedResponse(items, total, page, pageSize);
    } catch (error: unknown) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
            const { page, pageSize } = getPaginationParams(request);
            return paginatedResponse([], 0, page, pageSize);
        }

        console.error('Error listing image history:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
