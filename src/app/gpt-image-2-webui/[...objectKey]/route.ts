import { lookup } from 'mime-types';
import { NextRequest, NextResponse } from 'next/server';
import { getMinioObjectBufferByKey } from '@/lib/server/image-storage';

const allowedPublicImageObjectPattern = /^(?:legacy|\d+)\/[^/]+\.(?:png|jpe?g|webp)$/i;

function detectImageContentType(buffer: Buffer, objectKey: string): string {
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

    return lookup(objectKey) || 'application/octet-stream';
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ objectKey: string[] }> }) {
    const { objectKey: objectKeyParts } = await params;
    const objectKey = objectKeyParts.join('/');

    if (!allowedPublicImageObjectPattern.test(objectKey)) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    try {
        const buffer = await getMinioObjectBufferByKey(objectKey);
        if (!buffer) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        return new NextResponse(buffer, {
            status: 200,
            headers: {
                'Content-Type': detectImageContentType(buffer, objectKey),
                'Content-Length': buffer.length.toString(),
                'Cache-Control': 'public, max-age=31536000, immutable'
            }
        });
    } catch (error: unknown) {
        if (
            typeof error === 'object' &&
            error !== null &&
            (
                ('code' in error && (error.code === 'NoSuchKey' || error.code === 'NotFound')) ||
                ('name' in error && error.name === 'S3Error')
            )
        ) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }

        console.error(`Error serving public MinIO image ${objectKey}:`, error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
