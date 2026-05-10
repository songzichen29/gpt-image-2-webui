import { NextRequest, NextResponse } from 'next/server';

const protectedPagePattern = /^\/(?:$|history(?:\/.*)?$)/;
const image2SessionCookie = 'image2_session';

type Image2SessionPayload = {
    user?: {
        id?: number;
    };
    expiresAt?: number;
};

function isSub2ApiSsoEnabled(): boolean {
    return Boolean(process.env.SUB2API_BASE_URL?.trim());
}

function getSub2ApiOrigin(): string | null {
    const raw = process.env.SUB2API_BASE_URL?.trim();
    if (!raw) return null;

    try {
        return new URL(raw).origin;
    } catch {
        return null;
    }
}

function getSub2ApiLoginUrl(request: NextRequest): string | null {
    const configuredLoginUrl = process.env.SUB2API_LOGIN_URL?.trim();
    const sub2ApiOrigin = getSub2ApiOrigin();
    const baseLoginUrl = configuredLoginUrl || (sub2ApiOrigin ? `${sub2ApiOrigin}/login` : null);
    if (!baseLoginUrl) return null;

    try {
        const loginUrl = new URL(baseLoginUrl);
        const entryUrl = process.env.SUB2API_IMAGE2_ENTRY_URL?.trim() || request.nextUrl.origin;
        loginUrl.searchParams.set('redirect', entryUrl);
        return loginUrl.toString();
    } catch {
        return baseLoginUrl;
    }
}

function withNoStoreHeaders(response: NextResponse): NextResponse {
    response.headers.set('Cache-Control', 'private, no-cache, no-store, max-age=0, must-revalidate');
    response.headers.append('Vary', 'Cookie');
    response.headers.append('Vary', 'Authorization');
    return response;
}

function base64UrlToBytes(value: string): Uint8Array {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index++) {
        bytes[index] = binary.charCodeAt(index);
    }

    return bytes;
}

function timingSafeEqualBytes(left: Uint8Array, right: Uint8Array): boolean {
    if (left.length !== right.length) return false;

    let diff = 0;
    for (let index = 0; index < left.length; index++) {
        diff |= left[index] ^ right[index];
    }

    return diff === 0;
}

async function verifyImage2SessionToken(token: string | undefined): Promise<boolean> {
    if (!token) return false;

    const [encodedPayload, signature, ...extra] = token.split('.');
    if (!encodedPayload || !signature || extra.length > 0) return false;

    const secret = process.env.IMAGE2_SESSION_SECRET?.trim();
    if (!secret) {
        return true;
    }

    try {
        const key = await crypto.subtle.importKey(
            'raw',
            new TextEncoder().encode(secret),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign']
        );
        const expectedSignature = new Uint8Array(
            await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(encodedPayload))
        );
        if (!timingSafeEqualBytes(expectedSignature, base64UrlToBytes(signature))) {
            return false;
        }

        const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(encodedPayload))) as Image2SessionPayload;
        const userId = payload.user?.id;
        const expiresAt = payload.expiresAt;

        return Boolean(
            Number.isFinite(userId) &&
                typeof userId === 'number' &&
                userId > 0 &&
                Number.isFinite(expiresAt) &&
                typeof expiresAt === 'number' &&
                expiresAt > Math.floor(Date.now() / 1000)
        );
    } catch {
        return false;
    }
}

export async function proxy(request: NextRequest) {
    if (!isSub2ApiSsoEnabled() || !protectedPagePattern.test(request.nextUrl.pathname)) {
        return NextResponse.next();
    }

    if (
        request.nextUrl.searchParams.has('token') ||
        (await verifyImage2SessionToken(request.cookies.get(image2SessionCookie)?.value))
    ) {
        return withNoStoreHeaders(NextResponse.next());
    }

    const loginUrl = getSub2ApiLoginUrl(request);
    if (!loginUrl) {
        return withNoStoreHeaders(NextResponse.next());
    }

    const response = NextResponse.redirect(loginUrl);
    return withNoStoreHeaders(response);
}

export const config = {
    matcher: ['/', '/history/:path*']
};
