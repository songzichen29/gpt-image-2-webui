import crypto from 'crypto';
import fs from 'fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { buildApiImageUrl } from '@/lib/image-url';
import {
    ensureImageHistoryMetaDirExists,
    ensureImageOutputDirExists,
    getImageMaskObjectKey,
    getImageSourceObjectKey,
    getImageStorageMode,
    getImageFilePath,
    getImageHistoryMetaPath,
    getImageHistoryObjectKey,
    uploadJsonToMinio,
    uploadBufferToMinioByKey,
    uploadImageToMinio
} from '@/lib/server/image-storage';
import { getImage2Session, isSub2ApiSsoEnabled, unauthorizedImage2Response } from '@/lib/server/sub2api-auth';

// Streaming event types
type StreamingEvent = {
    type: 'partial_image' | 'completed' | 'error' | 'done';
    index?: number;
    partial_image_index?: number;
    b64_json?: string;
    filename?: string;
    path?: string;
    output_format?: string;
    usage?: OpenAI.Images.ImagesResponse['usage'];
    revised_prompt?: string;
    images?: Array<{
        filename: string;
        b64_json?: string;
        path?: string;
        output_format: string;
        revised_prompt?: string;
    }>;
    error?: string;
};

type ApiImageResponseItem = {
    filename: string;
    b64_json?: string;
    path?: string;
    output_format: string;
    revised_prompt?: string;
};

type ImageApiResponseBody = {
    images: ApiImageResponseItem[];
    revised_prompt?: string;
    usage?: OpenAI.Images.ImagesResponse['usage'];
};

type PersistedHistoryImage = {
    filename: string;
    revisedPrompt?: string;
};

type PersistedHistoryMetadata = {
    timestamp: number;
    images: PersistedHistoryImage[];
    status: 'completed';
    storageModeUsed: 'fs' | 'minio';
    durationMs: number;
    quality: 'auto' | 'low' | 'medium' | 'high' | 'standard' | 'hd';
    background: 'auto' | 'transparent' | 'opaque';
    moderation: 'auto' | 'low';
    prompt: string;
    revisedPrompt?: string;
    mode: 'generate' | 'edit';
    costDetails: {
        estimated_cost_usd: number;
        text_input_tokens: number;
        image_input_tokens: number;
        image_output_tokens: number;
    } | null;
    size?: string;
    output_compression?: number;
    streaming?: boolean;
    partialImages?: number;
    sourceImageCount?: number;
    hasMask?: boolean;
    output_format?: 'png' | 'jpeg' | 'webp';
    model?: string;
};

const DEFAULT_IMAGE_REQUEST_TIMEOUT_MS = 20 * 60 * 1000;
const SSE_HEARTBEAT_INTERVAL_MS = 15 * 1000;
const IN_FLIGHT_IMAGE_REQUEST_TTL_MS = 30 * 60 * 1000;

type ImageRequestLockMetadata = {
    serverRequestId: string;
    clientRequestId?: string;
    scope: string;
    mode: 'generate' | 'edit';
    promptHash: string;
    promptPreview: string;
    startedAt: number;
    userAgentHash: string;
};

const globalForImageRequestLocks = globalThis as typeof globalThis & {
    __gptImage2WebuiInFlightImageRequests?: Map<string, ImageRequestLockMetadata>;
};
const inFlightImageRequests =
    globalForImageRequestLocks.__gptImage2WebuiInFlightImageRequests ?? new Map<string, ImageRequestLockMetadata>();
globalForImageRequestLocks.__gptImage2WebuiInFlightImageRequests = inFlightImageRequests;

function getImageRequestTimeoutMs() {
    const configuredTimeout = Number.parseInt(process.env.OPENAI_IMAGE_TIMEOUT_MS || '', 10);

    if (Number.isFinite(configuredTimeout) && configuredTimeout > 0) {
        return configuredTimeout;
    }

    return DEFAULT_IMAGE_REQUEST_TIMEOUT_MS;
}

function getStringFormValue(value: FormDataEntryValue | null): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function getClientAddress(request: NextRequest): string {
    return (
        request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
        request.headers.get('x-real-ip')?.trim() ||
        'unknown'
    );
}

function getRequestScope(request: NextRequest, userId: number | undefined, clientSessionId?: string): string {
    if (userId !== undefined) {
        return `user:${userId}`;
    }

    if (clientSessionId) {
        return `session:${sha256(clientSessionId).slice(0, 16)}`;
    }

    const userAgent = request.headers.get('user-agent') || 'unknown';
    return `network:${sha256(`${getClientAddress(request)}|${userAgent}`).slice(0, 16)}`;
}

function pruneStaleImageRequestLocks(now = Date.now()) {
    for (const [key, metadata] of inFlightImageRequests.entries()) {
        if (now - metadata.startedAt > IN_FLIGHT_IMAGE_REQUEST_TTL_MS) {
            inFlightImageRequests.delete(key);
            console.warn('Pruned stale /api/images in-flight request lock:', {
                serverRequestId: metadata.serverRequestId,
                clientRequestId: metadata.clientRequestId || 'missing',
                mode: metadata.mode,
                promptHash: metadata.promptHash,
                ageMs: now - metadata.startedAt
            });
        }
    }
}

function acquireImageRequestLock(
    fingerprint: string,
    metadata: ImageRequestLockMetadata
):
    | { acquired: true; release: () => void }
    | { acquired: false; active: ImageRequestLockMetadata } {
    pruneStaleImageRequestLocks(metadata.startedAt);

    const active = inFlightImageRequests.get(fingerprint);
    if (active) {
        return { acquired: false, active };
    }

    inFlightImageRequests.set(fingerprint, metadata);
    console.log('Acquired /api/images in-flight request lock:', {
        serverRequestId: metadata.serverRequestId,
        clientRequestId: metadata.clientRequestId || 'missing',
        scope: metadata.scope,
        mode: metadata.mode,
        promptHash: metadata.promptHash,
        promptPreview: metadata.promptPreview
    });

    let released = false;
    return {
        acquired: true,
        release: () => {
            if (released) return;
            released = true;

            const activeLock = inFlightImageRequests.get(fingerprint);
            if (activeLock?.serverRequestId === metadata.serverRequestId) {
                inFlightImageRequests.delete(fingerprint);
                console.log('Released /api/images in-flight request lock:', {
                    serverRequestId: metadata.serverRequestId,
                    clientRequestId: metadata.clientRequestId || 'missing',
                    mode: metadata.mode,
                    promptHash: metadata.promptHash,
                    durationMs: Math.max(0, Date.now() - metadata.startedAt)
                });
            }
        }
    };
}

function buildImageRequestFingerprint(payload: Record<string, unknown>): string {
    return sha256(JSON.stringify(payload));
}

function getFileFingerprint(file: File) {
    return {
        name: file.name,
        size: file.size,
        type: file.type,
        lastModified: file.lastModified
    };
}

function duplicateImageRequestResponse(
    active: ImageRequestLockMetadata,
    serverRequestId: string,
    clientRequestId?: string
) {
    const ageMs = Math.max(0, Date.now() - active.startedAt);

    console.warn('Rejected duplicate /api/images request while matching request is still running:', {
        serverRequestId,
        clientRequestId: clientRequestId || 'missing',
        activeServerRequestId: active.serverRequestId,
        activeClientRequestId: active.clientRequestId || 'missing',
        mode: active.mode,
        promptHash: active.promptHash,
        activeAgeMs: ageMs
    });

    return NextResponse.json(
        {
            error: '相同参数的图片请求正在生成中，请等待当前任务完成。',
            duplicate: true,
            active_request_id: active.clientRequestId || active.serverRequestId,
            active_age_ms: ageMs
        },
        {
            status: 409,
            headers: {
                'Retry-After': '15'
            }
        }
    );
}

