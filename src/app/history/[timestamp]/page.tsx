'use client';

import type { HistoryMetadata } from '@/app/page';
import { SiteValueComparison } from '@/components/site-value-comparison';
import { Button } from '@/components/ui/button';
import { useHomeAuth } from '@/hooks/use-home-auth';
import { getHistoryStorageKey } from '@/hooks/use-home-history';
import { formatUsdCny, getModelRates, USD_TO_CNY_RATE, type GptImageModel } from '@/lib/cost-utils';
import { db, LEGACY_IMAGE_USER_ID, type ImageRecord } from '@/lib/db';
import { formatOptionLabel, useI18n } from '@/lib/i18n';
import { getServerImageExpiryStatus } from '@/lib/image-retention';
import { buildApiImageUrl } from '@/lib/image-url';
import { cn } from '@/lib/utils';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, Check, Clock, Copy, Database, Download, FileImage, HardDrive } from 'lucide-react';
import Image from 'next/image';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';

const formatDuration = (ms: number): string => {
    if (ms < 1000) {
        return `${ms}ms`;
    }
    return `${(ms / 1000).toFixed(1)}s`;
};

const tokenCost = (tokens: number, rate: number): number => tokens * rate;

export default function HistoryDetailPage() {
    const router = useRouter();
    const params = useParams<{ timestamp: string }>();
    const searchParams = useSearchParams();
    const { language, t } = useI18n();
    const { authMode, clientPasswordHash, image2User, isAuthReady, isPasswordRequiredByBackend } = useHomeAuth();
    const scopedHistoryUserId = authMode === 'sub2api' ? (image2User?.id ?? null) : undefined;
    const activeImageUserId = authMode === 'sub2api' ? image2User?.id : LEGACY_IMAGE_USER_ID;
    const [item, setItem] = React.useState<HistoryMetadata | null | undefined>(undefined);
    const [selectedImageIndex, setSelectedImageIndex] = React.useState(0);
    const [copiedPrompt, setCopiedPrompt] = React.useState(false);
    const [imageSrcByFilename, setImageSrcByFilename] = React.useState<Record<string, string>>({});
    const [now, setNow] = React.useState(() => Date.now());
    const blobUrlCacheRef = React.useRef<Map<string, string>>(new Map());

    const allDbImages = useLiveQuery<ImageRecord[] | undefined>(
        () =>
            activeImageUserId === undefined
                ? Promise.resolve([])
                : db.images.where('userId').equals(activeImageUserId).toArray(),
        [activeImageUserId]
    );

    React.useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 60_000);
        return () => window.clearInterval(timer);
    }, []);

    React.useEffect(() => {
        const timestamp = Number(params.timestamp);
        if (!Number.isFinite(timestamp)) {
            setItem(null);
            return;
        }

        let cancelled = false;
        let localMatch: HistoryMetadata | null = null;

        try {
            const storageKey = getHistoryStorageKey(scopedHistoryUserId);
            const storedHistory = storageKey ? localStorage.getItem(storageKey) : null;
            const parsedHistory: HistoryMetadata[] = storedHistory ? JSON.parse(storedHistory) : [];
            localMatch = Array.isArray(parsedHistory)
                ? (parsedHistory.find((historyItem) => historyItem.timestamp === timestamp) ?? null)
                : null;
            if (localMatch && (localMatch.images.length > 0 || localMatch.status !== 'pending')) {
                setItem(localMatch);
                return;
            }
        } catch (error) {
            console.error('Failed to read history detail:', error);
        }

        if (authMode === 'sub2api' && !isAuthReady) {
            return;
        }

        if (authMode !== 'sub2api' && isPasswordRequiredByBackend && !clientPasswordHash) {
            setItem(null);
            return;
        }

        const loadServerHistoryItem = async () => {
            try {
                const query = new URLSearchParams();
                if (authMode !== 'sub2api' && isPasswordRequiredByBackend && clientPasswordHash) {
                    query.set('passwordHash', clientPasswordHash);
                }
                query.set('since', timestamp.toString());
                query.set('page_size', '1000');

                const response = await fetch(`/api/image-history${query.size ? `?${query.toString()}` : ''}`, {
                    cache: 'no-store'
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
                const match = serverHistory.find((historyItem) => historyItem.timestamp === timestamp) ?? null;

                if (!cancelled) {
                    setItem(
                        match && localMatch
                            ? {
                                  ...localMatch,
                                  images: match.images,
                                  status: 'completed',
                                  durationMs: localMatch.durationMs || match.durationMs,
                                  output_format: localMatch.output_format || match.output_format,
                                  storageModeUsed: 'minio'
                              }
                            : (match ?? localMatch ?? null)
                    );
                }
            } catch (error) {
                console.error('Failed to read server history detail:', error);
                if (!cancelled) {
                    setItem(null);
                }
            }
        };

        loadServerHistoryItem();

        return () => {
            cancelled = true;
        };
    }, [authMode, clientPasswordHash, isAuthReady, isPasswordRequiredByBackend, params.timestamp, scopedHistoryUserId]);

    React.useEffect(() => {
        const imageIndex = Number(searchParams.get('image') ?? 0);
        setSelectedImageIndex(Number.isFinite(imageIndex) && imageIndex >= 0 ? imageIndex : 0);
    }, [item?.timestamp, searchParams]);

    React.useEffect(() => {
        const cache = blobUrlCacheRef.current;
        return () => {
            cache.forEach((url) => URL.revokeObjectURL(url));
            cache.clear();
        };
    }, []);

    React.useEffect(() => {
        blobUrlCacheRef.current.forEach((url) => URL.revokeObjectURL(url));
        blobUrlCacheRef.current.clear();

        if (!item || allDbImages === undefined) {
            setImageSrcByFilename({});
            return;
        }

        const storageMode = item.storageModeUsed || 'fs';
        const nextSrcByFilename: Record<string, string> = {};

        item.images.forEach((imageInfo) => {
            const record = allDbImages.find((img) => img.filename === imageInfo.filename);
            if (record?.blob) {
                const url = URL.createObjectURL(record.blob);
                blobUrlCacheRef.current.set(imageInfo.filename, url);
                nextSrcByFilename[imageInfo.filename] = url;
                return;
            }

            if (storageMode === 'fs' || storageMode === 'minio') {
                nextSrcByFilename[imageInfo.filename] = buildApiImageUrl(imageInfo.filename, item.timestamp);
            }
        });

        setImageSrcByFilename(nextSrcByFilename);
    }, [allDbImages, item]);

    const handleBack = () => {
        router.push('/history');
    };

    const handleCopyPrompt = async () => {
        if (!item?.prompt) return;

        try {
            await navigator.clipboard.writeText(item.prompt);
            setCopiedPrompt(true);
            window.setTimeout(() => setCopiedPrompt(false), 1500);
        } catch (error) {
            console.error('Failed to copy prompt:', error);
        }
    };

    if (authMode === 'sub2api' && !isAuthReady) {
        return (
            <main className='flex h-screen items-center justify-center overflow-hidden bg-black p-4 text-white'>
                <p className='text-white/60'>{t('history.loading')}</p>
            </main>
        );
    }

    if (item === undefined) {
        return (
            <main className='flex h-screen items-center justify-center overflow-hidden bg-black p-4 text-white'>
                <p className='text-white/60'>{t('history.loading')}</p>
            </main>
        );
    }

    if (!item) {
        return (
            <main className='h-screen overflow-hidden bg-black p-4 text-white md:p-6'>
                <div className='mx-auto flex h-full max-w-4xl flex-col gap-4'>
                    <Button
                        type='button'
                        variant='ghost'
                        onClick={handleBack}
                        className='-ml-3 w-fit text-white/70 hover:bg-white/10 hover:text-white'>
                        <ArrowLeft className='h-4 w-4' />
                        {t('settings.back')}
                    </Button>
                    <div className='flex flex-1 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-white/70'>
                        {t('history.notFound')}
                    </div>
                </div>
            </main>
        );
    }

    const storageMode = item.storageModeUsed || 'fs';
    const isServerStorage = storageMode === 'fs' || storageMode === 'minio';
    const model = (item.model || 'gpt-image-1') as GptImageModel;
    const rates = getModelRates(model);
    const imageCount = item.images?.length ?? 0;
    const generatedAt = new Date(item.timestamp).toLocaleString();
    const expiryStatus = getServerImageExpiryStatus(item.timestamp, now, language);
    const expiresAtText = expiryStatus.expiresAt.toLocaleString();
    const images = item.images.map((imageInfo, index) => ({
        ...imageInfo,
        index,
        src: imageSrcByFilename[imageInfo.filename]
    }));
    const selectedImage = images[selectedImageIndex] ?? images[0];

    const detailRows: Array<[string, React.ReactNode]> = [
        [t('history.createdAt'), generatedAt],
        [t('history.duration'), formatDuration(item.durationMs)],
        [t('common.size'), item.size || '-'],
        [t('history.quality'), formatOptionLabel(item.quality, t)],
        [t('history.bg'), formatOptionLabel(item.background, t)],
        [t('history.mod'), formatOptionLabel(item.moderation, t)],
        [t('common.outputFormat'), (item.output_format || 'png').toUpperCase()],
        [t('history.outputCompression'), item.output_compression === undefined ? '-' : `${item.output_compression}%`],
        [t('history.storageMode'), isServerStorage ? t('history.storageFile') : t('history.storageDb')],
        [t('history.serverExpiryAt'), expiresAtText],
        [t('history.imageCount'), imageCount.toLocaleString()],
        [t('history.sourceImages'), item.sourceImageCount?.toLocaleString() ?? '-'],
        [t('history.mask'), item.hasMask === undefined ? '-' : item.hasMask ? t('common.yes') : t('common.no')]
    ];

    return (
        <main className='h-screen overflow-hidden bg-black p-3 text-white md:p-4'>
            <div className='mx-auto flex h-full w-full max-w-[1800px] flex-col gap-3'>
                <header className='flex shrink-0 items-center justify-between gap-4 border-b border-white/10 pb-3'>
                    <div className='flex min-w-0 items-center gap-3'>
                        <Button
                            type='button'
                            variant='ghost'
                            size='sm'
                            onClick={handleBack}
                            className='text-white/70 hover:bg-white/10 hover:text-white'>
                            <ArrowLeft className='h-4 w-4' />
                            {t('settings.back')}
                        </Button>
                        <div className='min-w-0'>
                            <h1 className='truncate text-lg font-semibold text-white'>{t('history.detailTitle')}</h1>
                            <p className='truncate text-xs text-white/50'>{generatedAt}</p>
                        </div>
                    </div>
                    <div className='flex shrink-0 items-center gap-2'>
                        <div
                            className={cn(
                                'hidden items-center gap-1 rounded-full px-2 py-1 text-xs text-white sm:flex',
                                item.mode === 'edit' ? 'bg-orange-600/70' : 'bg-blue-600/70'
                            )}>
                            {item.mode === 'edit' ? t('history.modeEdit') : t('history.modeCreate')}
                        </div>
                        {selectedImage?.src && (
                            <Button
                                asChild
                                type='button'
                                variant='outline'
                                size='sm'
                                className='border-white/20 text-white/80 hover:bg-white/10 hover:text-white'>
                                <a href={selectedImage.src} download={selectedImage.filename}>
                                    <Download className='h-4 w-4' />
                                    {t('common.download')}
                                </a>
                            </Button>
                        )}
                    </div>
                </header>

                <section className='grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-3 lg:grid-cols-[minmax(0,1fr)_420px] lg:grid-rows-none 2xl:grid-cols-[minmax(0,1fr)_460px]'>
                    <div className='flex min-h-0 flex-col rounded-lg border border-white/10 bg-black p-3'>
                        <div className='flex shrink-0 items-center justify-between gap-3 pb-3'>
                            <div className='min-w-0'>
                                <h2 className='text-sm font-medium text-white'>{t('history.images')}</h2>
                                <p className='truncate text-xs text-white/45'>{selectedImage?.filename}</p>
                            </div>
                            <div className='flex items-center gap-1 text-xs text-white/50'>
                                <FileImage className='h-4 w-4' />
                                {selectedImage ? selectedImage.index + 1 : 0}/{imageCount}
                            </div>
                        </div>

                        <div className='relative min-h-0 flex-1 overflow-hidden rounded-md bg-neutral-950'>
                            {selectedImage?.src ? (
                                <>
                                    <div className='relative h-full w-full'>
                                        <Image
                                            src={selectedImage.src}
                                            alt={t('output.generatedGridAlt', { index: selectedImage.index + 1 })}
                                            fill
                                            className='object-contain'
                                            sizes='(max-width: 1024px) 100vw, calc(100vw - 460px)'
                                            priority
                                            unoptimized
                                        />
                                    </div>
                                    <div className='absolute right-3 bottom-3 flex items-center gap-2'>
                                        <Button
                                            asChild
                                            variant='ghost'
                                            size='icon'
                                            className='h-9 w-9 rounded-full bg-black/75 text-white/80 hover:bg-black/90 hover:text-white'>
                                            <a
                                                href={selectedImage.src}
                                                download={selectedImage.filename}
                                                aria-label={t('history.downloadImageAria', {
                                                    filename: selectedImage.filename
                                                })}>
                                                <Download className='h-4 w-4' />
                                            </a>
                                        </Button>
                                    </div>
                                </>
                            ) : (
                                <div className='flex h-full w-full items-center justify-center text-neutral-500'>
                                    <FileImage className='h-10 w-10' />
                                </div>
                            )}
                        </div>

                        {images.length > 1 && (
                            <div className='mt-3 flex h-[80px] shrink-0 gap-2 overflow-x-auto pb-1'>
                                {images.map((imageInfo) => (
                                    <button
                                        key={imageInfo.filename}
                                        type='button'
                                        onClick={() => setSelectedImageIndex(imageInfo.index)}
                                        className={cn(
                                            'relative h-[72px] w-[72px] shrink-0 overflow-hidden rounded-md border bg-neutral-900 transition',
                                            selectedImage?.filename === imageInfo.filename
                                                ? 'border-white ring-2 ring-white/50'
                                                : 'border-white/10 opacity-70 hover:border-white/30 hover:opacity-100'
                                        )}
                                        aria-label={t('output.selectImageAria', { index: imageInfo.index + 1 })}>
                                        {imageInfo.src ? (
                                            <Image
                                                src={imageInfo.src}
                                                alt={t('output.thumbnailAlt', { index: imageInfo.index + 1 })}
                                                fill
                                                className='object-cover'
                                                sizes='72px'
                                                unoptimized
                                            />
                                        ) : (
                                            <FileImage className='m-auto h-5 w-5 text-neutral-500' />
                                        )}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    <aside className='flex min-h-0 flex-col overflow-hidden rounded-lg border border-white/10 bg-black'>
                        <div className='min-h-0 flex-1 space-y-3 overflow-y-auto p-3'>
                            <section className='rounded-md border border-white/10 bg-white/[0.03] p-3'>
                                <div className='mb-2 flex items-center justify-between gap-3'>
                                    <h2 className='text-sm font-medium text-white'>{t('history.promptTitle')}</h2>
                                    <Button
                                        type='button'
                                        variant='outline'
                                        size='sm'
                                        onClick={handleCopyPrompt}
                                        disabled={!item.prompt}
                                        className='h-7 border-white/20 px-2 text-xs text-white/80 hover:bg-white/10 hover:text-white'>
                                        {copiedPrompt ? (
                                            <Check className='h-3.5 w-3.5 text-green-400' />
                                        ) : (
                                            <Copy className='h-3.5 w-3.5' />
                                        )}
                                        {copiedPrompt ? t('common.copied') : t('common.copy')}
                                    </Button>
                                </div>
                                <div className='max-h-44 overflow-y-auto rounded border border-white/5 bg-black/25 p-2 text-xs whitespace-pre-wrap text-white/75'>
                                    {item.prompt || t('history.noPrompt')}
                                </div>
                            </section>

                            <section
                                className={cn(
                                    'rounded-md border p-3',
                                    expiryStatus.isExpired
                                        ? 'border-red-400/25 bg-red-500/10'
                                        : 'border-amber-300/25 bg-amber-300/10'
                                )}>
                                <div className='mb-2 flex items-center gap-2'>
                                    <Clock
                                        className={cn(
                                            'h-4 w-4',
                                            expiryStatus.isExpired ? 'text-red-200' : 'text-amber-100'
                                        )}
                                    />
                                    <h2 className='text-sm font-medium text-white'>
                                        {t('history.serverExpiryNoticeTitle')}
                                    </h2>
                                </div>
                                <p className='text-xs font-medium text-white/85'>
                                    {expiryStatus.isExpired
                                        ? t('history.serverExpiryExpiredDetail', { date: expiresAtText })
                                        : t('history.serverExpiryCountdown', {
                                              time: expiryStatus.remainingText,
                                              date: expiresAtText
                                          })}
                                </p>
                                <p className='mt-2 text-xs leading-relaxed text-white/60'>
                                    {t('history.serverExpiryNotice')}
                                </p>
                            </section>

                            <section className='rounded-md border border-white/10 bg-white/[0.03] p-3'>
                                <div className='mb-2 flex items-center justify-between gap-3'>
                                    <h2 className='text-sm font-medium text-white'>{t('history.requestSettings')}</h2>
                                    <div className='flex items-center gap-1 text-xs text-white/45'>
                                        {isServerStorage ? (
                                            <HardDrive className='h-4 w-4 text-neutral-400' />
                                        ) : (
                                            <Database className='h-4 w-4 text-blue-400' />
                                        )}
                                        {isServerStorage ? t('history.storageFile') : t('history.storageDb')}
                                    </div>
                                </div>
                                <dl className='grid grid-cols-2 gap-2 text-xs xl:grid-cols-3'>
                                    {detailRows.map(([label, value]) => (
                                        <div
                                            key={label}
                                            className='min-w-0 rounded border border-white/5 bg-black/25 p-2'>
                                            <dt className='truncate text-white/40'>{label}</dt>
                                            <dd className='mt-1 truncate font-medium text-white/85'>{value}</dd>
                                        </div>
                                    ))}
                                </dl>
                            </section>

                            <section className='rounded-md border border-white/10 bg-white/[0.03] p-3'>
                                <h2 className='mb-2 text-sm font-medium text-white'>{t('history.costBreakdown')}</h2>
                                {item.costDetails ? (
                                    <div className='space-y-2 text-xs text-white/70'>
                                        <div className='grid grid-cols-2 gap-2'>
                                            <div className='rounded border border-white/5 bg-black/25 p-2'>
                                                <p className='text-white/40'>{t('history.textInputTokens')}</p>
                                                <p className='mt-1 font-medium text-white'>
                                                    {item.costDetails.text_input_tokens.toLocaleString()}
                                                </p>
                                                <p className='mt-0.5 text-white/50'>
                                                    {formatUsdCny(
                                                        tokenCost(
                                                            item.costDetails.text_input_tokens,
                                                            rates.textInputPerToken
                                                        )
                                                    )}
                                                </p>
                                            </div>
                                            <div className='rounded border border-white/5 bg-black/25 p-2'>
                                                <p className='text-white/40'>{t('history.imageOutputTokens')}</p>
                                                <p className='mt-1 font-medium text-white'>
                                                    {item.costDetails.image_output_tokens.toLocaleString()}
                                                </p>
                                                <p className='mt-0.5 text-white/50'>
                                                    {formatUsdCny(
                                                        tokenCost(
                                                            item.costDetails.image_output_tokens,
                                                            rates.imageOutputPerToken
                                                        )
                                                    )}
                                                </p>
                                            </div>
                                            {item.costDetails.image_input_tokens > 0 && (
                                                <div className='rounded border border-white/5 bg-black/25 p-2'>
                                                    <p className='text-white/40'>{t('history.imageInputTokens')}</p>
                                                    <p className='mt-1 font-medium text-white'>
                                                        {item.costDetails.image_input_tokens.toLocaleString()}
                                                    </p>
                                                    <p className='mt-0.5 text-white/50'>
                                                        {formatUsdCny(
                                                            tokenCost(
                                                                item.costDetails.image_input_tokens,
                                                                rates.imageInputPerToken
                                                            )
                                                        )}
                                                    </p>
                                                </div>
                                            )}
                                            <div className='rounded border border-white/5 bg-black/25 p-2'>
                                                <p className='text-white/40'>{t('history.averageCostPerImage')}</p>
                                                <p className='mt-1 font-medium text-white'>
                                                    {formatUsdCny(
                                                        item.costDetails.estimated_cost_usd / Math.max(1, imageCount)
                                                    )}
                                                </p>
                                            </div>
                                        </div>
                                        <div className='flex justify-between gap-4 border-t border-white/10 pt-2 font-medium text-white'>
                                            <span>{t('history.totalEstimatedCost')}</span>
                                            <span>{formatUsdCny(item.costDetails.estimated_cost_usd)}</span>
                                        </div>
                                        <p className='text-[11px] text-white/40'>
                                            {t('history.costCurrencyNote', { rate: USD_TO_CNY_RATE })}
                                        </p>
                                        <SiteValueComparison
                                            officialUsdCost={item.costDetails.estimated_cost_usd}
                                            imageCount={imageCount}
                                        />
                                    </div>
                                ) : (
                                    <p className='text-xs text-white/50'>{t('history.noCostDetails')}</p>
                                )}
                            </section>
                        </div>
                    </aside>
                </section>
            </div>
        </main>
    );
}
