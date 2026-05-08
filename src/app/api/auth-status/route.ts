import { NextRequest, NextResponse } from 'next/server';
import { getImage2Session, getSub2ApiLoginUrl, isSub2ApiSsoEnabled } from '@/lib/server/sub2api-auth';

export async function GET(request: NextRequest) {
    const configuredBaseUrl = process.env.OPENAI_API_BASE_URL?.trim() || '';

    let keysUrl: string | null = null;
    if (configuredBaseUrl) {
        try {
            keysUrl = new URL('/keys', new URL(configuredBaseUrl).origin).toString();
        } catch {
            keysUrl = null;
        }
    }

    if (isSub2ApiSsoEnabled()) {
        const session = getImage2Session(request);
        return NextResponse.json({
            authMode: 'sub2api',
            authenticated: Boolean(session),
            user: session?.user ?? null,
            loginUrl: session ? null : getSub2ApiLoginUrl(request),
            passwordRequired: false,
            configuredBaseUrl,
            keysUrl
        });
    }

    const appPasswordSet = !!process.env.APP_PASSWORD;

    return NextResponse.json({
        authMode: 'password',
        authenticated: !appPasswordSet,
        passwordRequired: appPasswordSet,
        configuredBaseUrl,
        keysUrl
    });
}
