'use client';

import { EditingForm, type EditingFormData } from '@/components/editing-form';
import { GenerationForm, type GenerationFormData } from '@/components/generation-form';
import { GenerationWorkspace } from '@/components/generation-workspace';
import { ApiInfoPanel } from '@/components/home/api-info-panel';
import { HelpNotes } from '@/components/home/help-notes';
import { MobileBottomNav } from '@/components/home/mobile-bottom-nav';
import { MobileParametersPanel } from '@/components/home/mobile-parameters-panel';
import { PreferencesPanel } from '@/components/home/preferences-panel';
import { AppTopbar } from '@/components/home/app-topbar';
import { ImageOutput } from '@/components/image-output';
import { PasswordDialog } from '@/components/password-dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useHomeAuth } from '@/hooks/use-home-auth';
import { useHomeHistory } from '@/hooks/use-home-history';
import { useModelPreferences } from '@/hooks/use-model-preferences';
import { useAppSettings } from '@/lib/app-settings';
import { calculateApiCost, formatUsdCny, type CostDetails, type GptImageModel } from '@/lib/cost-utils';
import { db, LEGACY_IMAGE_USER_ID, type ImageRecord } from '@/lib/db';
import { formatOptionLabel, useI18n } from '@/lib/i18n';
import { getPresetDimensions, validateGptImage2Size } from '@/lib/size-utils';
import { useLiveQuery } from 'dexie-react-hooks';
import { RotateCcw } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useRouter } from 'next/navigation';
import * as React from 'react';

type HistoryImage = {
    filename: string;
};

export type HistoryMetadata = {
    timestamp: number;
    images: HistoryImage[];
    status?: 'pending' | 'completed' | 'error';
    errorMessage?: string;
    storageModeUsed?: 'fs' | 'indexeddb' | 'minio';
    durationMs: number;
    quality: GenerationFormData['quality'];
    background: GenerationFormData['background'];
    moderation: GenerationFormData['moderation'];
    prompt: string;
    mode: 'generate' | 'edit';
    costDetails: CostDetails | null;
    size?: string;
    output_compression?: number;
    streaming?: boolean;
    partialImages?: number;
    sourceImageCount?: number;
    hasMask?: boolean;
    output_format?: GenerationFormData['output_format'];
    model?: GptImageModel;
};

type DrawnPoint = {
    x: number;
    y: number;
    size: number;
};

const MAX_EDIT_IMAGES = 10;

const explicitModeClient = process.env.NEXT_PUBLIC_IMAGE_STORAGE_MODE;

const vercelEnvClient = process.env.NEXT_PUBLIC_VERCEL_ENV;
const isOnVercelClient = vercelEnvClient === 'production' || vercelEnvClient === 'preview';

let effectiveStorageModeClient: 'fs' | 'indexeddb' | 'minio';

if (explicitModeClient === 'fs') {
    effectiveStorageModeClient = 'fs';
} else if (explicitModeClient === 'minio') {
    effectiveStorageModeClient = 'minio';
} else if (explicitModeClient === 'indexeddb') {
    effectiveStorageModeClient = 'indexeddb';
} else if (isOnVercelClient) {
    effectiveStorageModeClient = 'indexeddb';
} else {
    effectiveStorageModeClient = 'fs';
}
console.log(
    `Client Effective Storage Mode: ${effectiveStorageModeClient} (Explicit: ${explicitModeClient || 'unset'}, Vercel Env: ${vercelEnvClient || 'N/A'})`
);

type ApiImageResponseItem = {
    filename: string;
    b64_json?: string;
    output_format: string;
    path?: string;
};

type ImageBatchItem = {
    path: string;
    filename: string;
};

type ApiUsageForCost = Parameters<typeof calculateApiCost>[0];

type ImageApiResult = {
    images?: ApiImageResponseItem[];
    usage?: ApiUsageForCost;
    error?: string;
    loginUrl?: string;
};

type ApiResponseInfo = {
    status: 'loading' | 'success' | 'error';
    endpoint: string;
    method: string;
    startedAt: number;
    durationMs?: number;
    httpStatus?: number;
    contentType?: string | null;
    responseKind?: 'event-stream' | 'json';
    mode: 'generate' | 'edit';
    model: string;
    size: string;
    n: number;
    stream: boolean;
    partialImages?: number;
    storageMode: 'fs' | 'indexeddb' | 'minio';
    imageCount?: number;
    filenames?: string[];
    costUsd?: number;
    error?: string;
    streamingStats?: {
        partialImages: number;
        completedImages: number;
        doneReceived: boolean;
    };
};

function formatApiDuration(durationMs?: number): string {
    if (durationMs === undefined) return '-';
    if (durationMs < 1000) return `${durationMs}ms`;

    return `${(durationMs / 1000).toFixed(1)}s`;
}

function formatContentType(contentType?: string | null): string {
    return contentType?.split(';')[0] || '-';
}

