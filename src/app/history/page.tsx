'use client';

import type { HistoryMetadata } from '@/app/page';
import { MobileBottomNav } from '@/components/home/mobile-bottom-nav';
import { HistoryPanel } from '@/components/history-panel';
import { Button } from '@/components/ui/button';
import { useHomeAuth } from '@/hooks/use-home-auth';
import { useHomeHistory } from '@/hooks/use-home-history';
import { db, LEGACY_IMAGE_USER_ID, type ImageRecord } from '@/lib/db';
import { useI18n } from '@/lib/i18n';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';
import * as React from 'react';

const explicitModeClient = process.env.NEXT_PUBLIC_IMAGE_STORAGE_MODE;
const vercelEnvClient = process.env.NEXT_PUBLIC_VERCEL_ENV;
const isOnVercelClient = vercelEnvClient === 'production' || vercelEnvClient === 'preview';

const effectiveStorageModeClient: 'fs' | 'indexeddb' | 'minio' =
    explicitModeClient === 'fs'
        ? 'fs'
        : explicitModeClient === 'minio'
          ? 'minio'
        : explicitModeClient === 'indexeddb'
          ? 'indexeddb'
          : isOnVercelClient
            ? 'indexeddb'
            : 'fs';

export default function HistoryPage() {
    const router = useRouter();
    const { t } = useI18n();
    const { authMode, clientPasswordHash, image2User, isAuthReady, isPasswordRequiredByBackend } = useHomeAuth();
    const scopedHistoryUserId = authMode === 'sub2api' ? (image2User?.id ?? null) : undefined;
    const activeImageUserId = authMode === 'sub2api' ? image2User?.id : LEGACY_IMAGE_USER_ID;
    const {
        clearStoredHistory,
        history,
        setHistory,
        setSkipDeleteConfirmation,
        skipDeleteConfirmation
    } = useHomeHistory<HistoryMetadata>(scopedHistoryUserId);
    const [error, setError] = React.useState<string | null>(null);
    const [serverHistory, setServerHistory] = React.useState<HistoryMetadata[]>([]);
    const [itemToDeleteConfirm, setItemToDeleteConfirm] = React.useState<HistoryMetadata | null>(null);
    const [dialogCheckboxStateSkipConfirm, setDialogCheckboxStateSkipConfirm] = React.useState(false);
    const [imageSrcByFilename, setImageSrcByFilename] = React.useState<Record<string, string>>({});
    const blobUrlCacheRef = React.useRef<Map<string, string>>(new Map());
    const allDbImages = useLiveQuery<ImageRecord[] | undefined>(
        () =>
            activeImageUserId === undefined
                ? Promise.resolve([])
                : db.images.where('userId').equals(activeImageUserId).toArray(),
        [activeImageUserId]
    );
    const isImageCacheReady = allDbImages !== undefined;
    const hasPendingHistory = history.some((item) => item.status === 'pending');
    const pendingTimestampsKey = React.useMemo(
        () =>
            history
                .filter((item) => item.status === 'pending')
                .map((item) => item.timestamp)
                .sort((left, right) => left - right)
                .join(','),
        [history]
    );

    React.useEffect(() => {
        if (effectiveStorageModeClient !== 'fs' && effectiveStorageModeClient !== 'minio') {
            setServerHistory([]);
            return;
        }

        if (authMode === 'sub2api' && !isAuthReady) {
            setServerHistory([]);
            return;
        }

        if (authMode !== 'sub2api' && isPasswordRequiredByBackend && !clientPasswordHash) {
            setServerHistory([]);
            return;
        }

        const controller = new AbortController();

        const loadServerHistory = async () => {
            try {
                const params = new URLSearchParams();
                if (authMode !== 'sub2api' && isPasswordRequiredByBackend && clientPasswordHash) {
                    params.set('passwordHash', clientPasswordHash);
                }

                const pendingTimestamps = pendingTimestampsKey
                    ? pendingTimestampsKey.split(',').map((value) => Number.parseInt(value, 10)).filter(Number.isFinite)
                    : [];
                params.set('page_size', hasPendingHistory ? '1000' : '100');
                if (pendingTimestamps.length > 0) {
                    params.set('since', Math.min(...pendingTimestamps).toString());
                }

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
                const loadedServerHistory = Array.isArray(result.data?.items)
                    ? result.data.items
                    : Array.isArray(result.history)
                      ? result.history
                      : [];
                setServerHistory(loadedServerHistory);

                if (hasPendingHistory) {
                    const loadedServerHistoryByTimestamp = new Map(
                        loadedServerHistory.map((item) => [item.timestamp, item])
                    );
                    setHistory((prevHistory) =>
                        prevHistory.map((item) => {
                            const serverItem = loadedServerHistoryByTimestamp.get(item.timestamp);
                            if (item.status !== 'pending' || !serverItem || serverItem.images.length === 0) {
                                return item;
                            }

                            return {
                                ...item,
                                images: serverItem.images,
                                status: 'completed',
                                durationMs: item.durationMs || serverItem.durationMs,
                                output_format: item.output_format || serverItem.output_format,
                                storageModeUsed: serverItem.storageModeUsed || item.storageModeUsed || effectiveStorageModeClient
                            };
                        })
                    );
                }
            } catch (loadError) {
                if (loadError instanceof DOMException && loadError.name === 'AbortError') {
                    return;
                }

                console.error('Failed to load server image history:', loadError);
            }
        };

        loadServerHistory();
        const intervalId = hasPendingHistory ? window.setInterval(loadServerHistory, 5000) : undefined;

        return () => {
            if (intervalId) window.clearInterval(intervalId);
            controller.abort();
        };
    }, [
        authMode,
        clientPasswordHash,
        hasPendingHistory,
        isAuthReady,
        isPasswordRequiredByBackend,
        pendingTimestampsKey,
        setHistory
    ]);

    const displayedHistory = React.useMemo(() => {
        const serverHistoryByTimestamp = new Map(serverHistory.map((item) => [item.timestamp, item]));
        const localFilenames = new Set(history.flatMap((item) => item.images.map((image) => image.filename)));
        const mergedLocalHistory = history.map((item) => {
            const serverItem = serverHistoryByTimestamp.get(item.timestamp);
            if (!serverItem || serverItem.images.length === 0) {
                return item;
            }

            if (item.images.length === 0 || item.status === 'pending') {
                return {
                    ...item,
                    images: serverItem.images,
                    status: 'completed' as const,
                    durationMs: item.durationMs || serverItem.durationMs,
                    output_format: item.output_format || serverItem.output_format,
                    storageModeUsed: serverItem.storageModeUsed || item.storageModeUsed || effectiveStorageModeClient
                };
            }

            return item;
        });
        const localTimestamps = new Set(mergedLocalHistory.map((item) => item.timestamp));
        const missingServerHistory = serverHistory
            .filter((item) => !localTimestamps.has(item.timestamp))
            .map((item) => ({
                ...item,
                images: item.images.filter((image) => !localFilenames.has(image.filename))
            }))
            .filter((item) => item.images.length > 0);

        return [...mergedLocalHistory, ...missingServerHistory];
    }, [history, serverHistory]);

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
        const cache = blobUrlCacheRef.current;
        return () => {
            cache.forEach((url) => URL.revokeObjectURL(url));
            cache.clear();
        };
    }, []);

    const getImageSrc = React.useCallback(
        (filename: string): string | undefined => imageSrcByFilename[filename],
        [imageSrcByFilename]
    );

    const handleSelectImage = React.useCallback(
        (item: HistoryMetadata, imageIndex = 0) => {
            window.location.assign(`/history/${item.timestamp}?image=${imageIndex}`);
        },
        []
    );

    const handleClearHistory = React.useCallback(async () => {
        const confirmationMessage =
            effectiveStorageModeClient === 'indexeddb'
                ? t('history.clearConfirmIndexedDb')
                : t('history.clearConfirmFs');

        if (!window.confirm(confirmationMessage)) return;

        const filenamesToDelete = Array.from(
            new Set(displayedHistory.flatMap((item) => item.images.map((image) => image.filename)))
        );

        setHistory([]);
        setServerHistory([]);
        setError(null);

        try {
            clearStoredHistory();
            if (activeImageUserId !== undefined) {
                await db.images.where('userId').equals(activeImageUserId).delete();
            }

            if (
                (effectiveStorageModeClient === 'fs' || effectiveStorageModeClient === 'minio') &&
                filenamesToDelete.length > 0
            ) {
                const apiPayload: { filenames: string[]; passwordHash?: string } = {
                    filenames: filenamesToDelete
                };
                if (authMode !== 'sub2api' && isPasswordRequiredByBackend && clientPasswordHash) {
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

            blobUrlCacheRef.current.forEach((url) => URL.revokeObjectURL(url));
            blobUrlCacheRef.current.clear();
            setImageSrcByFilename({});
        } catch (e) {
            console.error('Failed during history clearing:', e);
            setError(t('page.clearHistoryError', { message: e instanceof Error ? e.message : String(e) }));
        }
    }, [
        activeImageUserId,
        authMode,
        clearStoredHistory,
        clientPasswordHash,
        displayedHistory,
        isPasswordRequiredByBackend,
        setHistory,
        t
    ]);

    const executeDeleteItem = React.useCallback(
        async (item: HistoryMetadata) => {
            setError(null);

            const { images: imagesInEntry, storageModeUsed, timestamp } = item;
            const storageMode = storageModeUsed || 'fs';
            const filenamesToDelete = imagesInEntry.map((img) => img.filename);

            try {
                if (activeImageUserId !== undefined) {
                    await db.images
                        .where('[userId+filename]')
                        .anyOf(filenamesToDelete.map((filename) => [activeImageUserId, filename]))
                        .delete();
                }
                filenamesToDelete.forEach((filename) => {
                    const url = blobUrlCacheRef.current.get(filename);
                    if (url) URL.revokeObjectURL(url);
                    blobUrlCacheRef.current.delete(filename);
                });
                setImageSrcByFilename((current) => {
                    const next = { ...current };
                    filenamesToDelete.forEach((filename) => {
                        delete next[filename];
                    });
                    return next;
                });

                if (storageMode === 'fs' || storageMode === 'minio') {
                    const apiPayload: { filenames: string[]; passwordHash?: string } = {
                        filenames: filenamesToDelete
                    };
                    if (authMode !== 'sub2api' && isPasswordRequiredByBackend && clientPasswordHash) {
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

                setHistory((prevHistory) => prevHistory.filter((historyItem) => historyItem.timestamp !== timestamp));
                setServerHistory((prevHistory) => prevHistory.filter((historyItem) => historyItem.timestamp !== timestamp));
            } catch (e: unknown) {
                console.error('Error during item deletion:', e);
                setError(e instanceof Error ? e.message : t('page.unexpectedDeleteError'));
            } finally {
                setItemToDeleteConfirm(null);
            }
        },
        [activeImageUserId, authMode, clientPasswordHash, isPasswordRequiredByBackend, setHistory, t]
    );

    const handleRequestDeleteItem = React.useCallback(
        (item: HistoryMetadata) => {
            if (!skipDeleteConfirmation) {
                setDialogCheckboxStateSkipConfirm(skipDeleteConfirmation);
                setItemToDeleteConfirm(item);
                return;
            }

            executeDeleteItem(item);
        },
        [executeDeleteItem, skipDeleteConfirmation]
    );

    const handleConfirmDeletion = React.useCallback(() => {
        if (!itemToDeleteConfirm) return;

        executeDeleteItem(itemToDeleteConfirm);
        setSkipDeleteConfirmation(dialogCheckboxStateSkipConfirm);
    }, [dialogCheckboxStateSkipConfirm, executeDeleteItem, itemToDeleteConfirm, setSkipDeleteConfirmation]);

    if (authMode === 'sub2api' && !isAuthReady) {
        return (
            <main className='flex h-dvh items-center justify-center overflow-hidden bg-slate-50 text-slate-900 dark:bg-[#0d1015] dark:text-white'>
                <p className='text-sm text-slate-500 dark:text-white/60'>{t('history.loading')}</p>
            </main>
        );
    }

    return (
        <main className='h-dvh overflow-hidden bg-slate-50 text-slate-900 dark:bg-[#0d1015] dark:text-white'>
            <div className='flex h-full min-h-0 flex-col overflow-hidden pb-[calc(3rem+env(safe-area-inset-bottom))] lg:pb-0'>
                <header className='flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-[#fbfbfc] px-3 dark:border-white/10 dark:bg-[#0f1115]'>
                    <div className='flex min-w-0 items-center gap-2'>
                        <Button
                            type='button'
                            variant='ghost'
                            size='sm'
                            onClick={() => router.push('/')}
                            className='h-8 px-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-white/70 dark:hover:bg-white/10 dark:hover:text-white'>
                            <ArrowLeft className='h-4 w-4' />
                            {t('settings.back')}
                        </Button>
                        <h1 className='truncate text-[14px] font-semibold text-slate-900 dark:text-white'>{t('nav.history')}</h1>
                    </div>
                    {error && <p className='max-w-[50vw] truncate text-[12px] text-red-500'>{error}</p>}
                </header>

                <div className='min-h-0 flex-1 overflow-hidden p-2 lg:p-4'>
                    <HistoryPanel
                        history={displayedHistory}
                        onSelectImage={handleSelectImage}
                        onClearHistory={handleClearHistory}
                        getImageSrc={getImageSrc}
                        isImageCacheReady={isImageCacheReady}
                        onDeleteItemRequest={handleRequestDeleteItem}
                        itemPendingDeleteConfirmation={itemToDeleteConfirm}
                        onConfirmDeletion={handleConfirmDeletion}
                        onCancelDeletion={() => setItemToDeleteConfirm(null)}
                        deletePreferenceDialogValue={dialogCheckboxStateSkipConfirm}
                        onDeletePreferenceDialogChange={setDialogCheckboxStateSkipConfirm}
                    />
                </div>
            </div>

            <MobileBottomNav
                currentItem='history'
                onEditClick={() => router.push('/?mode=edit')}
                onGenerateClick={() => router.push('/?mode=generate')}
                onHistoryClick={() => undefined}
            />
        </main>
    );
}
