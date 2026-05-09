import { NextRequest, NextResponse } from 'next/server';
import {
    clearImage2SessionCookie,
    getSub2ApiLoginUrl,
    isSub2ApiSsoEnabled,
    setImage2SessionCookie,
    verifySub2ApiToken
} from '@/lib/server/sub2api-auth';

type ExchangeRequestBody = {
    token?: string;
    source?: string;
};

export async function POST(request: NextRequest) {
    if (!isSub2ApiSsoEnabled()) {
        return NextResponse.json({ authenticated: false, error: 'SUB2API_SSO_DISABLED' }, { status: 404 });
    }

    let body: ExchangeRequestBody = {};
    try {
        body = (await request.json()) as ExchangeRequestBody;
    } catch {
        body = {};
    }

    const token = body.token?.trim();
    if (!token) {
        const response = NextResponse.json(
            {
                authenticated: false,
                error: 'SUB2API_TOKEN_MISSING',
                loginUrl: getSub2ApiLoginUrl(request)
            },
            { status: 401 }
        );
        clearImage2SessionCookie(response);
        return response;
    }

    try {
        const user = await verifySub2ApiToken(token);
        const response = NextResponse.json({ authenticated: true, user });
        setImage2SessionCookie(response, request, user);
        return response;
    } catch (error) {
        const message = error instanceof Error ? error.message : 'SUB2API_AUTH_UNAVAILABLE';
        const status = message === 'SUB2API_TOKEN_INVALID' ? 401 : 502;
        const response = NextResponse.json(
            {
                authenticated: false,
                error: message,
                loginUrl: getSub2ApiLoginUrl(request)
            },
            { status }
        );
        clearImage2SessionCookie(response);
        return response;
    }
}