function getPreferredAcceptLanguage(responseLanguage: FormDataEntryValue | null, request: NextRequest): string {
    if (responseLanguage === 'zh') {
        return 'zh-CN,zh;q=0.9,en;q=0.8';
    }

    if (responseLanguage === 'en') {
        return 'en-US,en;q=0.9,zh-CN;q=0.6';
    }

    return request.headers.get('accept-language') || 'zh-CN,zh;q=0.9,en;q=0.8';
}

function withAspectInstruction(
    prompt: string,
    size: string | null | undefined,
    responseLanguage: FormDataEntryValue | null
) {
    if (!size || !size.includes('x')) {
        return prompt;
    }

    const [width, height] = size.split('x').map((value) => Number.parseInt(value, 10));

    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return prompt;
    }

    const isChinese = responseLanguage === 'zh';
    const ratioText =
        width === height
            ? '1:1'
            : `${Math.round(width / gcd(width, height))}:${Math.round(height / gcd(width, height))}`;

    if (width > height) {
        const instruction = isChinese
            ? `重要构图要求：必须严格使用 ${size} 的横向宽屏画布（${ratioText}），完整利用整个横向画面；不要改写成手机壁纸、竖屏壁纸、竖版海报或只在中间放一个竖向主体。`
            : `Important composition requirement: strictly use a ${size} landscape widescreen canvas (${ratioText}); use the full horizontal frame; do not reinterpret it as a phone wallpaper, vertical wallpaper, vertical poster, or a narrow centered subject.`;

        return `${prompt}\n\n${instruction}`;
    }

    if (height > width) {
        const instruction = isChinese
            ? `重要构图要求：必须严格使用 ${size} 的竖向画布（${ratioText}），按竖图构图，不要改写成横向宽屏画面。`
            : `Important composition requirement: strictly use a ${size} portrait canvas (${ratioText}); compose vertically and do not reinterpret it as a landscape widescreen image.`;

        return `${prompt}\n\n${instruction}`;
    }

    const instruction = isChinese
        ? `重要构图要求：必须严格使用 ${size} 的方形画布（1:1），不要改写成横向或竖向壁纸。`
        : `Important composition requirement: strictly use a ${size} square canvas (1:1); do not reinterpret it as a landscape or portrait wallpaper.`;

    return `${prompt}\n\n${instruction}`;
}

function gcd(left: number, right: number): number {
    let a = Math.abs(left);
    let b = Math.abs(right);

    while (b) {
        const remainder = a % b;
        a = b;
        b = remainder;
    }

    return a || 1;
}

// Define valid output formats for type safety
const VALID_OUTPUT_FORMATS = ['png', 'jpeg', 'webp'] as const;
type ValidOutputFormat = (typeof VALID_OUTPUT_FORMATS)[number];

// Validate and normalize output format
function validateOutputFormat(format: unknown): ValidOutputFormat {
    const normalized = String(format || 'png').toLowerCase();

    // Handle jpg -> jpeg normalization
    const mapped = normalized === 'jpg' ? 'jpeg' : normalized;

    if (VALID_OUTPUT_FORMATS.includes(mapped as ValidOutputFormat)) {
        return mapped as ValidOutputFormat;
    }

    return 'png'; // default fallback
}

function getOutputMimeType(format: ValidOutputFormat): string {
    switch (format) {
        case 'jpeg':
            return 'image/jpeg';
        case 'webp':
            return 'image/webp';
        default:
            return 'image/png';
    }
}

function detectImageFormat(buffer: Buffer): ValidOutputFormat | null {
    if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
        return 'png';
    }

    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        return 'jpeg';
    }

    if (
        buffer.length >= 12 &&
        buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
        buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    ) {
        return 'webp';
    }

    return null;
}

function mergeNumericUsageValue(left: unknown, right: unknown): unknown {
    if (typeof left === 'number' && typeof right === 'number') {
        return left + right;
    }

    if (left && right && typeof left === 'object' && typeof right === 'object') {
        const merged: Record<string, unknown> = { ...(left as Record<string, unknown>) };

        for (const [key, value] of Object.entries(right as Record<string, unknown>)) {
            merged[key] = mergeNumericUsageValue(merged[key], value);
        }

        return merged;
    }

    return right ?? left;
}

function mergeImageUsage(
    base: OpenAI.Images.ImagesResponse['usage'] | undefined,
    addition: OpenAI.Images.ImagesResponse['usage'] | undefined
): OpenAI.Images.ImagesResponse['usage'] | undefined {
    return mergeNumericUsageValue(base, addition) as OpenAI.Images.ImagesResponse['usage'] | undefined;
}

type ImageStreamEventLike = {
    type?: unknown;
    b64_json?: unknown;
    partial_image_index?: unknown;
    usage?: unknown;
    item?: unknown;
    response?: unknown;
};

function getStreamEventType(event: unknown): string {
    if (!event || typeof event !== 'object' || !('type' in event)) {
        return '';
    }

    return typeof event.type === 'string' ? event.type : '';
}

function getStreamEventKeys(event: unknown): string[] {
    return event && typeof event === 'object' ? Object.keys(event) : [];
}

function getImageGenerationCallPayloadFromStreamEvent(event: unknown): Record<string, unknown> | undefined {
    if (!event || typeof event !== 'object') {
        return undefined;
    }

    const eventType = getStreamEventType(event);

    if (eventType === 'response.output_item.done' && 'item' in event) {
        const item = (event as ImageStreamEventLike).item;
        if (item && typeof item === 'object' && 'type' in item && item.type === 'image_generation_call') {
            return item as Record<string, unknown>;
        }
    }

    if ((eventType === 'response.completed' || eventType === 'response.done') && 'response' in event) {
        const response = (event as ImageStreamEventLike).response;
        if (!response || typeof response !== 'object' || !('output' in response) || !Array.isArray(response.output)) {
            return undefined;
        }

        const match = response.output.find(
            (item) =>
                item &&
                typeof item === 'object' &&
                'type' in item &&
                item.type === 'image_generation_call' &&
                'result' in item &&
                typeof item.result === 'string' &&
                item.result
        );

        return match && typeof match === 'object' ? (match as Record<string, unknown>) : undefined;
    }

    return undefined;
}

function getStreamEventB64Json(event: unknown): string | undefined {
    if (!event || typeof event !== 'object' || !('b64_json' in event)) {
        const payload = getImageGenerationCallPayloadFromStreamEvent(event);
        const nestedResult = payload?.result;
        return typeof nestedResult === 'string' && nestedResult ? nestedResult : undefined;
    }

    const b64Json = (event as ImageStreamEventLike).b64_json;

    return typeof b64Json === 'string' && b64Json ? b64Json : undefined;
}

function getRevisedPrompt(source: unknown): string | undefined {
    if (!source || typeof source !== 'object' || !('revised_prompt' in source)) {
        return undefined;
    }

    const revisedPrompt = source.revised_prompt;

    return typeof revisedPrompt === 'string' && revisedPrompt.trim() ? revisedPrompt : undefined;
}

function getStreamEventUsage(event: unknown): OpenAI.Images.ImagesResponse['usage'] | undefined {
    if (event && typeof event === 'object' && 'usage' in event) {
        const usage = (event as ImageStreamEventLike).usage;
        if (usage && typeof usage === 'object') {
            return usage as OpenAI.Images.ImagesResponse['usage'];
        }
    }

    if (
        event &&
        typeof event === 'object' &&
        'response' in event &&
        (getStreamEventType(event) === 'response.completed' || getStreamEventType(event) === 'response.done')
    ) {
        const response = (event as ImageStreamEventLike).response;
        if (response && typeof response === 'object' && 'usage' in response && response.usage && typeof response.usage === 'object') {
            return response.usage as OpenAI.Images.ImagesResponse['usage'];
        }
    }

    return undefined;
}

function getStreamEventPartialImageIndex(event: unknown): number | undefined {
    if (!event || typeof event !== 'object' || !('partial_image_index' in event)) {
        return undefined;
    }

    const partialImageIndex = (event as ImageStreamEventLike).partial_image_index;

    return typeof partialImageIndex === 'number' ? partialImageIndex : undefined;
}

