'use client';

import { EditingForm, type EditingFormData } from '@/components/editing-form';
import { GenerationForm, type GenerationFormData } from '@/components/generation-form';
import { HistoryPanel } from '@/components/history-panel';
import { ImageOutput } from '@/components/image-output';
import { PasswordDialog } from '@/components/password-dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { defaultApiBaseUrl, useAppSettings } from '@/lib/app-settings';
import { calculateApiCost, type CostDetails, type GptImageModel } from '@/lib/cost-utils';
import { db, type ImageRecord } from '@/lib/db';
import { useI18n, type LanguagePreference } from '@/lib/i18n';
import { getPresetDimensions } from '@/lib/size-utils';
import { useLiveQuery } from 'dexie-react-hooks';
import { CheckCircle2, ExternalLink, Eye, EyeOff, KeyRound, Languages, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import * as React from 'react';

type HistoryImage = {
    filename: string;
};

export type HistoryMetadata = {
    timestamp: number;
    images: HistoryImage[];
    storageModeUsed?: 'fs' | 'indexeddb';
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

let effectiveStorageModeClient: 'fs' | 'indexeddb';

if (explicitModeClient === 'fs') {
    effectiveStorageModeClient = 'fs';
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

export default function HomePage() {
    const { languagePreference, setLanguagePreference, t } = useI18n();
    const { settings, saveSettings } = useAppSettings();
    const { resolvedTheme, setTheme } = useTheme();
    const [isThemeMounted, setIsThemeMounted] = React.useState(false);
    const [mode, setMode] = React.useState<'generate' | 'edit'>('generate');
    const [isPasswordRequiredByBackend, setIsPasswordRequiredByBackend] = React.useState<boolean | null>(null);
    const [clientPasswordHash, setClientPasswordHash] = React.useState<string | null>(null);
    const [apiKeyDraft, setApiKeyDraft] = React.useState(settings.apiKey);
    const [showApiKey, setShowApiKey] = React.useState(false);
    const [isLoading, setIsLoading] = React.useState(false);
    const [isSendingToEdit, setIsSendingToEdit] = React.useState(false);
    const [activeRequestStartedAt, setActiveRequestStartedAt] = React.useState<number | null>(null);
    const [elapsedSeconds, setElapsedSeconds] = React.useState(0);
    const [error, setError] = React.useState<string | null>(null);
    const [latestImageBatch, setLatestImageBatch] = React.useState<{ path: string; filename: string }[] | null>(null);
    const [imageOutputView, setImageOutputView] = React.useState<'grid' | number>('grid');
    const [history, setHistory] = React.useState<HistoryMetadata[]>([]);
    const [imageSrcByFilename, setImageSrcByFilename] = React.useState<Record<string, string>>({});
    const [isInitialLoad, setIsInitialLoad] = React.useState(true);
    const blobUrlCacheRef = React.useRef<Map<string, string>>(new Map());
    const [isPasswordDialogOpen, setIsPasswordDialogOpen] = React.useState(false);
    const [passwordDialogContext, setPasswordDialogContext] = React.useState<'initial' | 'retry'>('initial');
    const [lastApiCallArgs, setLastApiCallArgs] = React.useState<[GenerationFormData | EditingFormData] | null>(null);
    const [skipDeleteConfirmation, setSkipDeleteConfirmation] = React.useState<boolean>(false);
    const [itemToDeleteConfirm, setItemToDeleteConfirm] = React.useState<HistoryMetadata | null>(null);
    const [dialogCheckboxStateSkipConfirm, setDialogCheckboxStateSkipConfirm] = React.useState<boolean>(false);

    const allDbImages = useLiveQuery<ImageRecord[] | undefined>(() => db.images.toArray(), []);
    const isImageCacheReady = allDbImages !== undefined;

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

    const genModel = 'gpt-image-2' as GenerationFormData['model'];
    const [genPrompt, setGenPrompt] = React.useState('');
    const [genN, setGenN] = React.useState([1]);
    const [genSize, setGenSize] = React.useState<GenerationFormData['size']>('square');
    const [genCustomWidth, setGenCustomWidth] = React.useState<number>(1024);
    const [genCustomHeight, setGenCustomHeight] = React.useState<number>(1024);
    const [genQuality, setGenQuality] = React.useState<GenerationFormData['quality']>('auto');
    const [genOutputFormat, setGenOutputFormat] = React.useState<GenerationFormData['output_format']>('png');
    const [genCompression, setGenCompression] = React.useState([100]);
    const [genBackground, setGenBackground] = React.useState<GenerationFormData['background']>('auto');
    const [genModeration, setGenModeration] = React.useState<GenerationFormData['moderation']>('auto');

    const editModel = 'gpt-image-2' as EditingFormData['model'];

    React.useEffect(() => {
        setIsThemeMounted(true);
    }, []);

    React.useEffect(() => {
        setApiKeyDraft(settings.apiKey);
    }, [settings.apiKey]);

    const currentTheme = isThemeMounted ? (resolvedTheme ?? 'dark') : 'dark';

    const handleThemeToggle = () => {
        setTheme(currentTheme === 'dark' ? 'light' : 'dark');
    };

    const handleApiKeyChange = (value: string) => {
        setApiKeyDraft(value);
        saveSettings({
            ...settings,
            baseUrl: '',
            apiKey: value
        });
    };

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

    const getImageSrc = React.useCallback(
        (filename: string): string | undefined => imageSrcByFilename[filename],
        [imageSrcByFilename]
    );

    React.useEffect(() => {
        if (allDbImages === undefined) {
            setImageSrcByFilename({});
            return;
        }

        const previousCache = blobUrlCacheRef.current;
        const nextCache = new Map<string, string>();
        const nextSrcByFilename: Record<string, string> = {};

        allDbImages.forEach((record) => {
            if (!record.blob) return;

            const cachedUrl = previousCache.get(record.filename);
            if (cachedUrl) {
                nextCache.set(record.filename, cachedUrl);
                nextSrcByFilename[record.filename] = cachedUrl;
                return;
            }

            const url = URL.createObjectURL(record.blob);
            nextCache.set(record.filename, url);
            nextSrcByFilename[record.filename] = url;
        });

        previousCache.forEach((url, filename) => {
            if (!nextCache.has(filename)) {
                URL.revokeObjectURL(url);
            }
        });

        blobUrlCacheRef.current = nextCache;
        setImageSrcByFilename(nextSrcByFilename);
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

    const readHistoryFromStorage = React.useCallback((): HistoryMetadata[] => {
        try {
            const storedHistory = localStorage.getItem('openaiImageHistory');
            if (storedHistory) {
                const parsedHistory: HistoryMetadata[] = JSON.parse(storedHistory);
                if (Array.isArray(parsedHistory)) {
                    return parsedHistory;
                }

                console.warn('Invalid history data found in localStorage.');
                localStorage.removeItem('openaiImageHistory');
            }
        } catch (e) {
            console.error('Failed to load or parse history from localStorage:', e);
            localStorage.removeItem('openaiImageHistory');
        }

        return [];
    }, []);

    React.useEffect(() => {
        setHistory(readHistoryFromStorage());
        setIsInitialLoad(false);
    }, [readHistoryFromStorage]);

    React.useEffect(() => {
        const refreshHistory = () => {
            setHistory(readHistoryFromStorage());
        };

        const refreshWhenVisible = () => {
            if (!document.hidden) {
                refreshHistory();
            }
        };

        window.addEventListener('pageshow', refreshHistory);
        window.addEventListener('focus', refreshHistory);
        document.addEventListener('visibilitychange', refreshWhenVisible);

        return () => {
            window.removeEventListener('pageshow', refreshHistory);
            window.removeEventListener('focus', refreshHistory);
            document.removeEventListener('visibilitychange', refreshWhenVisible);
        };
    }, [readHistoryFromStorage]);

    React.useEffect(() => {
        const fetchAuthStatus = async () => {
            try {
                const response = await fetch('/api/auth-status');
                if (!response.ok) {
                    throw new Error('Failed to fetch auth status');
                }
                const data = await response.json();
                setIsPasswordRequiredByBackend(data.passwordRequired);
            } catch (error) {
                console.error('Error fetching auth status:', error);
                setIsPasswordRequiredByBackend(false);
            }
        };

        fetchAuthStatus();
        const storedHash = localStorage.getItem('clientPasswordHash');
        if (storedHash) {
            setClientPasswordHash(storedHash);
        }
    }, []);

    React.useEffect(() => {
        if (!isInitialLoad) {
            try {
                localStorage.setItem('openaiImageHistory', JSON.stringify(history));
            } catch (e) {
                console.error('Failed to save history to localStorage:', e);
            }
        }
    }, [history, isInitialLoad]);

    React.useEffect(() => {
        return () => {
            editSourceImagePreviewUrls.forEach((url) => URL.revokeObjectURL(url));
        };
    }, [editSourceImagePreviewUrls]);

    React.useEffect(() => {
        const storedPref = localStorage.getItem('imageGenSkipDeleteConfirm');
        if (storedPref === 'true') {
            setSkipDeleteConfirmation(true);
        } else if (storedPref === 'false') {
            setSkipDeleteConfirmation(false);
        }
    }, []);

    React.useEffect(() => {
        localStorage.setItem('imageGenSkipDeleteConfirm', String(skipDeleteConfirmation));
    }, [skipDeleteConfirmation]);

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

    const cacheApiImageForDisplay = async (
        img: ApiImageResponseItem
    ): Promise<{ path: string; filename: string } | null> => {
        if (img.b64_json) {
            try {
                const byteCharacters = atob(img.b64_json);
                const byteNumbers = new Array(byteCharacters.length);
                for (let i = 0; i < byteCharacters.length; i++) {
                    byteNumbers[i] = byteCharacters.charCodeAt(i);
                }
                const byteArray = new Uint8Array(byteNumbers);

                const actualMimeType = getMimeTypeFromFormat(img.output_format);
                const blob = new Blob([byteArray], { type: actualMimeType });

                await db.images.put({ filename: img.filename, blob });

                const previousBlobUrl = blobUrlCacheRef.current.get(img.filename);
                if (previousBlobUrl) {
                    URL.revokeObjectURL(previousBlobUrl);
                }

                const blobUrl = URL.createObjectURL(blob);
                blobUrlCacheRef.current.set(img.filename, blobUrl);
                setImageSrcByFilename((current) => ({
                    ...current,
                    [img.filename]: blobUrl
                }));

                return { filename: img.filename, path: blobUrl };
            } catch (dbError) {
                console.error(`Error caching blob ${img.filename} to IndexedDB:`, dbError);
                if (effectiveStorageModeClient === 'indexeddb') {
                    setError(t('page.saveIndexedDbError', { filename: img.filename }));
                    return null;
                }
            }
        } else {
            console.warn(`Image ${img.filename} missing b64_json; falling back to server path when available.`);
        }

        if (img.path) {
            return { filename: img.filename, path: img.path };
        }

        return null;
    };

    const handleApiCall = async (formData: GenerationFormData | EditingFormData) => {
        const startTime = Date.now();
        let durationMs = 0;

        setIsLoading(true);
        setActiveRequestStartedAt(startTime);
        setElapsedSeconds(0);
        setError(null);
        setLatestImageBatch(null);
        setImageOutputView('grid');

        const apiFormData = new FormData();
        const apiKey = apiKeyDraft.trim() || settings.apiKey.trim();
        const baseUrl = defaultApiBaseUrl;

        if (apiKey) {
            apiFormData.append('apiKey', apiKey);
        }
        apiFormData.append('baseUrl', baseUrl);

        if (isPasswordRequiredByBackend && clientPasswordHash) {
            apiFormData.append('passwordHash', clientPasswordHash);
        } else if (isPasswordRequiredByBackend && !clientPasswordHash) {
            setError(t('page.passwordMissing'));
            setPasswordDialogContext('initial');
            setIsPasswordDialogOpen(true);
            setIsLoading(false);
            return;
        }
        apiFormData.append('mode', mode);

        let requestSize = '';
        let requestOutputCompression: number | undefined;
        let requestSourceImageCount = 0;
        let requestHasMask = false;

        if (mode === 'generate') {
            const genData = formData as GenerationFormData;
            apiFormData.append('model', genModel);
            apiFormData.append('prompt', genPrompt);
            apiFormData.append('n', genN[0].toString());
            const genSizeToSend =
                genSize === 'custom'
                    ? `${genCustomWidth}x${genCustomHeight}`
                    : (getPresetDimensions(genSize, genModel) ?? genSize);
            requestSize = genSizeToSend;
            apiFormData.append('size', genSizeToSend);
            apiFormData.append('quality', genQuality);
            apiFormData.append('output_format', genOutputFormat);
            if (
                (genOutputFormat === 'jpeg' || genOutputFormat === 'webp') &&
                genData.output_compression !== undefined
            ) {
                requestOutputCompression = genData.output_compression;
                apiFormData.append('output_compression', genData.output_compression.toString());
            }
            apiFormData.append('background', genBackground);
            apiFormData.append('moderation', genModeration);
        } else {
            apiFormData.append('model', editModel);
            apiFormData.append('prompt', editPrompt);
            apiFormData.append('n', editN[0].toString());
            const editSizeToSend =
                editSize === 'custom'
                    ? `${editCustomWidth}x${editCustomHeight}`
                    : (getPresetDimensions(editSize, editModel) ?? editSize);
            requestSize = editSizeToSend;
            requestSourceImageCount = editImageFiles.length;
            requestHasMask = !!editGeneratedMaskFile;
            apiFormData.append('size', editSizeToSend);
            apiFormData.append('quality', editQuality);

            editImageFiles.forEach((file, index) => {
                apiFormData.append(`image_${index}`, file, file.name);
            });
            if (editGeneratedMaskFile) {
                apiFormData.append('mask', editGeneratedMaskFile, editGeneratedMaskFile.name);
            }
        }

        try {
            const response = await fetch('/api/images', {
                method: 'POST',
                body: apiFormData
            });

            // Check if response is SSE (streaming)
            const contentType = response.headers.get('content-type');
            if (contentType?.includes('text/event-stream')) {
                if (!response.body) {
                    throw new Error(t('page.unexpectedError'));
                }

                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';

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
                                    // Streaming previews are intentionally hidden in the UI.
                                    continue;
                                } else if (event.type === 'error') {
                                    throw new Error(event.error || t('page.streamingError'));
                                } else if (event.type === 'done') {
                                    // Finalize with all completed images
                                    durationMs = Date.now() - startTime;

                                    if (event.images && event.images.length > 0) {
                                        let historyQuality: GenerationFormData['quality'] = 'auto';
                                        let historyBackground: GenerationFormData['background'] = 'auto';
                                        let historyModeration: GenerationFormData['moderation'] = 'auto';
                                        let historyOutputFormat: GenerationFormData['output_format'] = 'png';
                                        let historyPrompt: string = '';

                                        if (mode === 'generate') {
                                            historyQuality = genQuality;
                                            historyBackground = genBackground;
                                            historyModeration = genModeration;
                                            historyOutputFormat = genOutputFormat;
                                            historyPrompt = genPrompt;
                                        } else {
                                            historyQuality = editQuality;
                                            historyBackground = 'auto';
                                            historyModeration = 'auto';
                                            historyOutputFormat = 'png';
                                            historyPrompt = editPrompt;
                                        }

                                        const currentModel = mode === 'generate' ? genModel : editModel;
                                        const costDetails = calculateApiCost(event.usage, currentModel);

                                        const batchTimestamp = Date.now();
                                        const newHistoryEntry: HistoryMetadata = {
                                            timestamp: batchTimestamp,
                                            images: event.images.map((img: { filename: string }) => ({
                                                filename: img.filename
                                            })),
                                            storageModeUsed: effectiveStorageModeClient,
                                            durationMs: durationMs,
                                            quality: historyQuality,
                                            background: historyBackground,
                                            moderation: historyModeration,
                                            output_format: historyOutputFormat,
                                            prompt: historyPrompt,
                                            mode: mode,
                                            costDetails: costDetails,
                                            model: currentModel,
                                            size: requestSize,
                                            output_compression: requestOutputCompression,
                                            streaming: false,
                                            sourceImageCount: requestSourceImageCount,
                                            hasMask: requestHasMask
                                        };

                                        const newImageBatchPromises = event.images.map((img: ApiImageResponseItem) =>
                                            cacheApiImageForDisplay(img)
                                        );

                                        const processedImages = (await Promise.all(newImageBatchPromises)).filter(
                                            Boolean
                                        ) as {
                                            path: string;
                                            filename: string;
                                        }[];

                                        setLatestImageBatch(processedImages);
                                        setImageOutputView(processedImages.length > 1 ? 'grid' : 0);

                                        setHistory((prevHistory) => [newHistoryEntry, ...prevHistory]);
                                    }
                                }
                            } catch (parseError) {
                                console.error('Error parsing SSE event:', parseError);
                            }
                        }
                    }
                }

                return; // Exit early for streaming
            }

            // Non-streaming response handling (original code)
            const result = await response.json();

            if (!response.ok) {
                if (response.status === 401 && isPasswordRequiredByBackend) {
                    setError(t('page.unauthorized'));
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
                    historyQuality = genQuality;
                    historyBackground = genBackground;
                    historyModeration = genModeration;
                    historyOutputFormat = genOutputFormat;
                    historyPrompt = genPrompt;
                } else {
                    historyQuality = editQuality;
                    historyBackground = 'auto';
                    historyModeration = 'auto';
                    historyOutputFormat = 'png';
                    historyPrompt = editPrompt;
                }

                const currentModel = mode === 'generate' ? genModel : editModel;
                const costDetails = calculateApiCost(result.usage, currentModel);

                const batchTimestamp = Date.now();
                const newHistoryEntry: HistoryMetadata = {
                    timestamp: batchTimestamp,
                    images: result.images.map((img: { filename: string }) => ({ filename: img.filename })),
                    storageModeUsed: effectiveStorageModeClient,
                    durationMs: durationMs,
                    quality: historyQuality,
                    background: historyBackground,
                    moderation: historyModeration,
                    output_format: historyOutputFormat,
                    prompt: historyPrompt,
                    mode: mode,
                    costDetails: costDetails,
                    model: currentModel,
                    size: requestSize,
                    output_compression: requestOutputCompression,
                    streaming: false,
                    sourceImageCount: requestSourceImageCount,
                    hasMask: requestHasMask
                };

                const newImageBatchPromises = result.images.map((img: ApiImageResponseItem) =>
                    cacheApiImageForDisplay(img)
                );

                const processedImages = (await Promise.all(newImageBatchPromises)).filter(Boolean) as {
                    path: string;
                    filename: string;
                }[];

                setLatestImageBatch(processedImages);
                setImageOutputView(processedImages.length > 1 ? 'grid' : 0);

                setHistory((prevHistory) => [newHistoryEntry, ...prevHistory]);
            } else {
                setLatestImageBatch(null);
                throw new Error(t('page.apiNoImages'));
            }
        } catch (err: unknown) {
            durationMs = Date.now() - startTime;
            console.error(`API Call Error after ${durationMs}ms:`, err);
            const errorMessage = err instanceof Error ? err.message : t('page.unexpectedError');
            setError(errorMessage);
            setLatestImageBatch(null);
        } finally {
            if (durationMs === 0) durationMs = Date.now() - startTime;
            setIsLoading(false);
            setActiveRequestStartedAt(null);
        }
    };

    const handleHistorySelect = React.useCallback(
        (item: HistoryMetadata) => {
            const selectedBatchPromises = item.images.map(async (imgInfo) => {
                const originalStorageMode = item.storageModeUsed || 'fs';
                const path =
                    getImageSrc(imgInfo.filename) ??
                    (originalStorageMode === 'fs' && isImageCacheReady ? `/api/image/${imgInfo.filename}` : undefined);

                if (path) {
                    return { path, filename: imgInfo.filename };
                } else {
                    console.warn(
                        `Could not get image source for history item: ${imgInfo.filename} (mode: ${originalStorageMode})`
                    );
                    setError(t('page.historyImageLoadError', { filename: imgInfo.filename }));
                    return null;
                }
            });

            Promise.all(selectedBatchPromises).then((resolvedBatch) => {
                const validImages = resolvedBatch.filter(Boolean) as { path: string; filename: string }[];

                if (validImages.length !== item.images.length) {
                    setError(t('page.historyImagesLoadSomeError'));
                } else {
                    setError(null);
                }

                setLatestImageBatch(validImages.length > 0 ? validImages : null);
                setImageOutputView(validImages.length > 1 ? 'grid' : 0);
            });
        },
        [getImageSrc, isImageCacheReady, t]
    );

    const handleClearHistory = React.useCallback(async () => {
        const confirmationMessage =
            effectiveStorageModeClient === 'indexeddb'
                ? t('history.clearConfirmIndexedDb')
                : t('history.clearConfirmFs');

        if (window.confirm(confirmationMessage)) {
            setHistory([]);
            setLatestImageBatch(null);
            setImageOutputView('grid');
            setError(null);

            try {
                localStorage.removeItem('openaiImageHistory');

                await db.images.clear();
                blobUrlCacheRef.current.forEach((url) => URL.revokeObjectURL(url));
                blobUrlCacheRef.current.clear();
                setImageSrcByFilename({});
            } catch (e) {
                console.error('Failed during history clearing:', e);
                setError(t('page.clearHistoryError', { message: e instanceof Error ? e.message : String(e) }));
            }
        }
    }, [t]);

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

    const executeDeleteItem = React.useCallback(
        async (item: HistoryMetadata) => {
            if (!item) return;
            setError(null);

            const { images: imagesInEntry, storageModeUsed, timestamp } = item;
            const storageMode = storageModeUsed || 'fs';
            const filenamesToDelete = imagesInEntry.map((img) => img.filename);

            try {
                await db.images.where('filename').anyOf(filenamesToDelete).delete();
                filenamesToDelete.forEach((fn) => {
                    const url = blobUrlCacheRef.current.get(fn);
                    if (url) URL.revokeObjectURL(url);
                    blobUrlCacheRef.current.delete(fn);
                });
                setImageSrcByFilename((current) => {
                    const next = { ...current };
                    filenamesToDelete.forEach((filename) => {
                        delete next[filename];
                    });
                    return next;
                });

                if (storageMode === 'fs') {
                    const apiPayload: { filenames: string[]; passwordHash?: string } = {
                        filenames: filenamesToDelete
                    };
                    if (isPasswordRequiredByBackend && clientPasswordHash) {
                        apiPayload.passwordHash = clientPasswordHash;
                    }

                    const response = await fetch('/api/image-delete', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(apiPayload)
                    });

                    const result = await response.json();
                    if (!response.ok) {
                        throw new Error(result.error || t('page.deleteApiFailed', { status: response.status }));
                    }
                }

                setHistory((prevHistory) => prevHistory.filter((h) => h.timestamp !== timestamp));
                setLatestImageBatch((prev) =>
                    prev && prev.some((img) => filenamesToDelete.includes(img.filename)) ? null : prev
                );
            } catch (e: unknown) {
                console.error('Error during item deletion:', e);
                setError(e instanceof Error ? e.message : t('page.unexpectedDeleteError'));
            } finally {
                setItemToDeleteConfirm(null);
            }
        },
        [isPasswordRequiredByBackend, clientPasswordHash, t]
    );

    const handleRequestDeleteItem = React.useCallback(
        (item: HistoryMetadata) => {
            if (!skipDeleteConfirmation) {
                setDialogCheckboxStateSkipConfirm(skipDeleteConfirmation);
                setItemToDeleteConfirm(item);
            } else {
                executeDeleteItem(item);
            }
        },
        [skipDeleteConfirmation, executeDeleteItem]
    );

    const handleConfirmDeletion = React.useCallback(() => {
        if (itemToDeleteConfirm) {
            executeDeleteItem(itemToDeleteConfirm);
            setSkipDeleteConfirmation(dialogCheckboxStateSkipConfirm);
        }
    }, [itemToDeleteConfirm, executeDeleteItem, dialogCheckboxStateSkipConfirm]);

    const handleCancelDeletion = React.useCallback(() => {
        setItemToDeleteConfirm(null);
    }, []);

    return (
        <main className='min-h-screen bg-black p-3 text-white md:p-4 lg:h-screen lg:overflow-hidden'>
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
            <div className='flex min-h-screen w-full flex-col gap-3 lg:h-full lg:min-h-0'>
                <header className='shrink-0 rounded-lg border border-white/10 bg-black/95 px-4 py-3 shadow-sm'>
                    <div className='flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between'>
                        <div className='min-w-0'>
                            <p className='text-xs font-medium tracking-[0.16em] text-white/45 uppercase'>
                                {t('home.kicker')}
                            </p>
                            <h1 className='mt-0.5 text-2xl font-semibold text-white md:text-3xl'>{t('home.title')}</h1>
                            <p className='mt-1 text-sm text-white/55'>
                                {t('home.fixedEndpoint', { url: defaultApiBaseUrl })}
                            </p>
                        </div>

                        <div className='grid gap-2 sm:grid-cols-[minmax(360px,520px)_140px_44px] sm:items-start'>
                            <div className='min-w-0'>
                                <Label
                                    htmlFor='home-api-key'
                                    className='mb-1.5 flex items-center gap-1.5 text-xs font-medium text-white/70'>
                                    <KeyRound className='h-3.5 w-3.5' />
                                    {t('settings.apiKey')}
                                </Label>
                                <div className='flex gap-2'>
                                    <Input
                                        id='home-api-key'
                                        type={showApiKey ? 'text' : 'password'}
                                        value={apiKeyDraft}
                                        onChange={(event) => handleApiKeyChange(event.target.value)}
                                        placeholder={t('settings.apiKeyPlaceholder')}
                                        className='h-9 border-white/20 bg-black text-white placeholder:text-white/35 focus:border-white/50 focus:ring-white/50'
                                    />
                                    <Button
                                        type='button'
                                        variant='outline'
                                        size='icon'
                                        onClick={() => setShowApiKey((current) => !current)}
                                        className='h-9 w-9 border-white/20 text-white/75 hover:bg-white/10 hover:text-white'
                                        aria-label={showApiKey ? t('home.hideApiKey') : t('home.showApiKey')}>
                                        {showApiKey ? <EyeOff className='h-4 w-4' /> : <Eye className='h-4 w-4' />}
                                    </Button>
                                    <Button
                                        asChild
                                        type='button'
                                        variant='outline'
                                        className='h-9 shrink-0 border-white/20 px-2.5 text-xs text-white/75 hover:bg-white/10 hover:text-white'>
                                        <a
                                            href='https://api.774966.xyz/console/token'
                                            target='_blank'
                                            rel='noreferrer'
                                            aria-label={t('home.getApiKeyAria')}>
                                            <ExternalLink className='h-3.5 w-3.5' />
                                            {t('home.getApiKey')}
                                        </a>
                                    </Button>
                                </div>
                            </div>

                            <div className='min-w-0'>
                                <p className='mb-1.5 flex items-center gap-1.5 text-xs font-medium text-white/70'>
                                    <Languages className='h-3.5 w-3.5' />
                                    {t('settings.language')}
                                </p>
                                <Select
                                    value={languagePreference}
                                    onValueChange={(value) => setLanguagePreference(value as LanguagePreference)}>
                                    <SelectTrigger
                                        aria-label={t('settings.languageAria')}
                                        className='h-9 w-full border-white/20 bg-black text-white focus:border-white/50 focus:ring-white/50'>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent className='border-white/20 bg-black text-white'>
                                        <SelectItem value='system' className='focus:bg-white/10'>
                                            {t('settings.system')}
                                        </SelectItem>
                                        <SelectItem value='en' className='focus:bg-white/10'>
                                            {t('settings.english')}
                                        </SelectItem>
                                        <SelectItem value='zh' className='focus:bg-white/10'>
                                            {t('settings.chinese')}
                                        </SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <div>
                                <p className='mb-1.5 text-xs font-medium text-white/70'>{t('settings.theme')}</p>
                                <Button
                                    type='button'
                                    variant='outline'
                                    size='icon'
                                    onClick={handleThemeToggle}
                                    className='h-9 w-9 border-white/20 text-white/75 hover:bg-white/10 hover:text-white'
                                    aria-label={t('home.toggleTheme')}>
                                    {currentTheme === 'dark' ? (
                                        <Moon className='h-4 w-4' />
                                    ) : (
                                        <Sun className='h-4 w-4' />
                                    )}
                                </Button>
                            </div>

                            <p className='flex min-h-4 items-center gap-1.5 text-xs text-white/45 sm:col-span-3'>
                                {apiKeyDraft.trim() && <CheckCircle2 className='h-3.5 w-3.5 text-green-400' />}
                                {t('home.apiKeyHelp')}
                            </p>
                        </div>
                    </div>
                </header>

                <div className='grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(340px,420px)_minmax(300px,1fr)_minmax(280px,320px)] lg:overflow-hidden xl:grid-cols-[minmax(420px,520px)_minmax(420px,1fr)_minmax(320px,360px)] 2xl:grid-cols-[minmax(500px,620px)_minmax(480px,1fr)_minmax(360px,400px)]'>
                    <section className='relative flex min-h-[620px] flex-col lg:min-h-0 lg:overflow-hidden'>
                        <div className={mode === 'generate' ? 'block h-full w-full' : 'hidden'}>
                            <GenerationForm
                                onSubmit={handleApiCall}
                                isLoading={isLoading}
                                currentMode={mode}
                                onModeChange={setMode}
                                isPasswordRequiredByBackend={isPasswordRequiredByBackend}
                                clientPasswordHash={clientPasswordHash}
                                onOpenPasswordDialog={handleOpenPasswordDialog}
                                model={genModel}
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
                            />
                        </div>
                        <div className={mode === 'edit' ? 'block h-full w-full' : 'hidden'}>
                            <EditingForm
                                onSubmit={handleApiCall}
                                isLoading={isLoading || isSendingToEdit}
                                currentMode={mode}
                                onModeChange={setMode}
                                isPasswordRequiredByBackend={isPasswordRequiredByBackend}
                                clientPasswordHash={clientPasswordHash}
                                onOpenPasswordDialog={handleOpenPasswordDialog}
                                editModel={editModel}
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
                    </section>

                    <section className='flex min-h-[520px] flex-col lg:min-h-0 lg:overflow-hidden'>
                        {error && (
                            <Alert variant='destructive' className='mb-3 border-red-500/50 bg-red-900/20 text-red-300'>
                                <AlertTitle className='text-red-200'>{t('common.error')}</AlertTitle>
                                <AlertDescription>{error}</AlertDescription>
                            </Alert>
                        )}
                        <div className='min-h-0 flex-1'>
                            <ImageOutput
                                imageBatch={latestImageBatch}
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
                    </section>

                    <section className='min-h-[480px] lg:min-h-0 lg:overflow-hidden'>
                        <HistoryPanel
                            history={history}
                            onSelectImage={handleHistorySelect}
                            onClearHistory={handleClearHistory}
                            getImageSrc={getImageSrc}
                            isImageCacheReady={isImageCacheReady}
                            onDeleteItemRequest={handleRequestDeleteItem}
                            itemPendingDeleteConfirmation={itemToDeleteConfirm}
                            onConfirmDeletion={handleConfirmDeletion}
                            onCancelDeletion={handleCancelDeletion}
                            deletePreferenceDialogValue={dialogCheckboxStateSkipConfirm}
                            onDeletePreferenceDialogChange={setDialogCheckboxStateSkipConfirm}
                        />
                    </section>
                </div>
            </div>
        </main>
    );
}