export default function HomePage() {
    const router = useRouter();
    const { language, languagePreference, setLanguagePreference, t } = useI18n();
    const { settings, modelOptions, saveSettings } = useAppSettings();
    const { resolvedTheme, setTheme } = useTheme();
    const {
        authMode,
        clientPasswordHash,
        configuredBaseUrl,
        image2User,
        isAuthReady,
        isPasswordRequiredByBackend,
        keysUrl,
        setClientPasswordHash
    } = useHomeAuth();
    const scopedHistoryUserId = authMode === 'sub2api' ? (image2User?.id ?? null) : undefined;
    const activeImageUserId = authMode === 'sub2api' ? image2User?.id : LEGACY_IMAGE_USER_ID;
    const { history, setHistory } = useHomeHistory<HistoryMetadata>(scopedHistoryUserId);
    const [isThemeMounted, setIsThemeMounted] = React.useState(false);
    const [mode, setMode] = React.useState<'generate' | 'edit'>('generate');
    const [showApiKey, setShowApiKey] = React.useState(false);
    const [isLoading, setIsLoading] = React.useState(false);
    const isLoadingRef = React.useRef(false);
    const apiCallInFlightRef = React.useRef(false);
    const [isSendingToEdit, setIsSendingToEdit] = React.useState(false);
    const [activeRequestStartedAt, setActiveRequestStartedAt] = React.useState<number | null>(null);
    const [elapsedSeconds, setElapsedSeconds] = React.useState(0);
    const [error, setError] = React.useState<string | null>(null);
    const [showApiResponseInfo, setShowApiResponseInfo] = React.useState(false);
    const [apiResponseInfo, setApiResponseInfo] = React.useState<ApiResponseInfo | null>(null);
    const [latestImageBatch, setLatestImageBatch] = React.useState<ImageBatchItem[] | null>(null);
    const [latestBatchPrompt, setLatestBatchPrompt] = React.useState('');
    const [imageOutputView, setImageOutputView] = React.useState<'grid' | number>('grid');
    const blobUrlCacheRef = React.useRef<Map<string, string>>(new Map());
    const modelMenuRef = React.useRef<HTMLDivElement>(null);
    const [isPasswordDialogOpen, setIsPasswordDialogOpen] = React.useState(false);
    const [passwordDialogContext, setPasswordDialogContext] = React.useState<'initial' | 'retry'>('initial');
    const [lastApiCallArgs, setLastApiCallArgs] = React.useState<[GenerationFormData | EditingFormData] | null>(null);
    const [showPreferences, setShowPreferences] = React.useState(false);
    const [showHelpDialog, setShowHelpDialog] = React.useState(false);
    const [showMobileSettings, setShowMobileSettings] = React.useState(false);

    const allDbImages = useLiveQuery<ImageRecord[] | undefined>(
        () =>
            activeImageUserId === undefined
                ? Promise.resolve([])
                : db.images.where('userId').equals(activeImageUserId).toArray(),
        [activeImageUserId]
    );

    const [editImageFiles, setEditImageFiles] = React.useState<File[]>([]);
    const [editSourceImagePreviewUrls, setEditSourceImagePreviewUrls] = React.useState<string[]>([]);
    const [editPrompt, setEditPrompt] = React.useState('');
    const [editN, setEditN] = React.useState([1]);
    const [editSize, setEditSize] = React.useState<EditingFormData['size']>('square');
    const [editCustomWidth, setEditCustomWidth] = React.useState<number>(1024);
    const [editCustomHeight, setEditCustomHeight] = React.useState<number>(1024);
    const [editQuality, setEditQuality] = React.useState<EditingFormData['quality']>('auto');
    const [editBrushSize, setEditBrushSize] = React.useState([20]);
    const [editShowMaskEditor, setEditShowMaskEditor] = React.useState(false);
    const [editGeneratedMaskFile, setEditGeneratedMaskFile] = React.useState<File | null>(null);
    const [editIsMaskSaved, setEditIsMaskSaved] = React.useState(false);
    const [editOriginalImageSize, setEditOriginalImageSize] = React.useState<{ width: number; height: number } | null>(
        null
    );
    const [editDrawnPoints, setEditDrawnPoints] = React.useState<DrawnPoint[]>([]);
    const [editMaskPreviewUrl, setEditMaskPreviewUrl] = React.useState<string | null>(null);
    const {
        apiKeyDraft,
        fetchModelOptions,
        filteredModelOptions,
        handleApiKeyChange,
        handleModelChange,
        handleModelSelect,
        isFetchingModels,
        isModelMenuOpen,
        modelDraft,
        modelFetchError,
        saveModelChoice,
        selectedModel,
        setIsModelMenuOpen
    } = useModelPreferences({
        clientPasswordHash,
        initialModelOptions: modelOptions,
        isPasswordRequiredByBackend,
        saveSettings,
        settings
    });

    React.useEffect(() => {
        isLoadingRef.current = isLoading;
    }, [isLoading]);

    const [genPrompt, setGenPrompt] = React.useState('');
    const [genN, setGenN] = React.useState([1]);
    const [genSize, setGenSize] = React.useState<GenerationFormData['size']>('square');
    const [genCustomWidth, setGenCustomWidth] = React.useState<number>(1024);
    const [genCustomHeight, setGenCustomHeight] = React.useState<number>(1024);
    const [genQuality, setGenQuality] = React.useState<GenerationFormData['quality']>('auto');
    const [genOutputFormat, setGenOutputFormat] = React.useState<GenerationFormData['output_format']>('webp');
    const [genCompression, setGenCompression] = React.useState([85]);
    const [genBackground, setGenBackground] = React.useState<GenerationFormData['background']>('auto');
    const [genModeration, setGenModeration] = React.useState<GenerationFormData['moderation']>('auto');
    const [genStreamEnabled, setGenStreamEnabled] = React.useState(false);
    const genCustomSizeInvalid =
        genSize === 'custom' && !validateGptImage2Size(genCustomWidth, genCustomHeight).valid;
    const editCustomSizeInvalid =
        editSize === 'custom' && !validateGptImage2Size(editCustomWidth, editCustomHeight).valid;
    const mobileParameterSummary =
        mode === 'edit'
            ? `${formatOptionLabel(editSize, t)} / ${formatOptionLabel(editQuality, t)} / ${editN[0]}`
            : `${formatOptionLabel(genSize, t)} / ${formatOptionLabel(genQuality, t)} / ${genN[0]}`;
    const resetCurrentParameters = () => {
        if (mode === 'edit') {
            setEditN([1]);
            setEditSize('square');
            setEditCustomWidth(1024);
            setEditCustomHeight(1024);
            setEditQuality('auto');
            setEditBrushSize([20]);
            return;
        }

        setGenN([1]);
        setGenSize('square');
        setGenCustomWidth(1024);
        setGenCustomHeight(1024);
        setGenQuality('auto');
        setGenOutputFormat('png');
        setGenCompression([100]);
        setGenBackground('auto');
        setGenModeration('auto');
        setGenStreamEnabled(false);
    };

    React.useEffect(() => {
        setIsThemeMounted(true);
    }, []);

    React.useEffect(() => {
        const modeParam = new URLSearchParams(window.location.search).get('mode');
        if (modeParam === 'edit' || modeParam === 'generate') {
            setMode(modeParam);
            window.history.replaceState(null, '', window.location.pathname);
        }
    }, []);

    const currentTheme = isThemeMounted ? (resolvedTheme ?? 'dark') : 'dark';

    const handleThemeToggle = () => {
        setTheme(currentTheme === 'dark' ? 'light' : 'dark');
    };

    React.useEffect(() => {
        const handlePointerDown = (event: PointerEvent) => {
            if (!modelMenuRef.current?.contains(event.target as Node)) {
                setIsModelMenuOpen(false);
            }
        };

        document.addEventListener('pointerdown', handlePointerDown);
        return () => document.removeEventListener('pointerdown', handlePointerDown);
    }, []);

    React.useEffect(() => {
        if (!isLoading || activeRequestStartedAt === null) {
            return;
        }

        const updateElapsedSeconds = () => {
            setElapsedSeconds(Math.floor((Date.now() - activeRequestStartedAt) / 1000));
        };

        updateElapsedSeconds();
        const intervalId = window.setInterval(updateElapsedSeconds, 1000);

        return () => window.clearInterval(intervalId);
    }, [activeRequestStartedAt, isLoading]);

    React.useEffect(() => {
        if (allDbImages === undefined) {
            return;
        }

        const previousCache = blobUrlCacheRef.current;
        const nextCache = new Map<string, string>();

        allDbImages.forEach((record) => {
            if (!record.blob) return;

            const cachedUrl = previousCache.get(record.filename);
            if (cachedUrl) {
                nextCache.set(record.filename, cachedUrl);
                return;
            }

            const url = URL.createObjectURL(record.blob);
            nextCache.set(record.filename, url);
        });

        previousCache.forEach((url, filename) => {
            if (!nextCache.has(filename)) {
                URL.revokeObjectURL(url);
            }
        });

        blobUrlCacheRef.current = nextCache;
    }, [allDbImages]);

    React.useEffect(() => {
        return () => {
            blobUrlCacheRef.current.forEach((url) => URL.revokeObjectURL(url));
            blobUrlCacheRef.current.clear();
        };
    }, []);

    React.useEffect(() => {
        return () => {
            editSourceImagePreviewUrls.forEach((url) => URL.revokeObjectURL(url));
        };
    }, [editSourceImagePreviewUrls]);

    React.useEffect(() => {
        const handlePaste = (event: ClipboardEvent) => {
            if (mode !== 'edit' || !event.clipboardData) {
                return;
            }

            if (editImageFiles.length >= MAX_EDIT_IMAGES) {
                alert(t('form.invalidMaxFiles', { maxImages: MAX_EDIT_IMAGES }));
                return;
            }

            const items = event.clipboardData.items;
            for (let i = 0; i < items.length; i++) {
                if (items[i].type.indexOf('image') !== -1) {
                    const file = items[i].getAsFile();
                    if (file) {
                        event.preventDefault();

                        const previewUrl = URL.createObjectURL(file);

                        setEditImageFiles((prevFiles) => [...prevFiles, file]);
                        setEditSourceImagePreviewUrls((prevUrls) => [...prevUrls, previewUrl]);

                        break;
                    }
                }
            }
        };

        window.addEventListener('paste', handlePaste);

        return () => {
            window.removeEventListener('paste', handlePaste);
        };
    }, [mode, editImageFiles.length, t]);

    async function sha256Client(text: string): Promise<string> {
        const encoder = new TextEncoder();
        const data = encoder.encode(text);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
        return hashHex;
    }

    const handleSavePassword = async (password: string) => {
        if (!password.trim()) {
            setError(t('page.passwordEmpty'));
            return;
        }
        try {
            const hash = await sha256Client(password);
            localStorage.setItem('clientPasswordHash', hash);
            setClientPasswordHash(hash);
            setError(null);
            setIsPasswordDialogOpen(false);
            if (passwordDialogContext === 'retry' && lastApiCallArgs) {
                await handleApiCall(...lastApiCallArgs);
            }
        } catch (e) {
            console.error('Error hashing password:', e);
            setError(t('page.passwordHashError'));
        }
    };

    const handleOpenPasswordDialog = () => {
        setPasswordDialogContext('initial');
        setIsPasswordDialogOpen(true);
    };

    const getMimeTypeFromFormat = (format: string): string => {
        if (format === 'jpeg') return 'image/jpeg';
        if (format === 'webp') return 'image/webp';

        return 'image/png';
    };

    const cacheApiImageForDisplay = React.useCallback(async (img: ApiImageResponseItem): Promise<ImageBatchItem | null> => {
        if (img.b64_json) {
            const actualMimeType = getMimeTypeFromFormat(img.output_format);
            const immediatePath = `data:${actualMimeType};base64,${img.b64_json}`;

            try {
                void (async () => {
                    const byteCharacters = atob(img.b64_json!);
                    const byteNumbers = new Array(byteCharacters.length);
                    for (let i = 0; i < byteCharacters.length; i++) {
                        byteNumbers[i] = byteCharacters.charCodeAt(i);
                    }
                    const byteArray = new Uint8Array(byteNumbers);
                    const blob = new Blob([byteArray], { type: actualMimeType });
                    await db.images.put({ userId: activeImageUserId ?? LEGACY_IMAGE_USER_ID, filename: img.filename, blob });
                })();
            } catch (dbError) {
                console.error(`Error caching blob ${img.filename} to IndexedDB:`, dbError);
                if (effectiveStorageModeClient === 'indexeddb') {
                    setError(t('page.saveIndexedDbError', { filename: img.filename }));
                    return null;
                }
            }

            return {
                filename: img.filename,
                path: immediatePath
            };
        } else {
            console.warn(`Image ${img.filename} missing b64_json; falling back to server path when available.`);
        }

        if (img.path) {
            return {
                filename: img.filename,
                path: img.path
            };
        }

        return null;
    }, [activeImageUserId, t]);

    const getOutputFormatFromFilename = React.useCallback((filename: string): GenerationFormData['output_format'] => {
        const extension = filename.split('.').pop()?.toLowerCase();
        if (extension === 'jpg' || extension === 'jpeg') return 'jpeg';
        if (extension === 'webp') return 'webp';
        return 'png';
    }, []);

    React.useEffect(() => {
        if (effectiveStorageModeClient === 'indexeddb' || isLoadingRef.current || latestImageBatch) {
            return;
        }

        if (authMode === 'sub2api' && !isAuthReady) {
            return;
        }

        if (authMode !== 'sub2api' && isPasswordRequiredByBackend && !clientPasswordHash) {
            return;
        }

        const latestHistoryEntry = [...history].sort((left, right) => right.timestamp - left.timestamp)[0];
        if (!latestHistoryEntry) {
            return;
        }

        const toApiImages = (item: HistoryMetadata): ApiImageResponseItem[] =>
            item.images.map((image) => ({
                filename: image.filename,
                output_format: item.output_format || getOutputFormatFromFilename(image.filename),
                path: `/api/image/${image.filename}`
            }));

        const restoreCompletedEntry = async (item: HistoryMetadata) => {
            const processedImages = (await Promise.all(toApiImages(item).map(cacheApiImageForDisplay))).filter(
                Boolean
            ) as ImageBatchItem[];

            if (processedImages.length === 0) {
                return;
            }

            setMode(item.mode);
            setLatestImageBatch(processedImages);
            setLatestBatchPrompt(item.prompt);
            setImageOutputView(processedImages.length > 1 ? 'grid' : 0);
            setApiResponseInfo({
                status: 'success',
                endpoint: '/api/images',
                method: 'POST',
                startedAt: item.timestamp,
                durationMs: item.durationMs,
                mode: item.mode,
                model: item.model || selectedModel,
                size: item.size || '',
                n: item.images.length,
                stream: !!item.streaming,
                partialImages: item.partialImages,
                storageMode: effectiveStorageModeClient,
                imageCount: item.images.length,
                filenames: item.images.map((image) => image.filename),
                costUsd: item.costDetails?.estimated_cost_usd,
                streamingStats: item.streaming
                    ? {
                          partialImages: item.partialImages ?? 0,
                          completedImages: item.images.length,
                          doneReceived: true
                      }
                    : undefined
            });
        };

        if (latestHistoryEntry.images.length > 0 && latestHistoryEntry.status !== 'pending') {
            restoreCompletedEntry(latestHistoryEntry);
            return;
        }

        if (latestHistoryEntry.status !== 'pending') {
            return;
        }

        const controller = new AbortController();
        setMode(latestHistoryEntry.mode);
        setIsLoading(true);
        setActiveRequestStartedAt(latestHistoryEntry.timestamp);
        setElapsedSeconds(Math.max(0, Math.floor((Date.now() - latestHistoryEntry.timestamp) / 1000)));
        setLatestBatchPrompt(latestHistoryEntry.prompt);
        setImageOutputView('grid');
        setApiResponseInfo({
            status: 'loading',
            endpoint: '/api/images',
            method: 'POST',
            startedAt: latestHistoryEntry.timestamp,
            mode: latestHistoryEntry.mode,
            model: latestHistoryEntry.model || selectedModel,
            size: latestHistoryEntry.size || '',
            n: latestHistoryEntry.images.length || 1,
            stream: !!latestHistoryEntry.streaming,
            partialImages: latestHistoryEntry.partialImages,
            storageMode: effectiveStorageModeClient,
            streamingStats: latestHistoryEntry.streaming
                ? {
                      partialImages: 0,
                      completedImages: 0,
                      doneReceived: false
                  }
                : undefined
        });

        const loadServerCompletion = async () => {
            try {
                const params = new URLSearchParams();
                if (authMode !== 'sub2api' && isPasswordRequiredByBackend && clientPasswordHash) {
                    params.set('passwordHash', clientPasswordHash);
                }
                params.set('since', latestHistoryEntry.timestamp.toString());
                params.set('page_size', '1000');

                const response = await fetch(`/api/image-history${params.size ? `?${params.toString()}` : ''}`, {
                    cache: 'no-store',
                    signal: controller.signal
                });

                if (!response.ok) {
                    throw new Error(`Failed to load server image history: ${response.status}`);
                }

                const result = (await response.json()) as {
                    data?: { items?: HistoryMetadata[] };
                    history?: HistoryMetadata[];
                };
                const serverHistory = Array.isArray(result.data?.items)
                    ? result.data.items
                    : Array.isArray(result.history)
                      ? result.history
                      : [];
                const serverItem = serverHistory.find((item) => item.timestamp === latestHistoryEntry.timestamp);

                if (!serverItem || serverItem.images.length === 0) {
                    return;
                }

                const completedEntry: HistoryMetadata = {
                    ...latestHistoryEntry,
                    images: serverItem.images,
                    status: 'completed',
                    durationMs: latestHistoryEntry.durationMs || serverItem.durationMs,
                    output_format: latestHistoryEntry.output_format || serverItem.output_format,
                    storageModeUsed: serverItem.storageModeUsed || latestHistoryEntry.storageModeUsed || effectiveStorageModeClient
                };

                setHistory((prevHistory) =>
                    prevHistory.map((item) => (item.timestamp === completedEntry.timestamp ? completedEntry : item))
                );
                await restoreCompletedEntry(completedEntry);
                setIsLoading(false);
                setActiveRequestStartedAt(null);
            } catch (loadError) {
                if (loadError instanceof DOMException && loadError.name === 'AbortError') {
                    return;
                }

                console.error('Failed to restore generated image on home page:', loadError);
            }
        };

        loadServerCompletion();
        const intervalId = window.setInterval(loadServerCompletion, 5000);

        return () => {
            window.clearInterval(intervalId);
            controller.abort();
        };
    }, [
        authMode,
        cacheApiImageForDisplay,
        clientPasswordHash,
        getOutputFormatFromFilename,
        history,
        isAuthReady,
        isPasswordRequiredByBackend,
        latestImageBatch,
        selectedModel,
        setHistory
    ]);

    const handleApiCall = async (formData: GenerationFormData | EditingFormData) => {
        if (apiCallInFlightRef.current) {
            console.warn('Ignored duplicate /api/images submit while a request is already in progress.');
            return;
        }

        apiCallInFlightRef.current = true;
        const startTime = Date.now();
        let durationMs = 0;
        let pendingHistoryEntry: HistoryMetadata | null = null;

        setIsLoading(true);
        isLoadingRef.current = true;
        setActiveRequestStartedAt(startTime);
        setElapsedSeconds(0);
        setError(null);
        setLatestImageBatch(null);
        setLatestBatchPrompt('');
        setImageOutputView('grid');

        const apiFormData = new FormData();
        const apiKey = apiKeyDraft.trim() || settings.apiKey.trim();

        if (authMode === 'sub2api' && (!isAuthReady || !image2User)) {
            setError(t('page.unauthorized'));
            setIsLoading(false);
            isLoadingRef.current = false;
            apiCallInFlightRef.current = false;
            return;
        }

        if (apiKey) {
            apiFormData.append('apiKey', apiKey);
        }
        apiFormData.append('responseLanguage', language);

        if (isPasswordRequiredByBackend && clientPasswordHash) {
            apiFormData.append('passwordHash', clientPasswordHash);
        } else if (isPasswordRequiredByBackend && !clientPasswordHash) {
            setError(t('page.passwordMissing'));
            setPasswordDialogContext('initial');
            setIsPasswordDialogOpen(true);
            setIsLoading(false);
            isLoadingRef.current = false;
            apiCallInFlightRef.current = false;
            return;
        }
        apiFormData.append('mode', mode);

        let requestSize = '';
        let requestOutputCompression: number | undefined;
        let requestSourceImageCount = 0;
        let requestHasMask = false;
        let requestStreaming = false;
        let requestPartialImages: number | undefined;
        let requestModel: GptImageModel = selectedModel;
        let requestImageCount = 1;
        let requestPrompt = '';
        let requestQuality: GenerationFormData['quality'] = 'auto';
        let requestBackground: GenerationFormData['background'] = 'auto';
        let requestModeration: GenerationFormData['moderation'] = 'auto';
        let requestOutputFormat: GenerationFormData['output_format'] = 'png';

        if (mode === 'generate') {
            const genData = formData as GenerationFormData;
            requestModel = genData.model;
            requestImageCount = genData.n;
            requestPrompt = genData.prompt;
            requestQuality = genData.quality;
            requestBackground = genData.background;
            requestModeration = genData.moderation;
            requestOutputFormat = genData.output_format;
            apiFormData.append('model', requestModel);
            apiFormData.append('prompt', genData.prompt);
            apiFormData.append('n', genData.n.toString());
            const genSizeToSend =
                genData.size === 'custom'
                    ? `${genData.customWidth}x${genData.customHeight}`
                    : (getPresetDimensions(genData.size, requestModel) ?? genData.size);
            requestSize = genSizeToSend;
            apiFormData.append('size', genSizeToSend);
            apiFormData.append('quality', genData.quality);
            apiFormData.append('output_format', genData.output_format);
            if (
                (genData.output_format === 'jpeg' || genData.output_format === 'webp') &&
                genData.output_compression !== undefined
            ) {
                requestOutputCompression = genData.output_compression;
                apiFormData.append('output_compression', genData.output_compression.toString());
            }
            apiFormData.append('background', genData.background);
            apiFormData.append('moderation', genData.moderation);
            if (genData.stream && genData.n === 1) {
                requestStreaming = true;
                requestPartialImages = genData.partialImages;
                apiFormData.append('stream', 'true');
                apiFormData.append('partial_images', genData.partialImages.toString());
            }
        } else {
            const editData = formData as EditingFormData;
            
            // ✅【修复】图片编辑必须校验是否上传了图片
            if (!editData.imageFiles || editData.imageFiles.length === 0) {
                setError(t('page.noImageSelectedForEditing')); // 没有图片就报错并退出
                setIsLoading(false);
                isLoadingRef.current = false;
                apiCallInFlightRef.current = false;
                return;
            }
            requestModel = editData.model;
            requestImageCount = editData.n;
            requestPrompt = editData.prompt;
            requestQuality = editData.quality;
            requestOutputFormat = 'png';
            apiFormData.append('model', requestModel);
            apiFormData.append('prompt', editData.prompt);
            apiFormData.append('n', editData.n.toString());
            const editSizeToSend =
                editData.size === 'custom'
                    ? `${editData.customWidth}x${editData.customHeight}`
                    : (getPresetDimensions(editData.size, requestModel) ?? editData.size);
            requestSize = editSizeToSend;
            requestSourceImageCount = editData.imageFiles.length;
            requestHasMask = !!editData.maskFile;
            apiFormData.append('size', editSizeToSend);
            apiFormData.append('quality', editData.quality);

            editData.imageFiles.forEach((file, index) => {
                apiFormData.append(`image_${index}`, file, file.name);
            });
            if (editData.maskFile) {
                apiFormData.append('mask', editData.maskFile, editData.maskFile.name);
            }
        }

        apiFormData.append('history_timestamp', startTime.toString());

        setApiResponseInfo({
            status: 'loading',
            endpoint: '/api/images',
            method: 'POST',
            startedAt: startTime,
            mode,
            model: requestModel,
            size: requestSize,
            n: requestImageCount,
            stream: requestStreaming,
            partialImages: requestPartialImages,
            storageMode: effectiveStorageModeClient,
            streamingStats: requestStreaming
                ? {
                      partialImages: 0,
                      completedImages: 0,
                      doneReceived: false
                  }
                : undefined
        });

        pendingHistoryEntry = {
            timestamp: startTime,
            images: [],
            status: 'pending',
            storageModeUsed: effectiveStorageModeClient,
            durationMs: 0,
            quality: requestQuality,
            background: requestBackground,
            moderation: requestModeration,
            output_format: requestOutputFormat,
            prompt: requestPrompt,
            mode,
            costDetails: null,
            model: requestModel,
            size: requestSize,
            output_compression: requestOutputCompression,
            streaming: requestStreaming,
            partialImages: requestPartialImages,
            sourceImageCount: requestSourceImageCount,
            hasMask: requestHasMask
        };
        setHistory((prevHistory) => [
            pendingHistoryEntry as HistoryMetadata,
            ...prevHistory.filter((historyItem) => historyItem.timestamp !== startTime)
        ]);

        let streamedImagesForRecovery: ApiImageResponseItem[] = [];
        let finalizeStreamingImagesForRecovery:
            | ((images: ApiImageResponseItem[], usage?: ApiUsageForCost) => Promise<void>)
            | null = null;

        try {
            const response = await fetch('/api/images', {
                method: 'POST',
                body: apiFormData
            });

            // Check if response is SSE (streaming)
            const contentType = response.headers.get('content-type');
            const responseKind = contentType?.includes('text/event-stream') ? 'event-stream' : 'json';
            setApiResponseInfo((current) =>
                current
                    ? {
                          ...current,
                          httpStatus: response.status,
                          contentType,
                          responseKind
                      }
                    : current
            );
            if (contentType?.includes('text/event-stream')) {
                if (!response.ok) {
                    throw new Error(t('page.apiRequestFailed', { status: response.status }));
                }
                if (!response.body) {
                    throw new Error(t('page.unexpectedError'));
                }

                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';
                let hasSavedStreamingHistory = false;
                let shouldStopReading = false;
                const streamedImages: Array<ApiImageResponseItem | undefined> = [];
                let streamingPartialImages = 0;
                let streamingCompletedImages = 0;
                let streamingDoneReceived = false;

                const fallbackOutputFormat = mode === 'generate' ? (formData as GenerationFormData).output_format : 'png';
                const historyPrompt = mode === 'generate' ? (formData as GenerationFormData).prompt : (formData as EditingFormData).prompt;

                const getOrderedStreamedImages = () =>
                    streamedImages.filter((image): image is ApiImageResponseItem => Boolean(image));
                streamedImagesForRecovery = getOrderedStreamedImages();

                const updateStreamingStats = () => {
                    setApiResponseInfo((current) =>
                        current
                            ? {
                                  ...current,
                                  imageCount: getOrderedStreamedImages().length,
                                  filenames: getOrderedStreamedImages().map((image) => image.filename),
                                  streamingStats: {
                                      partialImages: streamingPartialImages,
                                      completedImages: streamingCompletedImages,
                                      doneReceived: streamingDoneReceived
                                  }
                              }
                            : current
                    );
                };

                const displayStreamingImages = async () => {
                    const processedImages = (await Promise.all(getOrderedStreamedImages().map(cacheApiImageForDisplay))).filter(
                        Boolean
                    ) as ImageBatchItem[];

                    if (processedImages.length > 0) {
                        setLatestImageBatch(processedImages);
                        setLatestBatchPrompt(historyPrompt);
                        setImageOutputView(0);
                    }
                };

                const normalizeStreamingImage = (image: Partial<ApiImageResponseItem>): ApiImageResponseItem | null => {
                    if (!image.filename) {
                        return null;
                    }

                    return {
                        filename: image.filename,
                        output_format: image.output_format || fallbackOutputFormat,
                        ...(image.b64_json ? { b64_json: image.b64_json } : {}),
                        ...(image.path ? { path: image.path } : {})
                    };
                };

                const finalizeStreamingImages = async (images: ApiImageResponseItem[], usage?: ApiUsageForCost) => {
                    finalizeStreamingImagesForRecovery = finalizeStreamingImages;
                    streamedImagesForRecovery = getOrderedStreamedImages();

                    if (hasSavedStreamingHistory) {
                        return;
                    }

                    const finalImages = images.length > 0 ? images : getOrderedStreamedImages();
                    if (finalImages.length === 0) {
                        throw new Error(t('page.apiNoImages'));
                    }

                    durationMs = Date.now() - startTime;

                    let historyQuality: GenerationFormData['quality'] = 'auto';
                    let historyBackground: GenerationFormData['background'] = 'auto';
                    let historyModeration: GenerationFormData['moderation'] = 'auto';
                    let historyOutputFormat: GenerationFormData['output_format'] = 'png';

                    if (mode === 'generate') {
                        const genData = formData as GenerationFormData;
                        historyQuality = genData.quality;
                        historyBackground = genData.background;
                        historyModeration = genData.moderation;
                        historyOutputFormat = genData.output_format;
                    } else {
                        const editData = formData as EditingFormData;
                        historyQuality = editData.quality;
                    }

                    const costDetails = calculateApiCost(usage, requestModel);

                    setApiResponseInfo((current) =>
                        current
                            ? {
                                  ...current,
                                  status: 'success',
                                  durationMs,
                                  imageCount: finalImages.length,
                                  filenames: finalImages.map((image) => image.filename),
                                  costUsd: costDetails?.estimated_cost_usd,
                                  streamingStats: {
                                      partialImages: streamingPartialImages,
                                      completedImages: streamingCompletedImages,
                                      doneReceived: streamingDoneReceived
                                  }
                              }
                            : current
                    );

                    const batchTimestamp = startTime;
                    const newHistoryEntry: HistoryMetadata = {
                        timestamp: batchTimestamp,
                        images: finalImages.map((img) => ({
                            filename: img.filename
                        })),
                        status: 'completed',
                        storageModeUsed: effectiveStorageModeClient,
                        durationMs: durationMs,
                        quality: historyQuality,
                        background: historyBackground,
                        moderation: historyModeration,
                        output_format: historyOutputFormat,
                        prompt: historyPrompt,
                        mode: mode,
                        costDetails: costDetails,
                        model: requestModel,
                        size: requestSize,
                        output_compression: requestOutputCompression,
                        streaming: requestStreaming,
                        partialImages: requestPartialImages,
                        sourceImageCount: requestSourceImageCount,
                        hasMask: requestHasMask
                    };

                    const processedImages = (await Promise.all(finalImages.map(cacheApiImageForDisplay))).filter(
                        Boolean
                    ) as ImageBatchItem[];

                    if (processedImages.length === 0) {
                        throw new Error(t('page.apiNoImages'));
                    }

                    setLatestImageBatch(processedImages);
                    setLatestBatchPrompt(historyPrompt);
                    setImageOutputView(0);
                    setHistory((prevHistory) => [
                        newHistoryEntry,
                        ...prevHistory.filter((historyItem) => historyItem.timestamp !== batchTimestamp)
                    ]);
                    hasSavedStreamingHistory = true;
                };

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });

                    // Process complete SSE events
                    const lines = buffer.split('\n\n');
                    buffer = lines.pop() || ''; // Keep incomplete event in buffer

                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            const jsonStr = line.slice(6);
                            try {
                                const event = JSON.parse(jsonStr);

                                if (event.type === 'partial_image') {
                                    streamingPartialImages += 1;
                                    if (event.b64_json) {
                                        const partialImage = normalizeStreamingImage({
                                            filename: `partial-${startTime}-${typeof event.index === 'number' ? event.index : 0}.webp`,
                                            b64_json: event.b64_json,
                                            output_format: fallbackOutputFormat
                                        });

                                        if (partialImage) {
                                            const imageIndex =
                                                typeof event.index === 'number' ? event.index : streamedImages.length;
                                            streamedImages[imageIndex] = partialImage;
                                            streamedImagesForRecovery = getOrderedStreamedImages();
                                            await displayStreamingImages();
                                        }
                                    }
                                    updateStreamingStats();
                                    continue;
                                } else if (event.type === 'error') {
                                    throw new Error(event.error || t('page.streamingError'));
                                } else if (event.type === 'completed') {
                                    const completedImage = normalizeStreamingImage({
                                        filename: event.filename,
                                        b64_json: event.b64_json,
                                        output_format: event.output_format,
                                        path: event.path
                                    });

                                    if (completedImage) {
                                        const imageIndex =
                                            typeof event.index === 'number' ? event.index : streamedImages.length;
                                        streamedImages[imageIndex] = completedImage;
                                        streamedImagesForRecovery = getOrderedStreamedImages();
                                        streamingCompletedImages += 1;
                                        updateStreamingStats();
                                        await displayStreamingImages();

                                        if (requestImageCount === 1) {
                                            continue;
                                        }
                                    }
                                } else if (event.type === 'done') {
                                    streamingDoneReceived = true;
                                    updateStreamingStats();
                                    const eventImages = Array.isArray(event.images)
                                        ? (event.images
                                              .map((image: Partial<ApiImageResponseItem>) =>
                                                  normalizeStreamingImage(image)
                                              )
                                              .filter(Boolean) as ApiImageResponseItem[])
                                        : [];

                                    await finalizeStreamingImages(eventImages, event.usage);
                                    shouldStopReading = true;
                                    break;
                                }
                            } catch (parseError) {
                                console.error('Error parsing SSE event:', parseError);
                                throw parseError;
                            }
                        }
                    }

                    if (shouldStopReading) {
                        try {
                            await reader.cancel();
                        } catch (cancelError) {
                            console.warn('Failed to cancel SSE reader after streaming completion:', cancelError);
                        }
                        break;
                    }
                }

                if (!hasSavedStreamingHistory && getOrderedStreamedImages().length > 0) {
                    await finalizeStreamingImages(getOrderedStreamedImages());
                }

                return; // Exit early for streaming
            }

            // Non-streaming response handling (original code)
            const result: ImageApiResult = await response.json();

            if (!response.ok) {
                if (response.status === 401 && authMode === 'sub2api' && result.loginUrl) {
                    window.location.assign(result.loginUrl);
                    return;
                }

                if (response.status === 401 && isPasswordRequiredByBackend) {
                    setError(t('page.unauthorized'));
                    setApiResponseInfo((current) =>
                        current
                            ? {
                                  ...current,
                                  status: 'error',
                                  durationMs: Date.now() - startTime,
                                  error: t('page.unauthorized')
                              }
                            : current
                    );
                    setPasswordDialogContext('retry');
                    setLastApiCallArgs([formData]);
                    setIsPasswordDialogOpen(true);

                    return;
                }
                throw new Error(result.error || t('page.apiRequestFailed', { status: response.status }));
            }

            if (result.images && result.images.length > 0) {
                durationMs = Date.now() - startTime;

                let historyQuality: GenerationFormData['quality'] = 'auto';
                let historyBackground: GenerationFormData['background'] = 'auto';
                let historyModeration: GenerationFormData['moderation'] = 'auto';
                let historyOutputFormat: GenerationFormData['output_format'] = 'png';
                let historyPrompt: string = '';

                if (mode === 'generate') {
                    const genData = formData as GenerationFormData;
                    historyQuality = genData.quality;
                    historyBackground = genData.background;
                    historyModeration = genData.moderation;
                    historyOutputFormat = genData.output_format;
                    historyPrompt = genData.prompt;
                } else {
                    const editData = formData as EditingFormData;
                    historyQuality = editData.quality;
                    historyBackground = 'auto';
                    historyModeration = 'auto';
                    historyOutputFormat = 'png';
                    historyPrompt = editData.prompt;
                }

                const costDetails = calculateApiCost(result.usage, requestModel);
                setApiResponseInfo((current) =>
                    current
                        ? {
                              ...current,
                              status: 'success',
                              durationMs,
                              imageCount: result.images?.length ?? 0,
                              filenames: result.images?.map((image) => image.filename) ?? [],
                              costUsd: costDetails?.estimated_cost_usd
                          }
                        : current
                );

                const batchTimestamp = startTime;
                const newHistoryEntry: HistoryMetadata = {
                    timestamp: batchTimestamp,
                    images: result.images.map((img) => ({
                        filename: img.filename
                    })),
                    status: 'completed',
                    storageModeUsed: effectiveStorageModeClient,
                    durationMs: durationMs,
                    quality: historyQuality,
                    background: historyBackground,
                    moderation: historyModeration,
                    output_format: historyOutputFormat,
                    prompt: historyPrompt,
                    mode: mode,
                    costDetails: costDetails,
                    model: requestModel,
                    size: requestSize,
                    output_compression: requestOutputCompression,
                    streaming: requestStreaming,
                    partialImages: requestPartialImages,
                    sourceImageCount: requestSourceImageCount,
                    hasMask: requestHasMask
                };

                const newImageBatchPromises = result.images.map((img: ApiImageResponseItem) =>
                    cacheApiImageForDisplay(img)
                );

                const processedImages = (await Promise.all(newImageBatchPromises)).filter(Boolean) as ImageBatchItem[];

                setLatestImageBatch(processedImages);
                setLatestBatchPrompt(historyPrompt);
                setImageOutputView(processedImages.length > 0 ? 0 : 'grid');

                setHistory((prevHistory) => [
                    newHistoryEntry,
                    ...prevHistory.filter((historyItem) => historyItem.timestamp !== batchTimestamp)
                ]);
            } else {
                setLatestImageBatch(null);
                setLatestBatchPrompt('');
                throw new Error(t('page.apiNoImages'));
            }
        } catch (err: unknown) {
            durationMs = Date.now() - startTime;
            console.error(`API Call Error after ${durationMs}ms:`, err);

            const finalizeStreamingRecovery = finalizeStreamingImagesForRecovery as
                | ((images: ApiImageResponseItem[], usage?: ApiUsageForCost) => Promise<void>)
                | null;
            if (requestStreaming && streamedImagesForRecovery.length > 0 && finalizeStreamingRecovery) {
                try {
                    await finalizeStreamingRecovery(streamedImagesForRecovery);
                    setError(null);
                    return;
                } catch (recoveryError) {
                    console.error('Failed to recover streaming images after stream interruption:', recoveryError);
                }
            }

            const errorMessage = err instanceof Error ? err.message : t('page.unexpectedError');
            setError(errorMessage);
            setApiResponseInfo((current) =>
                current
                    ? {
                          ...current,
                          status: 'error',
                          durationMs,
                          error: errorMessage
                      }
                    : current
            );
            if (pendingHistoryEntry) {
                setHistory((prevHistory) =>
                    prevHistory.map((historyItem) =>
                        historyItem.timestamp === pendingHistoryEntry?.timestamp
                            ? {
                                  ...historyItem,
                                  status: 'error',
                                  errorMessage,
                                  durationMs
                              }
                            : historyItem
                    )
                );
            }
            setLatestImageBatch(null);
            setLatestBatchPrompt('');
        } finally {
            if (durationMs === 0) durationMs = Date.now() - startTime;
            setIsLoading(false);
            isLoadingRef.current = false;
            apiCallInFlightRef.current = false;
            setActiveRequestStartedAt(null);
        }
    };

    const handleSendToEdit = async (filename: string) => {
        if (isSendingToEdit) return;
        setIsSendingToEdit(true);
        setError(null);

        const alreadyExists = editImageFiles.some((file) => file.name === filename);
        if (mode === 'edit' && alreadyExists) {
            setIsSendingToEdit(false);
            return;
        }

        if (mode === 'edit' && editImageFiles.length >= MAX_EDIT_IMAGES) {
            setError(t('page.editFormMaxImages', { maxImages: MAX_EDIT_IMAGES }));
            setIsSendingToEdit(false);
            return;
        }

        try {
            let blob: Blob | undefined;
            let mimeType: string = 'image/png';

            const localRecord = allDbImages?.find((img) => img.filename === filename);
            if (localRecord?.blob) {
                blob = localRecord.blob;
                mimeType = blob.type || mimeType;
            } else if (effectiveStorageModeClient === 'indexeddb') {
                throw new Error(t('page.imageNotFoundLocal', { filename }));
            } else {
                const response = await fetch(`/api/image/${filename}`);
                if (!response.ok) {
                    throw new Error(t('page.fetchImageFailed', { statusText: response.statusText }));
                }
                blob = await response.blob();
                mimeType = response.headers.get('Content-Type') || mimeType;
            }

            if (!blob) {
                throw new Error(t('page.retrieveImageFailed', { filename }));
            }

            const newFile = new File([blob], filename, { type: mimeType });
            const newPreviewUrl = URL.createObjectURL(blob);

            editSourceImagePreviewUrls.forEach((url) => URL.revokeObjectURL(url));

            setEditImageFiles([newFile]);
            setEditSourceImagePreviewUrls([newPreviewUrl]);

            if (mode === 'generate') {
                setMode('edit');
            }
        } catch (err: unknown) {
            console.error('Error sending image to edit:', err);
            const errorMessage = err instanceof Error ? err.message : t('page.sendToEditError');
            setError(errorMessage);
        } finally {
            setIsSendingToEdit(false);
        }
    };

    const apiInfoStatusLabel =
        apiResponseInfo?.status === 'loading'
            ? t('apiInfo.statusLoading')
            : apiResponseInfo?.status === 'success'
              ? t('apiInfo.statusSuccess')
              : apiResponseInfo?.status === 'error'
                ? t('apiInfo.statusError')
                : '-';
    const apiInfoStatusClass =
        apiResponseInfo?.status === 'success'
            ? 'border-emerald-300/40 bg-emerald-400/10 text-emerald-300'
            : apiResponseInfo?.status === 'error'
              ? 'border-red-400/40 bg-red-500/10 text-red-300'
              : 'border-blue-300/40 bg-blue-400/10 text-blue-300';
    const apiInfoDuration =
        apiResponseInfo?.status === 'loading'
            ? formatApiDuration(Date.now() - apiResponseInfo.startedAt)
            : formatApiDuration(apiResponseInfo?.durationMs);
    const apiInfoRows: Array<[string, string]> = apiResponseInfo
        ? [
              [t('apiInfo.status'), apiInfoStatusLabel],
              [
                  t('apiInfo.httpStatus'),
                  apiResponseInfo.httpStatus ? `${apiResponseInfo.httpStatus}` : '-'
              ],
              [t('apiInfo.duration'), apiInfoDuration],
              [t('apiInfo.responseType'), apiResponseInfo.responseKind || formatContentType(apiResponseInfo.contentType)],
              [t('apiInfo.endpoint'), `${apiResponseInfo.method} ${apiResponseInfo.endpoint}`],
              [t('common.model'), apiResponseInfo.model],
              [t('common.size'), apiResponseInfo.size || '-'],
              [t('history.imageCount'), `${apiResponseInfo.n}`],
              [t('apiInfo.streaming'), apiResponseInfo.stream ? t('common.yes') : t('common.no')],
              [t('apiInfo.storage'), apiResponseInfo.storageMode],
              [
                  t('apiInfo.imageCount'),
                  apiResponseInfo.imageCount === undefined ? '-' : `${apiResponseInfo.imageCount}`
              ],
              [
                  t('apiInfo.cost'),
                  apiResponseInfo.costUsd === undefined ? '-' : formatUsdCny(apiResponseInfo.costUsd)
              ]
          ]
        : [];

    if (apiResponseInfo?.stream) {
        apiInfoRows.push(
            [
                t('apiInfo.partialImages'),
                `${apiResponseInfo.streamingStats?.partialImages ?? 0}${
                    apiResponseInfo.partialImages ? ` / ${apiResponseInfo.partialImages}` : ''
                }`
            ],
            [t('apiInfo.completedImages'), `${apiResponseInfo.streamingStats?.completedImages ?? 0}`]
        );
    }

    if (authMode === 'sub2api' && !isAuthReady) {
        return (
            <main className='flex h-dvh items-center justify-center overflow-hidden bg-slate-50 text-slate-900 dark:bg-[#0d1015] dark:text-white'>
                <p className='text-sm text-slate-500 dark:text-white/60'>{t('history.loading')}</p>
            </main>
        );
    }

    return (
        <main className='h-dvh overflow-hidden bg-slate-50 text-slate-900 dark:bg-[#0d1015] dark:text-white'>
            <PasswordDialog
                isOpen={isPasswordDialogOpen}
                onOpenChange={setIsPasswordDialogOpen}
                onSave={handleSavePassword}
                title={passwordDialogContext === 'retry' ? t('page.passwordRequired') : t('page.configurePassword')}
                description={
                    passwordDialogContext === 'retry'
                        ? t('page.passwordRequiredDescription')
                        : t('page.setPasswordDescription')
                }
            />

            <Dialog open={showHelpDialog} onOpenChange={setShowHelpDialog}>
                <DialogContent className='max-h-[82dvh] overflow-hidden rounded-md border border-slate-200 bg-[#fbfbfc] p-0 sm:max-w-[720px] dark:border-white/10 dark:bg-[#0f1115]'>
                    <DialogHeader className='border-b border-slate-200 px-4 py-3 dark:border-white/10'>
                        <DialogTitle className='text-[14px] font-semibold text-slate-900 dark:text-white'>
                            {t('help.title')}
                        </DialogTitle>
                    </DialogHeader>
                    <div className='max-h-[70dvh] overflow-y-auto p-3'>
                        <HelpNotes />
                    </div>
                </DialogContent>
            </Dialog>

            <div className='flex h-full min-h-0 flex-col overflow-hidden'>
                <div className='flex h-full min-h-0 flex-col overflow-hidden'>
                    <AppTopbar
                        currentTheme={currentTheme}
                        menuLabel={mode === 'edit' ? t('mode.edit') : t('nav.generate')}
                        onOpenHelp={() => setShowHelpDialog(true)}
                        onOpenHistory={() => router.push('/history')}
                        onOpenSettings={() => setShowPreferences(true)}
                        onToggleTheme={handleThemeToggle}
                    />

                    <PreferencesPanel
                        open={showPreferences}
                        onClose={() => setShowPreferences(false)}
                        onSave={() => setShowPreferences(false)}
                        apiKeyDraft={apiKeyDraft}
                        configuredBaseUrl={configuredBaseUrl}
                        isFetchingModels={isFetchingModels}
                        isModelMenuOpen={isModelMenuOpen}
                        keysUrl={keysUrl}
                        languagePreference={languagePreference}
                        modelDraft={modelDraft}
                        modelFetchError={modelFetchError}
                        modelMenuRef={modelMenuRef}
                        onApiKeyChange={handleApiKeyChange}
                        onLanguagePreferenceChange={setLanguagePreference}
                        onModelBlur={(event) => {
                            const nextFocusedElement = event.relatedTarget;
                            if (nextFocusedElement && modelMenuRef.current?.contains(nextFocusedElement)) {
                                return;
                            }

                            saveModelChoice(modelDraft);
                        }}
                        onModelChange={(value) => {
                            handleModelChange(value);
                            setIsModelMenuOpen(true);
                        }}
                        onModelSelect={(value) => {
                            handleModelSelect(value);
                            setIsModelMenuOpen(false);
                        }}
                        onToggleApiKeyVisibility={() => setShowApiKey((current) => !current)}
                        onToggleModelMenu={() => {
                            setIsModelMenuOpen((current) => !current);
                            fetchModelOptions();
                        }}
                        selectedModel={selectedModel}
                        showApiKey={showApiKey}
                        visibleModelOptions={filteredModelOptions}
                    />

                    <MobileParametersPanel
                        open={showMobileSettings}
                        onOpenChange={setShowMobileSettings}
                        mode={mode}
                        generationProps={{
                            onSubmit: handleApiCall,
                            isLoading,
                            currentMode: mode,
                            onModeChange: setMode,
                            isPasswordRequiredByBackend,
                            clientPasswordHash,
                            onOpenPasswordDialog: handleOpenPasswordDialog,
                            model: selectedModel,
                            prompt: genPrompt,
                            setPrompt: setGenPrompt,
                            n: genN,
                            setN: setGenN,
                            size: genSize,
                            setSize: setGenSize,
                            customWidth: genCustomWidth,
                            setCustomWidth: setGenCustomWidth,
                            customHeight: genCustomHeight,
                            setCustomHeight: setGenCustomHeight,
                            quality: genQuality,
                            setQuality: setGenQuality,
                            outputFormat: genOutputFormat,
                            setOutputFormat: setGenOutputFormat,
                            compression: genCompression,
                            setCompression: setGenCompression,
                            background: genBackground,
                            setBackground: setGenBackground,
                            moderation: genModeration,
                            setModeration: setGenModeration,
                            streamEnabled: genStreamEnabled,
                            setStreamEnabled: setGenStreamEnabled
                        }}
                        editingProps={{
                            onSubmit: handleApiCall,
                            isLoading: isLoading || isSendingToEdit,
                            isPasswordRequiredByBackend,
                            clientPasswordHash,
                            onOpenPasswordDialog: handleOpenPasswordDialog,
                            editModel: selectedModel,
                            imageFiles: editImageFiles,
                            sourceImagePreviewUrls: editSourceImagePreviewUrls,
                            setImageFiles: setEditImageFiles,
                            setSourceImagePreviewUrls: setEditSourceImagePreviewUrls,
                            maxImages: MAX_EDIT_IMAGES,
                            editPrompt,
                            setEditPrompt,
                            editN,
                            setEditN,
                            editSize,
                            setEditSize,
                            editCustomWidth,
                            setEditCustomWidth,
                            editCustomHeight,
                            setEditCustomHeight,
                            editQuality,
                            setEditQuality,
                            editBrushSize,
                            setEditBrushSize,
                            editShowMaskEditor,
                            setEditShowMaskEditor,
                            editGeneratedMaskFile,
                            setEditGeneratedMaskFile,
                            editIsMaskSaved,
                            setEditIsMaskSaved,
                            editOriginalImageSize,
                            setEditOriginalImageSize,
                            editDrawnPoints,
                            setEditDrawnPoints,
                            editMaskPreviewUrl,
                            setEditMaskPreviewUrl
                        }}
                    />

                    <div className='min-h-0 flex-1 overflow-hidden lg:w-full lg:flex-1 lg:overflow-hidden'>
                        <div className='flex h-full min-h-0 flex-col overflow-hidden pb-[calc(3rem+env(safe-area-inset-bottom))] lg:hidden'>
                            {error && (
                                <Alert
                                    variant='destructive'
                                    className='m-2 max-h-24 shrink-0 overflow-y-auto border-red-300 bg-red-50 text-red-700 dark:border-red-500/50 dark:bg-red-900/20 dark:text-red-300'>
                                    <AlertTitle className='text-red-700 dark:text-red-200'>{t('common.error')}</AlertTitle>
                                    <AlertDescription className='text-[12px]'>{error}</AlertDescription>
                                </Alert>
                            )}

                            <section className='min-h-0 flex-1 overflow-hidden border-b border-slate-200 dark:border-white/10'>
                                <ImageOutput
                                    imageBatch={latestImageBatch}
                                    promptText={latestBatchPrompt}
                                    viewMode={imageOutputView}
                                    onViewChange={setImageOutputView}
                                    altText={t('output.generatedAlt')}
                                    isLoading={isLoading || isSendingToEdit}
                                    elapsedSeconds={elapsedSeconds}
                                    onSendToEdit={handleSendToEdit}
                                    currentMode={mode}
                                    baseImagePreviewUrl={editSourceImagePreviewUrls[0] || null}
                                />
                            </section>

                            <section className='shrink-0 border-b border-slate-200 dark:border-white/10'>
                                <GenerationWorkspace
                                    customSizeInvalid={mode === 'edit' ? editCustomSizeInvalid : genCustomSizeInvalid}
                                    isLoading={isLoading || isSendingToEdit}
                                    mode={mode}
                                    onSwitchToGenerate={() => setMode('generate')}
                                    onGenerate={() =>
                                        mode === 'edit'
                                            ? handleApiCall({
                                                  prompt: genPrompt,
                                                  n: editN[0],
                                                  size: editSize,
                                                  customWidth: editCustomWidth,
                                                  customHeight: editCustomHeight,
                                                  quality: editQuality,
                                                  imageFiles: editImageFiles,
                                                  maskFile: editGeneratedMaskFile,
                                                  model: selectedModel
                                              })
                                            : handleApiCall({
                                                  prompt: genPrompt,
                                                  n: genN[0],
                                                  size: genSize,
                                                  customWidth: genCustomWidth,
                                                  customHeight: genCustomHeight,
                                                  quality: genQuality,
                                                  output_format: genOutputFormat,
                                                  ...(genOutputFormat === 'jpeg' || genOutputFormat === 'webp'
                                                      ? { output_compression: genCompression[0] }
                                                      : {}),
                                                  background: genBackground,
                                                  moderation: genModeration,
                                                  model: selectedModel,
                                                  stream: genStreamEnabled && genN[0] === 1,
                                                  partialImages: 2
                                              })
                                    }
                                    onSwitchToEdit={() => setMode('edit')}
                                    prompt={genPrompt}
                                    setPrompt={setGenPrompt}
                                />
                            </section>

                            <section className='shrink-0 border-b border-slate-200 bg-[#fbfbfc] px-3 py-2 dark:border-white/10 dark:bg-[#0f1115]'>
                                <div className='flex h-9 w-full items-center gap-2 rounded-md border border-slate-200 bg-white px-2 text-[12px] text-slate-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-white/80'>
                                    <button
                                        type='button'
                                        onClick={() => setShowMobileSettings(true)}
                                        className='min-w-0 flex-1 truncate text-left font-medium'>
                                        {mode === 'edit' ? t('workspace.imageEdit') : t('workspace.generateMode')}{' '}
                                        {t('workspace.parameters')}
                                    </button>
                                    <button
                                        type='button'
                                        onClick={resetCurrentParameters}
                                        className='flex h-7 shrink-0 items-center gap-1 rounded border border-slate-200 px-2 text-[11px] text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:border-white/10 dark:text-white/65 dark:hover:bg-white/10 dark:hover:text-white'
                                        aria-label={t('workspace.resetParameters')}>
                                        <RotateCcw className='h-3.5 w-3.5' />
                                        {t('workspace.resetParameters')}
                                    </button>
                                    <span className='font-mono text-[11px] text-slate-500 dark:text-white/45'>
                                        {mobileParameterSummary}
                                    </span>
                                </div>
                            </section>

                        </div>

                        <div className='hidden h-full gap-0 lg:grid lg:grid-cols-[320px_minmax(0,1fr)]'>
                            <section className='flex h-full min-h-0 flex-col border-r border-slate-200 bg-[#fbfbfc] dark:border-white/10 dark:bg-[#0f1115]'>
                                <div className='border-b border-slate-200 px-4 py-3 dark:border-white/10'>
                                    <p className='text-[13px] font-semibold text-slate-900 dark:text-white'>图像生成</p>
                                </div>
                                <div className='min-h-0 flex-1 overflow-hidden p-4'>
                                    <div className={mode === 'generate' ? 'block h-full min-h-0' : 'hidden'}>
                                        <GenerationForm
                                            onSubmit={handleApiCall}
                                            isLoading={isLoading}
                                            currentMode={mode}
                                            onModeChange={setMode}
                                            isPasswordRequiredByBackend={isPasswordRequiredByBackend}
                                            clientPasswordHash={clientPasswordHash}
                                            onOpenPasswordDialog={handleOpenPasswordDialog}
                                            model={selectedModel}
                                            prompt={genPrompt}
                                            setPrompt={setGenPrompt}
                                            n={genN}
                                            setN={setGenN}
                                            size={genSize}
                                            setSize={setGenSize}
                                            customWidth={genCustomWidth}
                                            setCustomWidth={setGenCustomWidth}
                                            customHeight={genCustomHeight}
                                            setCustomHeight={setGenCustomHeight}
                                            quality={genQuality}
                                            setQuality={setGenQuality}
                                            outputFormat={genOutputFormat}
                                            setOutputFormat={setGenOutputFormat}
                                            compression={genCompression}
                                            setCompression={setGenCompression}
                                            background={genBackground}
                                            setBackground={setGenBackground}
                                            moderation={genModeration}
                                            setModeration={setGenModeration}
                                            streamEnabled={genStreamEnabled}
                                            setStreamEnabled={setGenStreamEnabled}
                                        />
                                    </div>

                                    <div className={mode === 'edit' ? 'block h-full min-h-0' : 'hidden'}>
                                        <EditingForm
                                            onSubmit={handleApiCall}
                                            isLoading={isLoading || isSendingToEdit}
                                            isPasswordRequiredByBackend={isPasswordRequiredByBackend}
                                            clientPasswordHash={clientPasswordHash}
                                            onOpenPasswordDialog={handleOpenPasswordDialog}
                                            editModel={selectedModel}
                                            imageFiles={editImageFiles}
                                            sourceImagePreviewUrls={editSourceImagePreviewUrls}
                                            setImageFiles={setEditImageFiles}
                                            setSourceImagePreviewUrls={setEditSourceImagePreviewUrls}
                                            maxImages={MAX_EDIT_IMAGES}
                                            editPrompt={editPrompt}
                                            setEditPrompt={setEditPrompt}
                                            editN={editN}
                                            setEditN={setEditN}
                                            editSize={editSize}
                                            setEditSize={setEditSize}
                                            editCustomWidth={editCustomWidth}
                                            setEditCustomWidth={setEditCustomWidth}
                                            editCustomHeight={editCustomHeight}
                                            setEditCustomHeight={setEditCustomHeight}
                                            editQuality={editQuality}
                                            setEditQuality={setEditQuality}
                                            editBrushSize={editBrushSize}
                                            setEditBrushSize={setEditBrushSize}
                                            editShowMaskEditor={editShowMaskEditor}
                                            setEditShowMaskEditor={setEditShowMaskEditor}
                                            editGeneratedMaskFile={editGeneratedMaskFile}
                                            setEditGeneratedMaskFile={setEditGeneratedMaskFile}
                                            editIsMaskSaved={editIsMaskSaved}
                                            setEditIsMaskSaved={setEditIsMaskSaved}
                                            editOriginalImageSize={editOriginalImageSize}
                                            setEditOriginalImageSize={setEditOriginalImageSize}
                                            editDrawnPoints={editDrawnPoints}
                                            setEditDrawnPoints={setEditDrawnPoints}
                                            editMaskPreviewUrl={editMaskPreviewUrl}
                                            setEditMaskPreviewUrl={setEditMaskPreviewUrl}
                                        />
                                    </div>
                                </div>
                            </section>

                            <section className='flex h-full min-h-0 flex-col bg-[#fbfbfc] dark:bg-[#0f1115]'>
                                <div className='border-b border-slate-200 px-4 py-3 dark:border-white/10'>
                                    <p className='text-[13px] font-semibold text-slate-900 dark:text-white'>工作区</p>
                                </div>
                                <div className='flex min-h-0 flex-1 flex-col overflow-hidden p-0'>
                                    {error && (
                                        <Alert
                                            variant='destructive'
                                            className='m-4 shrink-0 border-red-300 bg-red-50 text-red-700 dark:border-red-500/50 dark:bg-red-900/20 dark:text-red-300'>
                                            <AlertTitle className='text-red-700 dark:text-red-200'>{t('common.error')}</AlertTitle>
                                            <AlertDescription>{error}</AlertDescription>
                                        </Alert>
                                    )}
                                    <div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
                                        <div className='min-h-0 flex-1 border-b border-slate-200 dark:border-white/10'>
                                            <ImageOutput
                                                imageBatch={latestImageBatch}
                                                promptText={latestBatchPrompt}
                                                viewMode={imageOutputView}
                                                onViewChange={setImageOutputView}
                                                altText={t('output.generatedAlt')}
                                                isLoading={isLoading || isSendingToEdit}
                                                elapsedSeconds={elapsedSeconds}
                                                onSendToEdit={handleSendToEdit}
                                                currentMode={mode}
                                                baseImagePreviewUrl={editSourceImagePreviewUrls[0] || null}
                                            />
                                        </div>
                                        <div className='border-b border-slate-200 dark:border-white/10'>
                                            <GenerationWorkspace
                                                customSizeInvalid={
                                                    mode === 'edit' ? editCustomSizeInvalid : genCustomSizeInvalid
                                                }
                                                isLoading={isLoading}
                                                mode={mode}
                                                onSwitchToGenerate={() => setMode('generate')}
                                                onGenerate={() =>
                                                    mode === 'edit'
                                                        ? handleApiCall({
                                                              prompt: genPrompt,
                                                              n: editN[0],
                                                              size: editSize,
                                                              customWidth: editCustomWidth,
                                                              customHeight: editCustomHeight,
                                                              quality: editQuality,
                                                              imageFiles: editImageFiles,
                                                              maskFile: editGeneratedMaskFile,
                                                              model: selectedModel
                                                          })
                                                        : handleApiCall({
                                                              prompt: genPrompt,
                                                              n: genN[0],
                                                              size: genSize,
                                                              customWidth: genCustomWidth,
                                                              customHeight: genCustomHeight,
                                                              quality: genQuality,
                                                              output_format: genOutputFormat,
                                                              ...(genOutputFormat === 'jpeg' || genOutputFormat === 'webp'
                                                                  ? { output_compression: genCompression[0] }
                                                                  : {}),
                                                              background: genBackground,
                                                              moderation: genModeration,
                                                              model: selectedModel,
                                                              stream: genStreamEnabled && genN[0] === 1,
                                                              partialImages: 2
                                                          })
                                                }
                                                onSwitchToEdit={() => setMode('edit')}
                                                prompt={genPrompt}
                                                setPrompt={setGenPrompt}
                                            />
                                        </div>
                                        <div>
                                            <ApiInfoPanel
                                                durationText={apiInfoDuration}
                                                errorText={apiResponseInfo?.error}
                                                filenames={apiResponseInfo?.filenames}
                                                isOpen={showApiResponseInfo}
                                                onToggle={() => setShowApiResponseInfo((current) => !current)}
                                                rows={apiInfoRows}
                                                statusClassName={apiInfoStatusClass}
                                                statusLabel={apiInfoStatusLabel}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </section>
                        </div>
                    </div>

                    <MobileBottomNav
                        currentItem={mode}
                        onEditClick={() => setMode('edit')}
                        onGenerateClick={() => setMode('generate')}
                        onHistoryClick={() => router.push('/history')}
                    />
                </div>
            </div>
        </main>
    );
}