function isPartialImageStreamEvent(event: unknown): boolean {
    const eventType = getStreamEventType(event);

    return eventType.includes('partial_image') || getStreamEventPartialImageIndex(event) !== undefined;
}

function isCompletedImageStreamEvent(event: unknown): boolean {
    const eventType = getStreamEventType(event);

    if (eventType === 'response.output_item.done') {
        return Boolean(getStreamEventB64Json(event));
    }

    if (eventType === 'response.completed' || eventType === 'response.done') {
        return Boolean(getStreamEventB64Json(event));
    }

    return eventType.includes('completed') || Boolean(getStreamEventB64Json(event) && !isPartialImageStreamEvent(event));
}

async function fillMissingImages(
    result: OpenAI.Images.ImagesResponse,
    requestedCount: number,
    requestSingleImage: (() => Promise<OpenAI.Images.ImagesResponse>) | null
): Promise<OpenAI.Images.ImagesResponse> {
    const initialData = result.data ?? [];

    if (!requestSingleImage || requestedCount <= 1 || initialData.length >= requestedCount) {
        return result;
    }

    const nextData = [...initialData];
    let nextUsage = result.usage;

    while (nextData.length < requestedCount) {
        console.warn(`Image API returned ${nextData.length}/${requestedCount}; requesting one supplemental image.`);

        const supplementalResult = await requestSingleImage();
        const supplementalImages = supplementalResult.data ?? [];

        if (supplementalImages.length === 0) {
            break;
        }

        nextData.push(...supplementalImages);
        nextUsage = mergeImageUsage(nextUsage, supplementalResult.usage);
    }

    return {
        ...result,
        data: nextData.slice(0, requestedCount),
        usage: nextUsage
    };
}

function sha256(data: string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
}

function enqueueSseData(controller: ReadableStreamDefaultController<Uint8Array>, encoder: TextEncoder, data: StreamingEvent) {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
}

function enqueueSseComment(
    controller: ReadableStreamDefaultController<Uint8Array>,
    encoder: TextEncoder,
    comment: string
) {
    controller.enqueue(encoder.encode(`: ${comment}\n\n`));
}

function isClosedControllerError(error: unknown): boolean {
    return (
        error instanceof TypeError &&
        (error.message.includes('Controller is already closed') || error.message.includes('Invalid state'))
    );
}

function toCostDetails(usage: OpenAI.Images.ImagesResponse['usage'] | undefined) {
    if (!usage || !usage.input_tokens_details || typeof usage.output_tokens !== 'number') {
        return null;
    }

    const textInputTokens = usage.input_tokens_details.text_tokens ?? 0;
    const imageInputTokens = usage.input_tokens_details.image_tokens ?? 0;
    const imageOutputTokens = usage.output_tokens ?? 0;
    const estimatedCostUsd =
        textInputTokens * 0.000005 + imageInputTokens * 0.000008 + imageOutputTokens * 0.00003;

    return {
        estimated_cost_usd: Math.round(estimatedCostUsd * 10000) / 10000,
        text_input_tokens: textInputTokens,
        image_input_tokens: imageInputTokens,
        image_output_tokens: imageOutputTokens
    };
}

async function persistFsHistoryMetadata(
    metadata: PersistedHistoryMetadata,
    userId?: number
): Promise<void> {
    await ensureImageHistoryMetaDirExists(userId);
    const metadataPath = getImageHistoryMetaPath(metadata.timestamp, userId);
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
}

async function persistMinioHistoryMetadata(metadata: PersistedHistoryMetadata, userId?: number): Promise<void> {
    await uploadJsonToMinio(getImageHistoryObjectKey(metadata.timestamp, userId), metadata);
}

async function persistImageApiResult({
    effectiveStorageMode,
    historyBackground,
    historyHasMask,
    historyModeration,
    historyOutputCompression,
    historyOutputFormat,
    historyQuality,
    historySize,
    historySourceImageCount,
    image2UserId,
    mode,
    model,
    prompt,
    requestTimestamp,
    result,
    streaming
}: {
    effectiveStorageMode: 'fs' | 'indexeddb' | 'minio';
    historyBackground: PersistedHistoryMetadata['background'];
    historyHasMask: boolean;
    historyModeration: PersistedHistoryMetadata['moderation'];
    historyOutputCompression: number | undefined;
    historyOutputFormat: PersistedHistoryMetadata['output_format'];
    historyQuality: PersistedHistoryMetadata['quality'];
    historySize: string | undefined;
    historySourceImageCount: number;
    image2UserId: number | undefined;
    mode: 'generate' | 'edit';
    model: OpenAI.Images.ImageGenerateParams['model'] | OpenAI.Images.ImageEditParams['model'];
    prompt: string;
    requestTimestamp: number;
    result: OpenAI.Images.ImagesResponse;
    streaming: boolean;
}): Promise<ImageApiResponseBody> {
    if (!result || !Array.isArray(result.data) || result.data.length === 0) {
        console.error('Invalid or empty data received from OpenAI API:', result);
        throw new Error('Failed to retrieve image data from API.');
    }

    const savedImagesData = await Promise.all(
        result.data.map(async (imageData, index) => {
            if (!imageData.b64_json) {
                console.error(`Image data ${index} is missing b64_json.`);
                throw new Error(`Image data at index ${index} is missing base64 data.`);
            }

            const buffer = Buffer.from(imageData.b64_json, 'base64');
            const detectedFormat = detectImageFormat(buffer);
            const fileExtension = detectedFormat || historyOutputFormat || 'png';
            const filename = `${requestTimestamp}-${index}.${fileExtension}`;
            if (detectedFormat && historyOutputFormat && detectedFormat !== historyOutputFormat) {
                console.warn('Image API returned bytes that do not match requested output format:', {
                    requestedFormat: historyOutputFormat,
                    detectedFormat,
                    filename
                });
            }

            if (effectiveStorageMode === 'fs') {
                const filepath = getImageFilePath(filename, image2UserId);
                console.log(`Attempting to save image to: ${filepath}`);
                await fs.writeFile(filepath, buffer);
                console.log(`Successfully saved image: ${filename}`);
            } else if (effectiveStorageMode === 'minio') {
                await uploadImageToMinio(filename, buffer, image2UserId, getOutputMimeType(fileExtension));
            }

            const revisedPrompt = getRevisedPrompt(imageData);
            const imagePath =
                effectiveStorageMode === 'fs' || effectiveStorageMode === 'minio'
                    ? buildApiImageUrl(filename, requestTimestamp)
                    : undefined;
            const shouldInlineImageData = effectiveStorageMode === 'indexeddb';
            const imageResult: ApiImageResponseItem = {
                filename,
                output_format: fileExtension,
                ...(shouldInlineImageData ? { b64_json: imageData.b64_json } : {}),
                ...(imagePath ? { path: imagePath } : {}),
                ...(revisedPrompt ? { revised_prompt: revisedPrompt } : {})
            };

            return imageResult;
        })
    );

    console.log(`All images processed. Mode: ${effectiveStorageMode}`);

    const revisedPrompt = savedImagesData.find((image) => image.revised_prompt)?.revised_prompt;
    const metadata: PersistedHistoryMetadata = {
        timestamp: requestTimestamp,
        images: savedImagesData.map((image) => ({
            filename: image.filename,
            ...(image.revised_prompt ? { revisedPrompt: image.revised_prompt } : {})
        })),
        status: 'completed',
        storageModeUsed: effectiveStorageMode === 'minio' ? 'minio' : 'fs',
        durationMs: Math.max(0, Date.now() - requestTimestamp),
        quality: historyQuality,
        background: historyBackground,
        moderation: historyModeration,
        prompt,
        ...(revisedPrompt ? { revisedPrompt } : {}),
        mode,
        costDetails: toCostDetails(result.usage),
        size: historySize,
        output_compression: historyOutputCompression,
        streaming,
        partialImages: undefined,
        sourceImageCount: historySourceImageCount,
        hasMask: historyHasMask,
        output_format: historyOutputFormat,
        model: String(model)
    };

    if (effectiveStorageMode === 'fs') {
        await persistFsHistoryMetadata(metadata, image2UserId);
    } else if (effectiveStorageMode === 'minio') {
        await persistMinioHistoryMetadata(metadata, image2UserId);
    }

    return {
        images: savedImagesData,
        ...(revisedPrompt ? { revised_prompt: revisedPrompt } : {}),
        usage: result.usage
    };
}

