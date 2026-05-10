import { createReadStream } from 'fs';
import fs from 'fs/promises';
import { lookup } from 'mime-types';
import { NextRequest, NextResponse } from 'next/server';
import { getImageFilePath, getImageStorageMode, getMinioImageBuffer, isValidImageFilename } from '@/lib/server/image-storage';
import { getImage2Session, isSub2ApiSsoEnabled, unauthorizedImage2Response } from '@/lib/server/sub2api-auth';

function detectImageContentType(buffer: Buffer, filename: string): string {
    if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
        return 'image/png';
    }

    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        return 'image/jpeg';
    }

    if (
        buffer.length >= 12 &&
        buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
        buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    ) {
        return 'image/webp';
    }

    return lookup(filename) || 'application/octet-stream';
}

const imageResponseHeaders = {
    'Cache-Control': 'private, no-cache, no-store, max-age=0, must-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
    Vary: 'Cookie, Authorization'
};

export async function GET(request: NextRequest, { params }: { params: Promise<{ filename: string }> }) {
    const { filename } = await params;

    if (!isValidImageFilename(filename)) {
        return NextResponse.json({ error: 'Filename is required' }, { status: 400 });
    }

    const image2Session = getImage2Session(request);
    const image2UserId = image2Session?.user.id;
    if (isSub2ApiSsoEnabled() && !image2UserId) {
        return unauthorizedImage2Response(request);
    }

    try {
        if (getImageStorageMode() === 'minio') {
            const buffer = await getMinioImageBuffer(filename, image2UserId);
            if (!buffer) {
                return NextResponse.json({ error: 'Image not found' }, { status: 404 });
            }

            return new NextResponse(buffer, {
                status: 200,
                headers: {
                    ...imageResponseHeaders,
                    'Content-Type': detectImageContentType(buffer, filename),
                    'Content-Length': buffer.length.toString()
                }
            });
        }

        const filepath = getImageFilePath(filename, image2UserId);
        const fileStats = await fs.stat(filepath);
        const probe = await fs.open(filepath, 'r');
        const headerBuffer = Buffer.alloc(16);
        let bytesRead = 0;
        try {
            const readResult = await probe.read(headerBuffer, 0, headerBuffer.length, 0);
            bytesRead = readResult.bytesRead;
        } finally {
            await probe.close();
        }
        const contentType = detectImageContentType(headerBuffer.subarray(0, bytesRead), filename);
        const fileStream = createReadStream(filepath);

        return new NextResponse(fileStream as unknown as ReadableStream, {
            status: 200,
            headers: {
                ...imageResponseHeaders,
                'Content-Type': contentType,
                'Content-Length': fileStats.size.toString()
            }
        });
    } catch (error: unknown) {
        console.error(`Error serving image ${filename}:`, error);
        if (
            typeof error === 'object' &&
            error !== null &&
            (
                ('code' in error && (error.code === 'ENOENT' || error.code === 'NoSuchKey' || error.code === 'NotFound')) ||
                ('name' in error && error.name === 'S3Error')
            )
        ) {
            return NextResponse.json({ error: 'Image not found' }, { status: 404 });
        }
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
