'use client';

import type { HistoryMetadata } from '@/app/page';
import { ImagePreviewDialog, type PreviewImage } from '@/components/image-preview-dialog';
import { SiteValueComparison } from '@/components/site-value-comparison';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DialogFooter,
    DialogClose
} from '@/components/ui/dialog';
import { formatCny, formatUsdCny, getModelRates, USD_TO_CNY_RATE, type GptImageModel } from '@/lib/cost-utils';
import { formatOptionLabel, useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import {
    Layers,
    DollarSign,
    Pencil,
    Sparkles as SparklesIcon,
    HardDrive,
    Database,
    FileImage,
    Trash2,
    Eye,
    Download
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import * as React from 'react';

type HistoryPanelProps = {
    history: HistoryMetadata[];
    onSelectImage: (item: HistoryMetadata) => void;
    onClearHistory: () => void;
    getImageSrc: (filename: string) => string | undefined;
    onDeleteItemRequest: (item: HistoryMetadata) => void;
    itemPendingDeleteConfirmation: HistoryMetadata | null;
    onConfirmDeletion: () => void;
    onCancelDeletion: () => void;
    deletePreferenceDialogValue: boolean;
    onDeletePreferenceDialogChange: (isChecked: boolean) => void;
};

const formatDuration = (ms: number): string => {
    if (ms < 1000) {
        return `${ms}ms`;
    }
    return `${(ms / 1000).toFixed(1)}s`;
};

const calculateTokenCost = (value: number, rate: number): number => {
    const cost = value * rate;
    return isNaN(cost) ? NaN : cost;
};

function HistoryPanelImpl({
    history,
    onSelectImage,
    onClearHistory,
    getImageSrc,
    onDeleteItemRequest,
    itemPendingDeleteConfirmation,
    onConfirmDeletion,
    onCancelDeletion,
    deletePreferenceDialogValue,
    onDeletePreferenceDialogChange
}: HistoryPanelProps) {
    const { t } = useI18n();
    const [openCostDialogTimestamp, setOpenCostDialogTimestamp] = React.useState<number | null>(null);
    const [isTotalCostDialogOpen, setIsTotalCostDialogOpen] = React.useState(false);
    const [previewImage, setPreviewImage] = React.useState<PreviewImage | null>(null);

    const { totalCost, totalImages } = React.useMemo(() => {
        let cost = 0;
        let images = 0;
        history.forEach((item) => {
            if (item.costDetails) {
                cost += item.costDetails.estimated_cost_usd;
            }
            images += item.images?.length ?? 0;
        });

        return { totalCost: Math.round(cost * 10000) / 10000, totalImages: images };
    }, [history]);

    const averageCost = totalImages > 0 ? totalCost / totalImages : 0;

    return (
        <Card className='flex h-full w-full flex-col overflow-hidden rounded-lg border border-white/10 bg-black'>
            <ImagePreviewDialog
                image={previewImage}
                open={!!previewImage}
                onOpenChange={(open) => {
                    if (!open) setPreviewImage(null);
                }}
            />
            <CardHeader className='flex flex-row items-center justify-between gap-4 border-b border-white/10 px-4 py-3'>
                <div className='flex items-center gap-2'>
                    <CardTitle className='text-lg font-medium text-white'>{t('history.title')}</CardTitle>
                    {totalCost > 0 && (
                        <Dialog open={isTotalCostDialogOpen} onOpenChange={setIsTotalCostDialogOpen}>
                            <DialogTrigger asChild>
                                <button
                                    className='mt-0.5 flex items-center gap-1 rounded-full bg-green-600/80 px-1.5 py-0.5 text-[12px] text-white transition-colors hover:bg-green-500/90'
                                    aria-label={t('history.showTotalCostAria')}>
                                    {t('history.totalCost', { cost: formatUsdCny(totalCost) })}
                                </button>
                            </DialogTrigger>
                            <DialogContent className='border-neutral-700 bg-neutral-900 text-white sm:max-w-[450px]'>
                                <DialogHeader>
                                    <DialogTitle className='text-white'>{t('history.totalCostSummary')}</DialogTitle>
                                    {/* Add sr-only description for accessibility */}
                                    <DialogDescription className='sr-only'>
                                        {t('history.totalCostSummaryDescription')}
                                    </DialogDescription>
                                </DialogHeader>
                                <div className='space-y-1 pt-1 text-xs text-neutral-400'>
                                    <p className='font-medium'>gpt-image-2:</p>
                                    <ul className='list-disc pl-4'>
                                        <li>
                                            {t('history.textInput')}: $5 / {t('history.tokensUnit')}
                                        </li>
                                        <li>
                                            {t('history.imageInput')}: $8 / {t('history.tokensUnit')}
                                        </li>
                                        <li>
                                            {t('history.imageOutput')}: $30 / {t('history.tokensUnit')}
                                        </li>
                                    </ul>
                                    <p className='mt-2 font-medium'>gpt-image-1.5:</p>
                                    <ul className='list-disc pl-4'>
                                        <li>
                                            {t('history.textInput')}: $5 / {t('history.tokensUnit')}
                                        </li>
                                        <li>
                                            {t('history.imageInput')}: $8 / {t('history.tokensUnit')}
                                        </li>
                                        <li>
                                            {t('history.imageOutput')}: $32 / {t('history.tokensUnit')}
                                        </li>
                                    </ul>
                                    <p className='mt-2 font-medium'>gpt-image-1:</p>
                                    <ul className='list-disc pl-4'>
                                        <li>
                                            {t('history.textInput')}: $5 / {t('history.tokensUnit')}
                                        </li>
                                        <li>
                                            {t('history.imageInput')}: $10 / {t('history.tokensUnit')}
                                        </li>
                                        <li>
                                            {t('history.imageOutput')}: $40 / {t('history.tokensUnit')}
                                        </li>
                                    </ul>
                                    <p className='mt-2 font-medium'>gpt-image-1-mini:</p>
                                    <ul className='list-disc pl-4'>
                                        <li>
                                            {t('history.textInput')}: $2 / {t('history.tokensUnit')}
                                        </li>
                                        <li>
                                            {t('history.imageInput')}: $2.50 / {t('history.tokensUnit')}
                                        </li>
                                        <li>
                                            {t('history.imageOutput')}: $8 / {t('history.tokensUnit')}
                                        </li>
                                    </ul>
                                </div>
                                <div className='space-y-2 py-4 text-sm text-neutral-300'>
                                    <div className='flex justify-between'>
                                        <span>{t('history.totalImagesGenerated')}</span>{' '}
                                        <span>{totalImages.toLocaleString()}</span>
                                    </div>
                                    <div className='flex justify-between'>
                                        <span>{t('history.averageCostPerImage')}</span>{' '}
                                        <span>{formatUsdCny(averageCost)}</span>
                                    </div>
                                    <hr className='my-2 border-neutral-700' />
                                    <div className='flex justify-between font-medium text-white'>
                                        <span>{t('history.totalEstimatedCost')}</span>
                                        <span>{formatUsdCny(totalCost)}</span>
                                    </div>
                                    <p className='pt-1 text-xs text-neutral-500'>
                                        {t('history.costCurrencyNote', { rate: USD_TO_CNY_RATE })}
                                    </p>
                                    <SiteValueComparison officialUsdCost={totalCost} imageCount={totalImages} />
                                </div>
                                <DialogFooter>
                                    <DialogClose asChild>
                                        <Button
                                            type='button'
                                            variant='secondary'
                                            size='sm'
                                            className='bg-neutral-700 text-neutral-200 hover:bg-neutral-600'>
                                            {t('common.close')}
                                        </Button>
                                    </DialogClose>
                                </DialogFooter>
                            </DialogContent>
                        </Dialog>
                    )}
                </div>
                {history.length > 0 && (
                    <Button
                        variant='ghost'
                        size='sm'
                        onClick={onClearHistory}
                        className='h-auto rounded-md px-2 py-1 text-white/60 hover:bg-white/10 hover:text-white'>
                        {t('common.clear')}
                    </Button>
                )}
            </CardHeader>
            <CardContent className='flex-grow overflow-y-auto p-4'>
                {history.length === 0 ? (
                    <div className='flex h-full items-center justify-center text-white/40'>
                        <p>{t('history.generatedImagesWillAppear')}</p>
                    </div>
                ) : (
                    <div className='grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5'>
                        {[...history].map((item) => {
                            const firstImage = item.images?.[0];
                            const imageCount = item.images?.length ?? 0;
                            const isMultiImage = imageCount > 1;
                            const itemKey = item.timestamp;
                            const originalStorageMode = item.storageModeUsed || 'fs';
                            const outputFormat = item.output_format || 'png';
                            const generatedDate = new Date(item.timestamp).toLocaleString();
                            const detailHref = `/history/${item.timestamp}`;

                            let thumbnailUrl: string | undefined;
                            if (firstImage) {
                                if (originalStorageMode === 'indexeddb') {
                                    thumbnailUrl = getImageSrc(firstImage.filename);
                                } else {
                                    thumbnailUrl = `/api/image/${firstImage.filename}`;
                                }
                            }

                            return (
                                <div key={itemKey} className='flex flex-col'>
                                    <div className='group relative'>
                                        <button
                                            onClick={() => onSelectImage(item)}
                                            className='relative block aspect-square w-full overflow-hidden rounded-t-md border border-white/20 transition-all duration-150 group-hover:border-white/40 focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-black focus:outline-none'
                                            aria-label={t('history.viewBatchAria', {
                                                date: generatedDate
                                            })}>
                                            {thumbnailUrl ? (
                                                <Image
                                                    src={thumbnailUrl}
                                                    alt={t('history.previewAlt', {
                                                        date: generatedDate
                                                    })}
                                                    width={150}
                                                    height={150}
                                                    className='h-full w-full object-cover'
                                                    unoptimized
                                                />
                                            ) : (
                                                <div className='flex h-full w-full items-center justify-center bg-neutral-800 text-neutral-500'>
                                                    ?
                                                </div>
                                            )}
                                            <div
                                                className={cn(
                                                    'pointer-events-none absolute top-1 left-1 z-10 flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] text-white',
                                                    item.mode === 'edit' ? 'bg-orange-600/80' : 'bg-blue-600/80'
                                                )}>
                                                {item.mode === 'edit' ? (
                                                    <Pencil size={12} />
                                                ) : (
                                                    <SparklesIcon size={12} />
                                                )}
                                                {item.mode === 'edit' ? t('history.modeEdit') : t('history.modeCreate')}
                                            </div>
                                            {isMultiImage && (
                                                <div className='pointer-events-none absolute right-1 bottom-1 z-10 flex items-center gap-1 rounded-full bg-black/70 px-1.5 py-0.5 text-[12px] text-white'>
                                                    <Layers size={16} />
                                                    {imageCount}
                                                </div>
                                            )}
                                            <div className='pointer-events-none absolute bottom-1 left-1 z-10 flex items-center gap-1'>
                                                <div className='flex items-center gap-1 rounded-full border border-white/10 bg-neutral-900/80 px-1 py-0.5 text-[11px] text-white/70'>
                                                    {originalStorageMode === 'fs' ? (
                                                        <HardDrive size={12} className='text-neutral-400' />
                                                    ) : (
                                                        <Database size={12} className='text-blue-400' />
                                                    )}
                                                    <span>
                                                        {originalStorageMode === 'fs'
                                                            ? t('history.storageFile')
                                                            : t('history.storageDb')}
                                                    </span>
                                                </div>
                                                {item.output_format && (
                                                    <div className='flex items-center gap-1 rounded-full border border-white/10 bg-neutral-900/80 px-1 py-0.5 text-[11px] text-white/70'>
                                                        <FileImage size={12} className='text-neutral-400' />
                                                        <span>{outputFormat.toUpperCase()}</span>
                                                    </div>
                                                )}
                                            </div>
                                        </button>
                                        {thumbnailUrl && firstImage && (
                                            <div className='absolute right-1 bottom-8 z-20 flex items-center gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100'>
                                                <Button
                                                    type='button'
                                                    variant='ghost'
                                                    size='icon'
                                                    className='h-7 w-7 rounded-full bg-black/75 text-white/80 hover:bg-black/90 hover:text-white'
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        setPreviewImage({
                                                            src: thumbnailUrl,
                                                            filename: firstImage.filename,
                                                            alt: t('history.previewAlt', { date: generatedDate })
                                                        });
                                                    }}
                                                    aria-label={t('history.viewImageAria', {
                                                        filename: firstImage.filename
                                                    })}>
                                                    <Eye className='h-4 w-4' />
                                                </Button>
                                                <Button
                                                    asChild
                                                    variant='ghost'
                                                    size='icon'
                                                    className='h-7 w-7 rounded-full bg-black/75 text-white/80 hover:bg-black/90 hover:text-white'>
                                                    <a
                                                        href={thumbnailUrl}
                                                        download={firstImage.filename}
                                                        onClick={(event) => event.stopPropagation()}
                                                        aria-label={t('history.downloadImageAria', {
                                                            filename: firstImage.filename
                                                        })}>
                                                        <Download className='h-4 w-4' />
                                                    </a>
                                                </Button>
                                            </div>
                                        )}
                                        {item.costDetails && (
                                            <Dialog
                                                open={openCostDialogTimestamp === itemKey}
                                                onOpenChange={(isOpen) => !isOpen && setOpenCostDialogTimestamp(null)}>
                                                <DialogTrigger asChild>
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setOpenCostDialogTimestamp(itemKey);
                                                        }}
                                                        className='absolute top-1 right-1 z-20 flex items-center gap-1 rounded-full bg-green-600/80 px-1.5 py-0.5 text-[10px] leading-tight text-white transition-colors hover:bg-green-500/90'
                                                        aria-label={t('history.showCostBreakdownAria')}>
                                                        <DollarSign size={12} />
                                                        <span className='flex flex-col items-start'>
                                                            <span>
                                                                ${item.costDetails.estimated_cost_usd.toFixed(4)}
                                                            </span>
                                                            <span>
                                                                {formatCny(item.costDetails.estimated_cost_usd)}
                                                            </span>
                                                        </span>
                                                    </button>
                                                </DialogTrigger>
                                                <DialogContent className='border-neutral-700 bg-neutral-900 text-white sm:max-w-[450px]'>
                                                    <DialogHeader>
                                                        <DialogTitle className='text-white'>
                                                            {t('history.costBreakdown')}
                                                        </DialogTitle>
                                                        <DialogDescription className='sr-only'>
                                                            {t('history.costBreakdownDescription')}
                                                        </DialogDescription>
                                                    </DialogHeader>
                                                    {(() => {
                                                        const modelForRates: GptImageModel = (item.model ||
                                                            'gpt-image-1') as GptImageModel;
                                                        const rates = getModelRates(modelForRates);
                                                        return (
                                                            <>
                                                                <div className='space-y-1 pt-1 text-xs text-neutral-400'>
                                                                    <p>
                                                                        {t('history.pricingFor', {
                                                                            model: modelForRates
                                                                        })}
                                                                    </p>
                                                                    <ul className='list-disc pl-4'>
                                                                        <li>
                                                                            {t('history.textInput')}: $
                                                                            {rates.textInputPerMillion} /{' '}
                                                                            {t('history.tokensUnit')}
                                                                        </li>
                                                                        <li>
                                                                            {t('history.imageInput')}: $
                                                                            {rates.imageInputPerMillion} /{' '}
                                                                            {t('history.tokensUnit')}
                                                                        </li>
                                                                        <li>
                                                                            {t('history.imageOutput')}: $
                                                                            {rates.imageOutputPerMillion} /{' '}
                                                                            {t('history.tokensUnit')}
                                                                        </li>
                                                                    </ul>
                                                                </div>
                                                                <div className='space-y-2 py-4 text-sm text-neutral-300'>
                                                                    <div className='flex justify-between'>
                                                                        <span>{t('history.textInputTokens')}</span>{' '}
                                                                        <span>
                                                                            {item.costDetails.text_input_tokens.toLocaleString()}{' '}
                                                                            (~
                                                                            {formatUsdCny(
                                                                                calculateTokenCost(
                                                                                    item.costDetails.text_input_tokens,
                                                                                    rates.textInputPerToken
                                                                                )
                                                                            )}
                                                                            )
                                                                        </span>
                                                                    </div>
                                                                    {item.costDetails.image_input_tokens > 0 && (
                                                                        <div className='flex justify-between'>
                                                                            <span>{t('history.imageInputTokens')}</span>{' '}
                                                                            <span>
                                                                                {item.costDetails.image_input_tokens.toLocaleString()}{' '}
                                                                                (~
                                                                                {formatUsdCny(
                                                                                    calculateTokenCost(
                                                                                        item.costDetails
                                                                                            .image_input_tokens,
                                                                                        rates.imageInputPerToken
                                                                                    )
                                                                                )}
                                                                                )
                                                                            </span>
                                                                        </div>
                                                                    )}
                                                                    <div className='flex justify-between'>
                                                                        <span>{t('history.imageOutputTokens')}</span>{' '}
                                                                        <span>
                                                                            {item.costDetails.image_output_tokens.toLocaleString()}{' '}
                                                                            (~
                                                                            {formatUsdCny(
                                                                                calculateTokenCost(
                                                                                    item.costDetails
                                                                                        .image_output_tokens,
                                                                                    rates.imageOutputPerToken
                                                                                )
                                                                            )}
                                                                            )
                                                                        </span>
                                                                    </div>
                                                                    <div className='flex justify-between'>
                                                                        <span>{t('history.averageCostPerImage')}</span>
                                                                        <span>
                                                                            {formatUsdCny(
                                                                                item.costDetails.estimated_cost_usd /
                                                                                    Math.max(1, item.images.length)
                                                                            )}
                                                                        </span>
                                                                    </div>
                                                                    <hr className='my-2 border-neutral-700' />
                                                                    <div className='flex justify-between font-medium text-white'>
                                                                        <span>{t('history.totalEstimatedCost')}</span>
                                                                        <span>
                                                                            {formatUsdCny(
                                                                                item.costDetails.estimated_cost_usd
                                                                            )}
                                                                        </span>
                                                                    </div>
                                                                    <p className='pt-1 text-xs text-neutral-500'>
                                                                        {t('history.costCurrencyNote', {
                                                                            rate: USD_TO_CNY_RATE
                                                                        })}
                                                                    </p>
                                                                    <SiteValueComparison
                                                                        officialUsdCost={
                                                                            item.costDetails.estimated_cost_usd
                                                                        }
                                                                        imageCount={item.images.length}
                                                                    />
                                                                </div>
                                                            </>
                                                        );
                                                    })()}
                                                    <DialogFooter>
                                                        <DialogClose asChild>
                                                            <Button
                                                                type='button'
                                                                variant='secondary'
                                                                size='sm'
                                                                className='bg-neutral-700 text-neutral-200 hover:bg-neutral-600'>
                                                                {t('common.close')}
                                                            </Button>
                                                        </DialogClose>
                                                    </DialogFooter>
                                                </DialogContent>
                                            </Dialog>
                                        )}
                                    </div>

                                    <div className='space-y-1 rounded-b-md border border-t-0 border-neutral-700 bg-black p-2 text-xs text-white/60'>
                                        <p
                                            title={t('history.generatedOn', {
                                                date: generatedDate
                                            })}>
                                            <span className='font-medium text-white/80'>{t('history.time')}</span>{' '}
                                            {formatDuration(item.durationMs)}
                                        </p>
                                        <p>
                                            <span className='font-medium text-white/80'>{t('history.model')}</span>{' '}
                                            {item.model || 'gpt-image-1'}
                                        </p>
                                        <p>
                                            <span className='font-medium text-white/80'>{t('history.quality')}</span>{' '}
                                            {formatOptionLabel(item.quality, t)}
                                        </p>
                                        <p>
                                            <span className='font-medium text-white/80'>{t('history.bg')}</span>{' '}
                                            {formatOptionLabel(item.background, t)}
                                        </p>
                                        <p>
                                            <span className='font-medium text-white/80'>{t('history.mod')}</span>{' '}
                                            {formatOptionLabel(item.moderation, t)}
                                        </p>
                                        <div className='mt-2 flex items-center gap-1'>
                                            <Button
                                                asChild
                                                variant='outline'
                                                size='sm'
                                                className='h-6 flex-grow border-white/20 px-2 py-1 text-xs text-white/70 hover:bg-white/10 hover:text-white'>
                                                <Link href={detailHref}>{t('history.showDetails')}</Link>
                                            </Button>
                                            <Dialog
                                                open={itemPendingDeleteConfirmation?.timestamp === item.timestamp}
                                                onOpenChange={(isOpen) => {
                                                    if (!isOpen) onCancelDeletion();
                                                }}>
                                                <DialogTrigger asChild>
                                                    <Button
                                                        className='h-6 w-6 bg-red-700/60 text-white hover:bg-red-600/60'
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            onDeleteItemRequest(item);
                                                        }}
                                                        aria-label={t('history.deleteHistoryItemAria')}>
                                                        <Trash2 size={14} />
                                                    </Button>
                                                </DialogTrigger>
                                                <DialogContent className='border-neutral-700 bg-neutral-900 text-white sm:max-w-md'>
                                                    <DialogHeader>
                                                        <DialogTitle className='text-white'>
                                                            {t('history.confirmDeletion')}
                                                        </DialogTitle>
                                                        <DialogDescription className='pt-2 text-neutral-300'>
                                                            {t('history.confirmDeleteDescription', {
                                                                count: item.images.length
                                                            })}
                                                        </DialogDescription>
                                                    </DialogHeader>
                                                    <div className='flex items-center space-x-2 py-2'>
                                                        <Checkbox
                                                            id={`dont-ask-${item.timestamp}`}
                                                            checked={deletePreferenceDialogValue}
                                                            onCheckedChange={(checked) =>
                                                                onDeletePreferenceDialogChange(!!checked)
                                                            }
                                                            className='border-neutral-400 bg-white data-[state=checked]:border-neutral-700 data-[state=checked]:bg-white data-[state=checked]:text-black dark:border-neutral-500 dark:!bg-white'
                                                        />
                                                        <label
                                                            htmlFor={`dont-ask-${item.timestamp}`}
                                                            className='text-sm leading-none font-medium text-neutral-300 peer-disabled:cursor-not-allowed peer-disabled:opacity-70'>
                                                            {t('history.dontAskAgain')}
                                                        </label>
                                                    </div>
                                                    <DialogFooter className='gap-2 sm:justify-end'>
                                                        <Button
                                                            type='button'
                                                            variant='outline'
                                                            size='sm'
                                                            onClick={onCancelDeletion}
                                                            className='border-neutral-600 text-neutral-300 hover:bg-neutral-700 hover:text-white'>
                                                            {t('common.cancel')}
                                                        </Button>
                                                        <Button
                                                            type='button'
                                                            variant='destructive'
                                                            size='sm'
                                                            onClick={onConfirmDeletion}
                                                            className='bg-red-600 text-white hover:bg-red-500'>
                                                            {t('common.delete')}
                                                        </Button>
                                                    </DialogFooter>
                                                </DialogContent>
                                            </Dialog>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

export const HistoryPanel = React.memo(HistoryPanelImpl);