function createSseImageResponse(run: (send: (data: StreamingEvent) => boolean) => Promise<void>) {
    const encoder = new TextEncoder();

    const readableStream = new ReadableStream({
        async start(controller) {
            let streamClosed = false;
            const safeClose = () => {
                if (streamClosed) return;
                streamClosed = true;
                try {
                    controller.close();
                } catch {}
            };
            const safeEnqueueComment = (comment: string) => {
                if (streamClosed) return false;
                try {
                    enqueueSseComment(controller, encoder, comment);
                    return true;
                } catch (error) {
                    if (isClosedControllerError(error)) {
                        streamClosed = true;
                        return false;
                    }
                    throw error;
                }
            };
            const safeEnqueueData = (data: StreamingEvent) => {
                if (streamClosed) return false;
                try {
                    enqueueSseData(controller, encoder, data);
                    return true;
                } catch (error) {
                    if (isClosedControllerError(error)) {
                        streamClosed = true;
                        return false;
                    }
                    throw error;
                }
            };

            safeEnqueueComment('connected');
            const heartbeat = setInterval(() => {
                try {
                    if (!safeEnqueueComment('keep-alive')) {
                        clearInterval(heartbeat);
                    }
                } catch {
                    clearInterval(heartbeat);
                }
            }, SSE_HEARTBEAT_INTERVAL_MS);

            try {
                await run(safeEnqueueData);
            } catch (error) {
                console.error('SSE image response error:', error);
                safeEnqueueData({
                    type: 'error',
                    error: error instanceof Error ? error.message : 'Image request failed'
                });
            } finally {
                clearInterval(heartbeat);
                safeClose();
            }
        }
    });

    return new Response(readableStream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no'
        }
    });
}

function sendImageApiResponseEvents(send: (data: StreamingEvent) => boolean, body: ImageApiResponseBody) {
    for (const [index, image] of body.images.entries()) {
        if (
            !send({
                type: 'completed',
                index,
                filename: image.filename,
                b64_json: image.b64_json,
                path: image.path,
                output_format: image.output_format,
                revised_prompt: image.revised_prompt
            })
        ) {
            return;
        }
    }

    send({
        type: 'done',
        images: body.images,
        revised_prompt: body.revised_prompt,
        usage: body.usage
    });
}

