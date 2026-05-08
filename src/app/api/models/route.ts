import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { getImage2Session, isSub2ApiSsoEnabled, unauthorizedImage2Response } from '@/lib/server/sub2api-auth';

type ModelsRequestBody = {
    apiKey?: string;
    passwordHash?: string;
};

function sha256(data: string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
}

function normalizeModelIds(ids: string[]): string[] {
    const seen = new Set<string>();
    const normalized: string[] = [];

    for (const id of ids) {
        const trimmedId = id.trim();
        if (!trimmedId || seen.has(trimmedId)) continue;

        seen.add(trimmedId);
        normalized.push(trimmedId);
    }

    return normalized;
}

export async function POST(request: NextRequest) {
    let body: ModelsRequestBody = {};

    try {
        body = (await request.json()) as ModelsRequestBody;
    } catch {
        body = {};
    }

    if (isSub2ApiSsoEnabled() && !getImage2Session(request)) {
        return unauthorizedImage2Response(request);
    }

    if (!isSub2ApiSsoEnabled() && process.env.APP_PASSWORD) {
        if (!body.passwordHash) {
            return NextResponse.json({ error: 'Unauthorized: Missing password hash.' }, { status: 401 });
        }

        const serverPasswordHash = sha256(process.env.APP_PASSWORD);
        if (body.passwordHash !== serverPasswordHash) {
            return NextResponse.json({ error: 'Unauthorized: Invalid password.' }, { status: 401 });
        }
    }

    const apiKey = body.apiKey?.trim() || process.env.OPENAI_API_KEY;
    const baseURL = process.env.OPENAI_API_BASE_URL?.trim();

    if (!apiKey) {
        return NextResponse.json({ error: 'API key not found. Add one or configure OPENAI_API_KEY.' }, { status: 400 });
    }

    try {
        const openai = new OpenAI({
            apiKey,
            baseURL: baseURL || undefined,
            timeout: 30_000
        });

        const response = await openai.models.list();
        const models = normalizeModelIds(response.data.map((model) => model.id));

        return NextResponse.json({ models });
    } catch (error: unknown) {
        let errorMessage = 'Failed to fetch models.';
        let status = 500;

        if (error instanceof Error) {
            errorMessage = error.message;
            if ('status' in error && typeof error.status === 'number') {
                status = error.status;
            }
        }

        return NextResponse.json({ error: errorMessage }, { status });
    }
}
