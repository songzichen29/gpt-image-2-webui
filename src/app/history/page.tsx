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

const effectiveStorageModeClient: 'fs' | 'indexeddb' =
    explicitModeClient === 'fs'
        ? 'fs'
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
            router.push(`/history/${item.timestamp}?image=${imageIndex}`);
        },
        [router]
    );

    const handleClearHistory = React.useCallback(async () => {
        const confirmationMessage =
            effectiveStorageModeClient === 'indexeddb'
                ? t('history.clearConfirmIndexedDb')
                : t('history.clearConfirmFs');

        if (!window.confirm(confirmationMessage)) return;

        setHistory([]);
        setError(null);

        try {
            clearStoredHistory();
            if (activeImageUserId !== undefined) {
                await db.images.where('userId').equals(activeImageUserId).delete();
            }
            blobUrlCacheRef.current.forEach((url) => URL.revokeObjectURL(url));
            blobUrlCacheRef.current.clear();
            setImageSrcByFilename({});
        } catch (e) {
            console.error('Failed during history clearing:', e);
            setError(t('page.clearHistoryError', { message: e instanceof Error ? e.message : String(e) }));
        }
    }, [activeImageUserId, clearStoredHistory, setHistory, t]);

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

                if (storageMode === 'fs') {
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
                        history={history}
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

