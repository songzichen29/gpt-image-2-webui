import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

export type Image2User = {
    id: number;
    email?: string;
    username?: string;
    role?: string;
};

type Image2SessionPayload = {
    user: Image2User;
    issuedAt: number;
    expiresAt: number;
};

type Sub2ApiUserResponse = {
    code?: number;
    data?: {
        id?: number;
        email?: string;
        username?: string;
        role?: string;
    };
};

export const IMAGE2_SESSION_COOKIE = 'image2_session';
const DEFAULT_SESSION_TTL_SECONDS = 12 * 60 * 60;
const runtimeSessionSecret = crypto.randomBytes(32).toString('hex');
let warnedAboutRuntimeSecret = false;

export function isSub2ApiSsoEnabled(): boolean {
    return Boolean(process.env.SUB2API_BASE_URL?.trim());
}

function getSessionSecret(): string {
    const configured = process.env.IMAGE2_SESSION_SECRET?.trim();
    if (configured) return configured;

    if (isSub2ApiSsoEnabled() && !warnedAboutRuntimeSecret) {
        warnedAboutRuntimeSecret = true;
        console.warn('IMAGE2_SESSION_SECRET is not configured; image2 sessions will be invalid after server restart.');
    }

    return runtimeSessionSecret;
}

function getSessionTtlSeconds(): number {
    const configured = Number.parseInt(process.env.IMAGE2_SESSION_TTL_SECONDS || '', 10);
    return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_SESSION_TTL_SECONDS;
}

function base64UrlEncode(input: string): string {
    return Buffer.from(input, 'utf8').toString('base64url');
}

function base64UrlDecode(input: string): string {
    return Buffer.from(input, 'base64url').toString('utf8');
}

function signPayload(payload: string): string {
    return crypto.createHmac('sha256', getSessionSecret()).update(payload).digest('base64url');
}

function timingSafeEqualString(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    if (leftBuffer.length !== rightBuffer.length) return false;

    return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function createSessionToken(user: Image2User): string {
    const now = Math.floor(Date.now() / 1000);
    const payload: Image2SessionPayload = {
        user,
        issuedAt: now,
        expiresAt: now + getSessionTtlSeconds()
    };
    const encodedPayload = base64UrlEncode(JSON.stringify(payload));
    return `${encodedPayload}.${signPayload(encodedPayload)}`;
}

export function verifySessionToken(token: string | undefined): Image2SessionPayload | null {
    if (!token) return null;

    const [encodedPayload, signature, ...extra] = token.split('.');
    if (!encodedPayload || !signature || extra.length > 0) return null;

    const expectedSignature = signPayload(encodedPayload);
    if (!timingSafeEqualString(signature, expectedSignature)) return null;

    try {
        const payload = JSON.parse(base64UrlDecode(encodedPayload)) as Image2SessionPayload;
        if (!payload.user || !Number.isFinite(payload.user.id) || payload.user.id <= 0) return null;
        if (!Number.isFinite(payload.expiresAt) || payload.expiresAt <= Math.floor(Date.now() / 1000)) return null;

        return payload;
    } catch {
        return null;
    }
}

export function getImage2Session(request: NextRequest): Image2SessionPayload | null {
    return verifySessionToken(request.cookies.get(IMAGE2_SESSION_COOKIE)?.value);
}

function isSecureRequest(request: NextRequest): boolean {
    const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
    if (forwardedProto) {
        return forwardedProto === 'https';
    }

    return request.nextUrl.protocol === 'https:';
}

export function setImage2SessionCookie(response: NextResponse, request: NextRequest, user: Image2User): void {
    const sameSite = (process.env.IMAGE2_COOKIE_SAMESITE || 'lax').toLowerCase() === 'none' ? 'none' : 'lax';
    const configuredSecure = process.env.IMAGE2_COOKIE_SECURE?.trim().toLowerCase();
    const secure =
        configuredSecure === 'true'
            ? true
            : configuredSecure === 'false'
              ? false
              : sameSite === 'none'
                ? true
                : isSecureRequest(request);

    response.cookies.set(IMAGE2_SESSION_COOKIE, createSessionToken(user), {
        httpOnly: true,
        maxAge: getSessionTtlSeconds(),
        path: '/',
        sameSite,
        secure
    });
}

export function clearImage2SessionCookie(response: NextResponse): void {
    response.cookies.set(IMAGE2_SESSION_COOKIE, '', {
        httpOnly: true,
        maxAge: 0,
        path: '/',
        sameSite: 'lax'
    });
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

export function getSub2ApiAuthMeUrl(): string | null {
    const raw = process.env.SUB2API_BASE_URL?.trim();
    if (!raw) return null;

    try {
        const baseUrl = new URL(raw);
        const trimmedPath = baseUrl.pathname.replace(/\/+$/, '');
        const apiPrefix = trimmedPath.endsWith('/api/v1') ? trimmedPath : `${trimmedPath}/api/v1`;
        baseUrl.pathname = `${apiPrefix}/auth/me`.replace(/\/+/g, '/');
        baseUrl.search = '';
        baseUrl.hash = '';
        return baseUrl.toString();
    } catch {
        return null;
    }
}

export function getSub2ApiLoginUrl(request: NextRequest): string | null {
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

export async function verifySub2ApiToken(token: string): Promise<Image2User> {
    const authMeUrl = getSub2ApiAuthMeUrl();
    if (!authMeUrl) {
        throw new Error('SUB2API_BASE_URL is not configured.');
    }

    const response = await fetch(authMeUrl, {
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json'
        },
        cache: 'no-store'
    });

    if (response.status === 401 || response.status === 403) {
        throw new Error('SUB2API_TOKEN_INVALID');
    }

    if (!response.ok) {
        throw new Error('SUB2API_AUTH_UNAVAILABLE');
    }

    const payload = (await response.json()) as Sub2ApiUserResponse;
    const user = payload.data;
    if (!user || !Number.isFinite(user.id) || !user.id) {
        throw new Error('SUB2API_AUTH_UNAVAILABLE');
    }

    return {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role
    };
}

export function unauthorizedImage2Response(request: NextRequest, message = 'Unauthorized: image2 session required.') {
    return NextResponse.json(
        {
            error: message,
            loginUrl: getSub2ApiLoginUrl(request)
        },
        {
            status: 401,
            headers: {
                'Cache-Control': 'no-store, max-age=0',
                Vary: 'Cookie, Authorization'
            }
        }
    );
}