export async function POST(request: NextRequest) {
    const serverRequestId = crypto.randomUUID();
    console.log('Received POST request to /api/images:', { serverRequestId });

    try {
        const effectiveStorageMode = getImageStorageMode();
        console.log('Effective Image Storage Mode:', { serverRequestId, effectiveStorageMode });

        const image2Session = getImage2Session(request);
        const image2UserId = image2Session?.user.id;

        if (isSub2ApiSsoEnabled() && !image2UserId) {
            return unauthorizedImage2Response(request);
        }

        if (effectiveStorageMode === 'fs') {
            await ensureImageOutputDirExists(image2UserId);
        }

        const formData = await request.formData();

        if (!isSub2ApiSsoEnabled() && process.env.APP_PASSWORD) {
            const clientPasswordHash = formData.get('passwordHash') as string | null;
            if (!clientPasswordHash) {
                console.error('Missing password hash.');
                return NextResponse.json({ error: 'Unauthorized: Missing password hash.' }, { status: 401 });
            }
            const serverPasswordHash = sha256(process.env.APP_PASSWORD);
            if (clientPasswordHash !== serverPasswordHash) {
                console.error('Invalid password hash.');
                return NextResponse.json({ error: 'Unauthorized: Invalid password.' }, { status: 401 });
            }
        }

        const localApiKey = (formData.get('apiKey') as string | null)?.trim();
        const responseLanguage = formData.get('responseLanguage');
        const clientRequestId = getStringFormValue(formData.get('client_request_id'));
        const clientSessionId = getStringFormValue(formData.get('client_session_id'));
        const acceptLanguage = getPreferredAcceptLanguage(responseLanguage, request);
        const apiKey = localApiKey || process.env.OPENAI_API_KEY;
        const baseURL = process.env.OPENAI_API_BASE_URL?.trim();

        if (!apiKey) {
            console.error('No API key was provided by local settings or OPENAI_API_KEY.');
            return NextResponse.json(
                { error: 'API key not found. Add one in Settings or configure OPENAI_API_KEY.' },
                { status: 500 }
            );
        }

        const imageRequestTimeoutMs = getImageRequestTimeoutMs();
        const openai = new OpenAI({
            apiKey,
            baseURL: baseURL || undefined,
            timeout: imageRequestTimeoutMs,
            defaultHeaders: {
                'Accept-Language': acceptLanguage
            }
        });
        console.log('OpenAI image request timeout:', { serverRequestId, timeoutMs: imageRequestTimeoutMs });
        console.log('OpenAI image request language:', { serverRequestId, acceptLanguage });

        const mode = formData.get('mode') as 'generate' | 'edit' | null;
        const prompt = formData.get('prompt') as string | null;
        const historyTimestampRaw = formData.get('history_timestamp');
        const historyTimestampParsed =
            typeof historyTimestampRaw === 'string' ? Number.parseInt(historyTimestampRaw, 10) : Number.NaN;
        const requestTimestamp = Number.isFinite(historyTimestampParsed) && historyTimestampParsed > 0
            ? historyTimestampParsed
            : Date.now();
        const model = ((formData.get('model') as string | null)?.trim() || 'gpt-image-2') as
            | OpenAI.Images.ImageGenerateParams['model']
            | OpenAI.Images.ImageEditParams['model'];

        console.log('Image request parsed:', {
            serverRequestId,
            clientRequestId: clientRequestId || 'missing',
            clientSessionHash: clientSessionId ? sha256(clientSessionId).slice(0, 16) : 'missing',
            clientAddress: getClientAddress(request),
            userAgentHash: sha256(request.headers.get('user-agent') || 'unknown').slice(0, 16),
            mode,
            model,
            promptHash: prompt ? sha256(prompt).slice(0, 16) : 'missing',
            promptPreview: prompt ? `${prompt.substring(0, 50)}...` : 'N/A'
        });

        if (!mode || !prompt) {
            return NextResponse.json({ error: 'Missing required parameters: mode and prompt' }, { status: 400 });
        }

        const requestScope = getRequestScope(request, image2UserId, clientSessionId);
        const promptHash = sha256(prompt).slice(0, 16);
        const promptPreview = `${prompt.substring(0, 50)}${prompt.length > 50 ? '...' : ''}`;
        const userAgentHash = sha256(request.headers.get('user-agent') || 'unknown').slice(0, 16);

        // Check for streaming mode
        const streamRequested = formData.get('stream') === 'true';
        const partialImagesCount = parseInt((formData.get('partial_images') as string) || '2', 10);

        let result: OpenAI.Images.ImagesResponse;
        let requestedImageCount = 1;
        let requestSingleImage: (() => Promise<OpenAI.Images.ImagesResponse>) | null = null;
        let historyQuality: PersistedHistoryMetadata['quality'] = 'auto';
        let historyBackground: PersistedHistoryMetadata['background'] = 'auto';
        let historyModeration: PersistedHistoryMetadata['moderation'] = 'auto';
        let historySize: string | undefined;
        let historyOutputCompression: number | undefined;
        let historySourceImageCount = 0;
        let historyHasMask = false;
        let historyOutputFormat: PersistedHistoryMetadata['output_format'] = 'png';

        if (mode === 'generate') {
            const n = parseInt((formData.get('n') as string) || '1', 10);
            requestedImageCount = Math.max(1, Math.min(n || 1, 10));
            // gpt-image-2 accepts arbitrary WxH strings that the SDK's narrow literal union doesn't express.
            const size = ((formData.get('size') as string) || '1024x1024') as OpenAI.Images.ImageGenerateParams['size'];
            const quality = (formData.get('quality') as OpenAI.Images.ImageGenerateParams['quality']) || 'auto';
            const output_format =
                (formData.get('output_format') as OpenAI.Images.ImageGenerateParams['output_format']) || 'png';
            const output_compression_str = formData.get('output_compression') as string | null;
            const background =
                (formData.get('background') as OpenAI.Images.ImageGenerateParams['background']) || 'auto';
            const moderation =
                (formData.get('moderation') as OpenAI.Images.ImageGenerateParams['moderation']) || 'auto';
            historyQuality = quality;
            historyBackground = background;
            historyModeration = moderation;
            historySize = size ?? undefined;
            const promptWithAspectInstruction = withAspectInstruction(prompt, size, responseLanguage);
            historyOutputFormat = validateOutputFormat(output_format);

            const baseParams = {
                model,
                prompt: promptWithAspectInstruction,
                n: requestedImageCount,
                size,
                quality,
                output_format,
                background,
                moderation
            };

            if ((output_format === 'jpeg' || output_format === 'webp') && output_compression_str) {
                const compression = parseInt(output_compression_str, 10);
                if (!isNaN(compression) && compression >= 0 && compression <= 100) {
                    (baseParams as OpenAI.Images.ImageGenerateParams).output_compression = compression;
                    historyOutputCompression = compression;
                }
            }

            // Handle streaming mode for generation.
            // 仅在客户端显式请求 stream=true 时才返回 SSE；
            // 单图请求 (n=1) 不应被强制升级为流式，否则前端未勾选流式时也会收到 text/event-stream。
            const shouldUseStreamingResponse = streamRequested;

            if (shouldUseStreamingResponse) {
                const actualPartialImages = Math.max(1, Math.min(streamRequested ? partialImagesCount : 1, 3)) as
                    | 1
                    | 2
                    | 3;
                const requestFingerprint = buildImageRequestFingerprint({
                    scope: requestScope,
                    mode: 'generate',
                    model: String(model),
                    prompt: promptWithAspectInstruction,
                    n: requestedImageCount,
                    size: String(size),
                    quality: String(quality),
                    output_format: String(output_format),
                    output_compression:
                        'output_compression' in baseParams && typeof baseParams.output_compression === 'number'
                            ? baseParams.output_compression
                            : null,
                    background: String(background),
                    moderation: String(moderation),
                    stream: true,
                    partial_images: actualPartialImages
                });
                const requestLock = acquireImageRequestLock(requestFingerprint, {
                    serverRequestId,
                    clientRequestId,
                    scope: requestScope,
                    mode: 'generate',
                    promptHash,
                    promptPreview,
                    startedAt: Date.now(),
                    userAgentHash
                });

                if (!requestLock.acquired) {
                    return duplicateImageRequestResponse(requestLock.active, serverRequestId, clientRequestId);
                }
                const releaseStreamingImageRequestLock = requestLock.release;

                const streamParams = {
                    ...baseParams,
                    stream: true as const,
                    partial_images: actualPartialImages
                };

                console.log('Calling OpenAI generate with streaming, params:', streamParams);

                // Create SSE response immediately so the client receives headers/heartbeats
                // while we are still waiting for the upstream image stream to start.
                const encoder = new TextEncoder();
                const timestamp = requestTimestamp;
                const fileExtension = validateOutputFormat(output_format);
                const shouldInlineImageData = effectiveStorageMode === 'indexeddb';

                const readableStream = new ReadableStream({
                    async start(controller) {
                        let streamClosed = false;
                        const safeClose = () => {
                            if (streamClosed) return;
                            streamClosed = true;
                            try {
                                controller.close();
                            } catch {}
                        };
                        const safeEnqueueComment = (comment: string) => {
                            if (streamClosed) return false;
                            try {
                                enqueueSseComment(controller, encoder, comment);
                                return true;
                            } catch (error) {
                                if (isClosedControllerError(error)) {
                                    streamClosed = true;
                                    return false;
                                }
                                throw error;
                            }
                        };
                        const safeEnqueueData = (data: StreamingEvent) => {
                            if (streamClosed) return false;
                            try {
                                enqueueSseData(controller, encoder, data);
                                return true;
                            } catch (error) {
                                if (isClosedControllerError(error)) {
                                    streamClosed = true;
                                    return false;
                                }
                                throw error;
                            }
                        };

                        safeEnqueueComment('connected');
                        const heartbeat = setInterval(() => {
                            try {
                                if (!safeEnqueueComment('keep-alive')) {
                                    clearInterval(heartbeat);
                                }
                            } catch {
                                clearInterval(heartbeat);
                            }
                        }, SSE_HEARTBEAT_INTERVAL_MS);

                        try {
                            const stream = await openai.images.generate(streamParams);
                            const completedImages: Array<{
                                filename: string;
                                b64_json?: string;
                                path?: string;
                                output_format: string;
                            }> = [];
                            let finalUsage: OpenAI.Images.ImagesResponse['usage'] | undefined;
                            let imageIndex = 0;
                            let lastPartialB64Json: string | undefined;
                            const acceptedCompletedImageHashes = new Set<string>();

                            for await (const event of stream) {
                                const eventType = getStreamEventType(event);
                                const b64Json = getStreamEventB64Json(event);
                                const partialImageIndex = getStreamEventPartialImageIndex(event);

                                if (isPartialImageStreamEvent(event)) {
                                    if (b64Json) {
                                        lastPartialB64Json = b64Json;
                                    }
                                    const partialEvent: StreamingEvent = {
                                        type: 'partial_image',
                                        index: imageIndex,
                                        partial_image_index: partialImageIndex,
                                        b64_json: b64Json
                                    };
                                    if (!safeEnqueueData(partialEvent)) {
                                        break;
                                    }
                                } else if (isCompletedImageStreamEvent(event)) {
                                    if (!b64Json) {
                                        console.log('Streaming: Ignored completed event without image data:', {
                                            type: eventType || 'unknown',
                                            keys: getStreamEventKeys(event)
                                        });
                                        continue;
                                    }

                                    if (completedImages.length >= requestedImageCount) {
                                        console.log('Streaming: Ignored extra completed image event:', {
                                            type: eventType || 'unknown',
                                            requestedImageCount
                                        });
                                        finalUsage = mergeImageUsage(finalUsage, getStreamEventUsage(event));
                                        continue;
                                    }

                                    const completedImageHash = sha256(b64Json);
                                    if (acceptedCompletedImageHashes.has(completedImageHash)) {
                                        console.log('Streaming: Ignored duplicate completed image event:', {
                                            type: eventType || 'unknown'
                                        });
                                        finalUsage = mergeImageUsage(finalUsage, getStreamEventUsage(event));
                                        continue;
                                    }
                                    acceptedCompletedImageHashes.add(completedImageHash);

                                    const currentIndex = imageIndex;
                                    const filename = `${timestamp}-${currentIndex}.${fileExtension}`;

                                    // Save to filesystem if in fs mode
                                    if (effectiveStorageMode === 'fs' && b64Json) {
                                        const buffer = Buffer.from(b64Json, 'base64');
                                        const filepath = getImageFilePath(filename, image2UserId);
                                        await fs.writeFile(filepath, buffer);
                                        console.log(`Streaming: Saved image ${filename}`);
                                    } else if (effectiveStorageMode === 'minio' && b64Json) {
                                        const buffer = Buffer.from(b64Json, 'base64');
                                        await uploadImageToMinio(filename, buffer, image2UserId, getOutputMimeType(fileExtension));
                                    }

                                    const savedPath =
                                        effectiveStorageMode === 'fs' || effectiveStorageMode === 'minio'
                                            ? buildApiImageUrl(filename, timestamp)
                                            : undefined;
                                    const imageData = {
                                        filename,
                                        output_format: fileExtension,
                                        ...(shouldInlineImageData && b64Json ? { b64_json: b64Json } : {}),
                                        ...(savedPath ? { path: savedPath } : {})
                                    };
                                    completedImages.push(imageData);

                                    const completedEvent: StreamingEvent = {
                                        type: 'completed',
                                        index: currentIndex,
                                        filename,
                                        b64_json: shouldInlineImageData ? b64Json : undefined,
                                        path: savedPath,
                                        output_format: fileExtension
                                    };
                                    if (!safeEnqueueData(completedEvent)) {
                                        break;
                                    }

                                    imageIndex++;

                                    // Capture usage from completed event if available
                                    finalUsage = mergeImageUsage(finalUsage, getStreamEventUsage(event));
                                } else {
                                    console.log('Streaming: Ignored image generation event:', {
                                        type: eventType || 'unknown',
                                        keys: getStreamEventKeys(event)
                                    });
                                }
                            }

                            if (completedImages.length === 0 && lastPartialB64Json) {
                                const filename = `${timestamp}-0.${fileExtension}`;
                                if (effectiveStorageMode === 'fs') {
                                    const buffer = Buffer.from(lastPartialB64Json, 'base64');
                                    const filepath = getImageFilePath(filename, image2UserId);
                                    await fs.writeFile(filepath, buffer);
                                } else if (effectiveStorageMode === 'minio') {
                                    const buffer = Buffer.from(lastPartialB64Json, 'base64');
                                    await uploadImageToMinio(filename, buffer, image2UserId, getOutputMimeType(fileExtension));
                                }

                                const savedPath =
                                    effectiveStorageMode === 'fs' || effectiveStorageMode === 'minio'
                                        ? buildApiImageUrl(filename, timestamp)
                                        : undefined;
                                completedImages.push({
                                    filename,
                                    output_format: fileExtension,
                                    ...(shouldInlineImageData ? { b64_json: lastPartialB64Json } : {}),
                                    ...(savedPath ? { path: savedPath } : {})
                                });
                                console.warn('Streaming: No completed event received; using the last partial image.');

                                const fallbackEvent: StreamingEvent = {
                                    type: 'completed',
                                    index: 0,
                                    filename,
                                    b64_json: shouldInlineImageData ? lastPartialB64Json : undefined,
                                    path: savedPath,
                                    output_format: fileExtension
                                };
                                safeEnqueueData(fallbackEvent);
                            }

                            // Send final done event with all images and usage
                            const doneEvent: StreamingEvent = {
                                type: 'done',
                                images: completedImages,
                                usage: finalUsage
                            };
                            if (completedImages.length > 0) {
                                if (effectiveStorageMode === 'fs') {
                                    await persistFsHistoryMetadata(
                                        {
                                            timestamp,
                                            images: completedImages.map((image) => ({
                                                filename: image.filename
                                            })),
                                            status: 'completed',
                                            storageModeUsed: 'fs',
                                            durationMs: Math.max(0, Date.now() - timestamp),
                                            quality,
                                            background,
                                            moderation,
                                            prompt,
                                            mode: 'generate',
                                            costDetails: toCostDetails(finalUsage),
                                            size: size ?? undefined,
                                            output_compression:
                                                'output_compression' in baseParams &&
                                                typeof baseParams.output_compression === 'number'
                                                    ? baseParams.output_compression
                                                    : undefined,
                                            streaming: true,
                                            partialImages: actualPartialImages,
                                            sourceImageCount: 0,
                                            hasMask: false,
                                            output_format: fileExtension,
                                            model: String(model)
                                        },
                                        image2UserId
                                    );
                                } else if (effectiveStorageMode === 'minio') {
                                    await persistMinioHistoryMetadata(
                                        {
                                            timestamp,
                                            images: completedImages.map((image) => ({
                                                filename: image.filename
                                            })),
                                            status: 'completed',
                                            storageModeUsed: 'minio',
                                            durationMs: Math.max(0, Date.now() - timestamp),
                                            quality,
                                            background,
                                            moderation,
                                            prompt,
                                            mode: 'generate',
                                            costDetails: toCostDetails(finalUsage),
                                            size: size ?? undefined,
                                            output_compression:
                                                'output_compression' in baseParams &&
                                                typeof baseParams.output_compression === 'number'
                                                    ? baseParams.output_compression
                                                    : undefined,
                                            streaming: true,
                                            partialImages: actualPartialImages,
                                            sourceImageCount: 0,
                                            hasMask: false,
                                            output_format: fileExtension,
                                            model: String(model)
                                        },
                                        image2UserId
                                    );
                                }
                            }
                            clearInterval(heartbeat);
                            safeEnqueueData(doneEvent);
                            safeClose();
                        } catch (error) {
                            console.error('Streaming error:', error);
                            const errorEvent: StreamingEvent = {
                                type: 'error',
                                error: error instanceof Error ? error.message : 'Streaming error occurred'
                            };
                            clearInterval(heartbeat);
                            safeEnqueueData(errorEvent);
                            safeClose();
                        } finally {
                            releaseStreamingImageRequestLock();
                        }
                    }
                });

                return new Response(readableStream, {
                    headers: {
                        'Content-Type': 'text/event-stream',
                        'Cache-Control': 'no-cache',
                        Connection: 'keep-alive',
                        'X-Accel-Buffering': 'no'
                    }
                });
            }

            const params: OpenAI.Images.ImageGenerateParams = baseParams;
            requestSingleImage = () => openai.images.generate({ ...params, n: 1 });
            const requestFingerprint = buildImageRequestFingerprint({
                scope: requestScope,
                mode: 'generate',
                model: String(model),
                prompt: promptWithAspectInstruction,
                n: requestedImageCount,
                size: String(size),
                quality: String(quality),
                output_format: String(output_format),
                output_compression:
                    'output_compression' in baseParams && typeof baseParams.output_compression === 'number'
                        ? baseParams.output_compression
                        : null,
                background: String(background),
                moderation: String(moderation),
                stream: false
            });
            const requestLock = acquireImageRequestLock(requestFingerprint, {
                serverRequestId,
                clientRequestId,
                scope: requestScope,
                mode: 'generate',
                promptHash,
                promptPreview,
                startedAt: Date.now(),
                userAgentHash
            });

            if (!requestLock.acquired) {
                return duplicateImageRequestResponse(requestLock.active, serverRequestId, clientRequestId);
            }
            console.log('Calling OpenAI generate with params:', params);
            return createSseImageResponse(async (send) => {
                try {
                    result = await openai.images.generate(params);
                    console.log('OpenAI API call successful.');
                    result = await fillMissingImages(result, requestedImageCount, requestSingleImage);
                    const responseBody = await persistImageApiResult({
                        effectiveStorageMode,
                        historyBackground,
                        historyHasMask,
                        historyModeration,
                        historyOutputCompression,
                        historyOutputFormat,
                        historyQuality,
                        historySize,
                        historySourceImageCount,
                        image2UserId,
                        mode: 'generate',
                        model,
                        prompt,
                        requestTimestamp,
                        result,
                        streaming: false
                    });
                    sendImageApiResponseEvents(send, responseBody);
                } finally {
                    requestLock.release();
                }
            });
        } else if (mode === 'edit') {
            const n = parseInt((formData.get('n') as string) || '1', 10);
            requestedImageCount = Math.max(1, Math.min(n || 1, 10));
            // gpt-image-2 accepts arbitrary WxH strings that the SDK's narrow literal union doesn't express.
            const size = ((formData.get('size') as string) || 'auto') as OpenAI.Images.ImageEditParams['size'];
            const quality = (formData.get('quality') as OpenAI.Images.ImageEditParams['quality']) || 'auto';
            historyQuality = quality;
            historySize = size && size !== 'auto' ? size : undefined;
            historyOutputFormat = 'png';

            const imageFiles: File[] = [];
            for (const [key, value] of formData.entries()) {
                if (key.startsWith('image_') && value instanceof File) {
                    imageFiles.push(value);
                }
            }
            historySourceImageCount = imageFiles.length;

            if (imageFiles.length === 0) {
                return NextResponse.json({ error: 'No image file provided for editing.' }, { status: 400 });
            }

            const maskFile = formData.get('mask') as File | null;
            historyHasMask = Boolean(maskFile);

            const baseEditParams = {
                model,
                prompt: withAspectInstruction(prompt, size === 'auto' ? undefined : size, responseLanguage),
                image: imageFiles,
                n: requestedImageCount,
                size: size === 'auto' ? undefined : size,
                quality: quality === 'auto' ? undefined : quality
            };
            const editPromptWithAspectInstruction = baseEditParams.prompt;
            const imageFileFingerprints = imageFiles.map(getFileFingerprint);
            const maskFileFingerprint = maskFile ? getFileFingerprint(maskFile) : null;
            const persistEditSourceFilesToMinio = async () => {
                if (effectiveStorageMode !== 'minio') {
                    return;
                }

                await Promise.all(
                    imageFiles.map(async (file) => {
                        const buffer = Buffer.from(await file.arrayBuffer());
                        await uploadBufferToMinioByKey(
                            getImageSourceObjectKey(file.name, image2UserId, requestTimestamp),
                            buffer,
                            file.type || 'application/octet-stream'
                        );
                    })
                );

                if (maskFile) {
                    const maskBuffer = Buffer.from(await maskFile.arrayBuffer());
                    await uploadBufferToMinioByKey(
                        getImageMaskObjectKey(maskFile.name, image2UserId, requestTimestamp),
                        maskBuffer,
                        maskFile.type || 'image/png'
                    );
                }
            };

            // Handle streaming mode for editing
            if (streamRequested) {
                const streamEditParams = {
                    ...baseEditParams,
                    stream: true as const,
                    partial_images: Math.max(1, Math.min(partialImagesCount, 3)) as 1 | 2 | 3,
                    ...(maskFile ? { mask: maskFile } : {})
                };
                const requestFingerprint = buildImageRequestFingerprint({
                    scope: requestScope,
                    mode: 'edit',
                    model: String(model),
                    prompt: editPromptWithAspectInstruction,
                    n: requestedImageCount,
                    size: size === 'auto' ? null : String(size),
                    quality: quality === 'auto' ? null : String(quality),
                    imageFiles: imageFileFingerprints,
                    maskFile: maskFileFingerprint,
                    stream: true,
                    partial_images: streamEditParams.partial_images
                });
                const requestLock = acquireImageRequestLock(requestFingerprint, {
                    serverRequestId,
                    clientRequestId,
                    scope: requestScope,
                    mode: 'edit',
                    promptHash,
                    promptPreview,
                    startedAt: Date.now(),
                    userAgentHash
                });

                if (!requestLock.acquired) {
                    return duplicateImageRequestResponse(requestLock.active, serverRequestId, clientRequestId);
                }
                const releaseStreamingImageRequestLock = requestLock.release;
                try {
                    await persistEditSourceFilesToMinio();
                } catch (error) {
                    releaseStreamingImageRequestLock();
                    throw error;
                }

                console.log('Calling OpenAI edit with streaming, params:', {
                    ...baseEditParams,
                    stream: true,
                    partial_images: streamEditParams.partial_images,
                    image: `[${imageFiles.map((f) => f.name).join(', ')}]`,
                    mask: maskFile ? maskFile.name : 'N/A'
                });

                // Create SSE response for edit immediately so the client receives
                // headers/heartbeats while waiting for the upstream stream.
                const encoder = new TextEncoder();
                const timestamp = requestTimestamp;
                const fileExtension = 'png'; // Edit mode always outputs PNG
                const shouldInlineImageData = effectiveStorageMode === 'indexeddb';

                const readableStream = new ReadableStream({
                    async start(controller) {
                        let streamClosed = false;
                        const safeClose = () => {
                            if (streamClosed) return;
                            streamClosed = true;
                            try {
                                controller.close();
                            } catch {}
                        };
                        const safeEnqueueComment = (comment: string) => {
                            if (streamClosed) return false;
                            try {
                                enqueueSseComment(controller, encoder, comment);
                                return true;
                            } catch (error) {
                                if (isClosedControllerError(error)) {
                                    streamClosed = true;
                                    return false;
                                }
                                throw error;
                            }
                        };
                        const safeEnqueueData = (data: StreamingEvent) => {
                            if (streamClosed) return false;
                            try {
                                enqueueSseData(controller, encoder, data);
                                return true;
                            } catch (error) {
                                if (isClosedControllerError(error)) {
                                    streamClosed = true;
                                    return false;
                                }
                                throw error;
                            }
                        };

                        safeEnqueueComment('connected');
                        const heartbeat = setInterval(() => {
                            try {
                                if (!safeEnqueueComment('keep-alive')) {
                                    clearInterval(heartbeat);
                                }
                            } catch {
                                clearInterval(heartbeat);
                            }
                        }, SSE_HEARTBEAT_INTERVAL_MS);

                        try {
                            const stream = await openai.images.edit(streamEditParams);
                            const completedImages: Array<{
                                filename: string;
                                b64_json?: string;
                                path?: string;
                                output_format: string;
                            }> = [];
                            let finalUsage: OpenAI.Images.ImagesResponse['usage'] | undefined;
                            let imageIndex = 0;
                            let lastPartialB64Json: string | undefined;
                            const acceptedCompletedImageHashes = new Set<string>();

                            for await (const event of stream) {
                                const eventType = getStreamEventType(event);
                                const b64Json = getStreamEventB64Json(event);
                                const partialImageIndex = getStreamEventPartialImageIndex(event);

                                if (isPartialImageStreamEvent(event)) {
                                    if (b64Json) {
                                        lastPartialB64Json = b64Json;
                                    }
                                    const partialEvent: StreamingEvent = {
                                        type: 'partial_image',
                                        index: imageIndex,
                                        partial_image_index: partialImageIndex,
                                        b64_json: b64Json
                                    };
                                    if (!safeEnqueueData(partialEvent)) {
                                        break;
                                    }
                                } else if (isCompletedImageStreamEvent(event)) {
                                    if (!b64Json) {
                                        console.log('Streaming edit: Ignored completed event without image data:', {
                                            type: eventType || 'unknown',
                                            keys: getStreamEventKeys(event)
                                        });
                                        continue;
                                    }

                                    if (completedImages.length >= requestedImageCount) {
                                        console.log('Streaming edit: Ignored extra completed image event:', {
                                            type: eventType || 'unknown',
                                            requestedImageCount
                                        });
                                        finalUsage = mergeImageUsage(finalUsage, getStreamEventUsage(event));
                                        continue;
                                    }

                                    const completedImageHash = sha256(b64Json);
                                    if (acceptedCompletedImageHashes.has(completedImageHash)) {
                                        console.log('Streaming edit: Ignored duplicate completed image event:', {
                                            type: eventType || 'unknown'
                                        });
                                        finalUsage = mergeImageUsage(finalUsage, getStreamEventUsage(event));
                                        continue;
                                    }
                                    acceptedCompletedImageHashes.add(completedImageHash);

                                    const currentIndex = imageIndex;
                                    const filename = `${timestamp}-${currentIndex}.${fileExtension}`;

                                    // Save to filesystem if in fs mode
                                    if (effectiveStorageMode === 'fs' && b64Json) {
                                        const buffer = Buffer.from(b64Json, 'base64');
                                        const filepath = getImageFilePath(filename, image2UserId);
                                        await fs.writeFile(filepath, buffer);
                                        console.log(`Streaming edit: Saved image ${filename}`);
                                    } else if (effectiveStorageMode === 'minio' && b64Json) {
                                        const buffer = Buffer.from(b64Json, 'base64');
                                        await uploadImageToMinio(filename, buffer, image2UserId, getOutputMimeType(fileExtension));
                                    }

                                    const savedPath =
                                        effectiveStorageMode === 'fs' || effectiveStorageMode === 'minio'
                                            ? buildApiImageUrl(filename, timestamp)
                                            : undefined;
                                    const imageData = {
                                        filename,
                                        output_format: fileExtension,
                                        ...(shouldInlineImageData && b64Json ? { b64_json: b64Json } : {}),
                                        ...(savedPath ? { path: savedPath } : {})
                                    };
                                    completedImages.push(imageData);

                                    const completedEvent: StreamingEvent = {
                                        type: 'completed',
                                        index: currentIndex,
                                        filename,
                                        b64_json: shouldInlineImageData ? b64Json : undefined,
                                        path: savedPath,
                                        output_format: fileExtension
                                    };
                                    if (!safeEnqueueData(completedEvent)) {
                                        break;
                                    }

                                    imageIndex++;

                                    // Capture usage from completed event if available
                                    finalUsage = mergeImageUsage(finalUsage, getStreamEventUsage(event));
                                } else {
                                    console.log('Streaming edit: Ignored image event:', {
                                        type: eventType || 'unknown',
                                        keys: getStreamEventKeys(event)
                                    });
                                }
                            }

                            if (completedImages.length === 0 && lastPartialB64Json) {
                                const filename = `${timestamp}-0.${fileExtension}`;
                                if (effectiveStorageMode === 'fs') {
                                    const buffer = Buffer.from(lastPartialB64Json, 'base64');
                                    const filepath = getImageFilePath(filename, image2UserId);
                                    await fs.writeFile(filepath, buffer);
                                } else if (effectiveStorageMode === 'minio') {
                                    const buffer = Buffer.from(lastPartialB64Json, 'base64');
                                    await uploadImageToMinio(filename, buffer, image2UserId, getOutputMimeType(fileExtension));
                                }

                                const savedPath =
                                    effectiveStorageMode === 'fs' || effectiveStorageMode === 'minio'
                                        ? buildApiImageUrl(filename, timestamp)
                                        : undefined;
                                completedImages.push({
                                    filename,
                                    output_format: fileExtension,
                                    ...(shouldInlineImageData ? { b64_json: lastPartialB64Json } : {}),
                                    ...(savedPath ? { path: savedPath } : {})
                                });
                                console.warn('Streaming edit: No completed event received; using the last partial image.');

                                const fallbackEvent: StreamingEvent = {
                                    type: 'completed',
                                    index: 0,
                                    filename,
                                    b64_json: shouldInlineImageData ? lastPartialB64Json : undefined,
                                    path: savedPath,
                                    output_format: fileExtension
                                };
                                safeEnqueueData(fallbackEvent);
                            }

                            // Send final done event with all images and usage
                            const doneEvent: StreamingEvent = {
                                type: 'done',
                                images: completedImages,
                                usage: finalUsage
                            };
                            if (completedImages.length > 0) {
                                if (effectiveStorageMode === 'fs') {
                                    await persistFsHistoryMetadata(
                                        {
                                            timestamp,
                                            images: completedImages.map((image) => ({
                                                filename: image.filename
                                            })),
                                            status: 'completed',
                                            storageModeUsed: 'fs',
                                            durationMs: Math.max(0, Date.now() - timestamp),
                                            quality,
                                            background: 'auto',
                                            moderation: 'auto',
                                            prompt,
                                            mode: 'edit',
                                            costDetails: toCostDetails(finalUsage),
                                            size: size && size !== 'auto' ? size : undefined,
                                            output_compression: undefined,
                                            streaming: true,
                                            partialImages: Math.max(1, Math.min(partialImagesCount, 3)),
                                            sourceImageCount: imageFiles.length,
                                            hasMask: Boolean(maskFile),
                                            output_format: 'png',
                                            model: String(model)
                                        },
                                        image2UserId
                                    );
                                } else if (effectiveStorageMode === 'minio') {
                                    await persistMinioHistoryMetadata(
                                        {
                                            timestamp,
                                            images: completedImages.map((image) => ({
                                                filename: image.filename
                                            })),
                                            status: 'completed',
                                            storageModeUsed: 'minio',
                                            durationMs: Math.max(0, Date.now() - timestamp),
                                            quality,
                                            background: 'auto',
                                            moderation: 'auto',
                                            prompt,
                                            mode: 'edit',
                                            costDetails: toCostDetails(finalUsage),
                                            size: size && size !== 'auto' ? size : undefined,
                                            output_compression: undefined,
                                            streaming: true,
                                            partialImages: Math.max(1, Math.min(partialImagesCount, 3)),
                                            sourceImageCount: imageFiles.length,
                                            hasMask: Boolean(maskFile),
                                            output_format: 'png',
                                            model: String(model)
                                        },
                                        image2UserId
                                    );
                                }
                            }
                            clearInterval(heartbeat);
                            safeEnqueueData(doneEvent);
                            safeClose();
                        } catch (error) {
                            console.error('Streaming edit error:', error);
                            const errorEvent: StreamingEvent = {
                                type: 'error',
                                error: error instanceof Error ? error.message : 'Streaming error occurred'
                            };
                            clearInterval(heartbeat);
                            safeEnqueueData(errorEvent);
                            safeClose();
                        } finally {
                            releaseStreamingImageRequestLock();
                        }
                    }
                });

                return new Response(readableStream, {
                    headers: {
                        'Content-Type': 'text/event-stream',
                        'Cache-Control': 'no-cache',
                        Connection: 'keep-alive',
                        'X-Accel-Buffering': 'no'
                    }
                });
            }

            const params: OpenAI.Images.ImageEditParams = {
                ...baseEditParams,
                ...(maskFile ? { mask: maskFile } : {})
            };
            requestSingleImage = () => openai.images.edit({ ...params, n: 1 });
            const requestFingerprint = buildImageRequestFingerprint({
                scope: requestScope,
                mode: 'edit',
                model: String(model),
                prompt: editPromptWithAspectInstruction,
                n: requestedImageCount,
                size: size === 'auto' ? null : String(size),
                quality: quality === 'auto' ? null : String(quality),
                imageFiles: imageFileFingerprints,
                maskFile: maskFileFingerprint,
                stream: false
            });
            const requestLock = acquireImageRequestLock(requestFingerprint, {
                serverRequestId,
                clientRequestId,
                scope: requestScope,
                mode: 'edit',
                promptHash,
                promptPreview,
                startedAt: Date.now(),
                userAgentHash
            });

            if (!requestLock.acquired) {
                return duplicateImageRequestResponse(requestLock.active, serverRequestId, clientRequestId);
            }
            try {
                await persistEditSourceFilesToMinio();
            } catch (error) {
                requestLock.release();
                throw error;
            }

            console.log('Calling OpenAI edit with params:', {
                ...params,
                image: `[${imageFiles.map((f) => f.name).join(', ')}]`,
                mask: maskFile ? maskFile.name : 'N/A'
            });
            return createSseImageResponse(async (send) => {
                try {
                    result = await openai.images.edit(params);
                    console.log('OpenAI API call successful.');
                    result = await fillMissingImages(result, requestedImageCount, requestSingleImage);
                    const responseBody = await persistImageApiResult({
                        effectiveStorageMode,
                        historyBackground,
                        historyHasMask,
                        historyModeration,
                        historyOutputCompression,
                        historyOutputFormat,
                        historyQuality,
                        historySize,
                        historySourceImageCount,
                        image2UserId,
                        mode: 'edit',
                        model,
                        prompt,
                        requestTimestamp,
                        result,
                        streaming: false
                    });
                    sendImageApiResponseEvents(send, responseBody);
                } finally {
                    requestLock.release();
                }
            });
        } else {
            return NextResponse.json({ error: 'Invalid mode specified' }, { status: 400 });
        }

    } catch (error: unknown) {
        console.error('Error in /api/images:', error);

        let errorMessage = 'An unexpected error occurred.';
        let status = 500;

        if (error instanceof Error) {
            errorMessage = error.message;
            if (typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number') {
                status = error.status;
            }
        } else if (typeof error === 'object' && error !== null) {
            if ('message' in error && typeof error.message === 'string') {
                errorMessage = error.message;
            }
            if ('status' in error && typeof error.status === 'number') {
                status = error.status;
            }
        }

        return NextResponse.json({ error: errorMessage }, { status });
    }
}
