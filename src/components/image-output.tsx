'use client';

import { ImagePreviewDialog, type PreviewImage } from '@/components/image-preview-dialog';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { ChevronLeft, ChevronRight, Download, Grid, Loader2, Send } from 'lucide-react';
import Image from 'next/image';
import * as React from 'react';

type ImageInfo = {
    path: string;
    filename: string;
};

type ImageOutputProps = {
    imageBatch: ImageInfo[] | null;
    promptText?: string;
    viewMode: 'grid' | number;
    onViewChange: (view: 'grid' | number) => void;
    altText?: string;
    isLoading: boolean;
    elapsedSeconds: number;
    onSendToEdit: (filename: string) => void;
    currentMode: 'generate' | 'edit';
    baseImagePreviewUrl: string | null;
};

const getGridColsClass = (count: number): string => {
    if (count <= 1) return 'grid-cols-1';
    if (count <= 4) return 'grid-cols-2';
    if (count <= 9) return 'grid-cols-3';
    return 'grid-cols-3';
};

const formatElapsedTime = (elapsedSeconds: number): string => {
    const minutes = Math.floor(elapsedSeconds / 60);
    const seconds = elapsedSeconds % 60;

    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

export function ImageOutput({
    imageBatch,
    promptText,
    viewMode,
    onViewChange,
    altText = 'Generated image output',
    isLoading,
    elapsedSeconds,
    onSendToEdit,
    currentMode,
    baseImagePreviewUrl
}: ImageOutputProps) {
    const { t } = useI18n();
    const [previewImage, setPreviewImage] = React.useState<PreviewImage | null>(null);
    const [previewIndex, setPreviewIndex] = React.useState<number | null>(null);
    const elapsedLabel = t('output.elapsed', { time: formatElapsedTime(elapsedSeconds) });
    const selectedImage = typeof viewMode === 'number' && imageBatch ? imageBatch[viewMode] : null;
    const activePrompt = promptText?.trim();

    const handleSendClick = () => {
        // Send to edit only works when a single image is selected
        if (typeof viewMode === 'number' && imageBatch && imageBatch[viewMode]) {
            onSendToEdit(imageBatch[viewMode].filename);
        }
    };

    const openPreview = (img: ImageInfo, index?: number) => {
        if (typeof index === 'number') {
            setPreviewIndex(index);
        } else if (imageBatch) {
            const resolvedIndex = imageBatch.findIndex((item) => item.filename === img.filename);
            setPreviewIndex(resolvedIndex >= 0 ? resolvedIndex : 0);
        } else {
            setPreviewIndex(0);
        }

        setPreviewImage({
            src: img.path,
            filename: img.filename,
            alt:
                index === undefined
                    ? altText
                    : t('output.generatedGridAlt', {
                          index: index + 1
                      })
        });
    };

    const syncPreviewImage = React.useCallback(
        (index: number) => {
            if (!imageBatch?.length) return;
            const normalizedIndex = (index + imageBatch.length) % imageBatch.length;
            const nextImage = imageBatch[normalizedIndex];
            setPreviewIndex(normalizedIndex);
            setPreviewImage({
                src: nextImage.path,
                filename: nextImage.filename,
                alt: t('output.generatedGridAlt', { index: normalizedIndex + 1 })
            });
        },
        [imageBatch, t]
    );

    const showCarousel = imageBatch && imageBatch.length > 1;
    const isSingleImageView = typeof viewMode === 'number';
    const canSendToEdit = !isLoading && isSingleImageView && imageBatch && imageBatch[viewMode];
    const singleActionClass = showCarousel && viewMode === 'grid' ? 'invisible' : 'visible';
    const selectedIndex = typeof viewMode === 'number' ? viewMode : 0;

    const goToPreviousImage = () => {
        if (!imageBatch?.length) return;
        onViewChange((selectedIndex - 1 + imageBatch.length) % imageBatch.length);
    };

    const goToNextImage = () => {
        if (!imageBatch?.length) return;
        onViewChange((selectedIndex + 1) % imageBatch.length);
    };

    return (
        <div className='flex h-full min-h-0 w-full flex-col items-center justify-between gap-2 overflow-hidden border border-slate-200 bg-[#fbfbfc] p-3 lg:min-h-[300px] lg:gap-3 lg:p-4 dark:border-white/10 dark:bg-[#0f1115]'>
            <ImagePreviewDialog
                image={previewImage}
                open={!!previewImage}
                currentIndex={previewIndex ?? undefined}
                totalCount={imageBatch?.length}
                onPrevious={
                    imageBatch && imageBatch.length > 1 && previewIndex !== null
                        ? () => syncPreviewImage(previewIndex - 1)
                        : undefined
                }
                onNext={
                    imageBatch && imageBatch.length > 1 && previewIndex !== null
                        ? () => syncPreviewImage(previewIndex + 1)
                        : undefined
                }
                onOpenChange={(open) => {
                    if (!open) {
                        setPreviewImage(null);
                        setPreviewIndex(null);
                    }
                }}
            />
            <div className='relative flex h-full w-full flex-grow items-center justify-center overflow-hidden'>
                {isLoading ? (
                    imageBatch && imageBatch.length > 0 ? (
                        viewMode === 'grid' ? (
                            <div
                                className={`grid ${getGridColsClass(imageBatch.length)} max-h-full w-full max-w-full gap-1 p-1 opacity-95`}>
                                {imageBatch.map((img, index) => (
                                    <div
                                        key={img.filename}
                                        className='relative aspect-square overflow-hidden rounded border border-white/10'>
                                        <button
                                            type='button'
                                            className='relative h-full w-full cursor-zoom-in'
                                            onClick={() => openPreview(img, index)}
                                            aria-label={t('output.previewImageAria', { filename: img.filename })}>
                                            <Image
                                                src={img.path}
                                                alt={t('output.generatedGridAlt', { index: index + 1 })}
                                                fill
                                                style={{ objectFit: 'contain' }}
                                                sizes='(max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw'
                                                unoptimized
                                            />
                                        </button>
                                    </div>
                                ))}
                                <div className='pointer-events-none absolute inset-x-0 top-2 flex justify-center'>
                                    <div className='rounded-full bg-black/70 px-3 py-1 text-xs text-white/85'>
                                        {currentMode === 'edit' ? t('output.editing') : t('output.generating')} · {elapsedLabel}
                                    </div>
                                </div>
                            </div>
                        ) : imageBatch[viewMode] ? (
                            <div className='relative flex h-full w-full items-center justify-center'>
                                <button
                                    type='button'
                                    className='flex h-full w-full cursor-zoom-in items-center justify-center'
                                    onClick={() => openPreview(imageBatch[viewMode])}
                                    aria-label={t('output.previewImageAria', { filename: imageBatch[viewMode].filename })}>
                                    <Image
                                        src={imageBatch[viewMode].path}
                                        alt={altText}
                                        width={512}
                                        height={512}
                                        className='max-h-full max-w-full object-contain'
                                        unoptimized
                                    />
                                </button>
                                <div className='pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 text-xs text-white/85'>
                                    {currentMode === 'edit' ? t('output.editing') : t('output.generating')} · {elapsedLabel}
                                </div>
                            </div>
                        ) : (
                            <div className='flex flex-col items-center justify-center text-slate-500 dark:text-white/60'>
                                <Loader2 className='mb-2 h-8 w-8 animate-spin' />
                                <p>{t('output.generating')}</p>
                                <p className='mt-1 text-sm text-white/50'>{elapsedLabel}</p>
                            </div>
                        )
                    ) : currentMode === 'edit' && baseImagePreviewUrl ? (
                        <div className='relative flex h-full w-full items-center justify-center'>
                            <Image
                                src={baseImagePreviewUrl}
                                alt={t('output.baseEditAlt')}
                                fill
                                style={{ objectFit: 'contain' }}
                                className='blur-md filter'
                                unoptimized
                            />
                            <div className='absolute inset-0 flex flex-col items-center justify-center bg-white/65 text-slate-700 dark:bg-black/50 dark:text-white/80'>
                                <Loader2 className='mb-2 h-8 w-8 animate-spin' />
                                <p>{t('output.editing')}</p>
                                <p className='mt-1 text-sm text-white/60'>{elapsedLabel}</p>
                            </div>
                        </div>
                    ) : (
                        <div className='flex flex-col items-center justify-center text-slate-500 dark:text-white/60'>
                            <Loader2 className='mb-2 h-8 w-8 animate-spin' />
                            <p>{t('output.generating')}</p>
                            <p className='mt-1 text-sm text-white/50'>{elapsedLabel}</p>
                        </div>
                    )
                ) : imageBatch && imageBatch.length > 0 ? (
                    viewMode === 'grid' ? (
                        <div
                            className={`grid ${getGridColsClass(imageBatch.length)} max-h-full w-full max-w-full gap-1 p-1`}>
                            {imageBatch.map((img, index) => (
                                <div
                                    key={img.filename}
                                    className='relative aspect-square overflow-hidden rounded border border-white/10'>
                                    <button
                                        type='button'
                                        className='relative h-full w-full cursor-zoom-in'
                                        onClick={() => openPreview(img, index)}
                                        aria-label={t('output.previewImageAria', { filename: img.filename })}>
                                        <Image
                                            src={img.path}
                                            alt={t('output.generatedGridAlt', { index: index + 1 })}
                                            fill
                                            style={{ objectFit: 'contain' }}
                                            sizes='(max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw'
                                            unoptimized
                                        />
                                    </button>
                                    <Button
                                        asChild
                                        variant='ghost'
                                        size='icon'
                                        className='absolute right-1 bottom-1 z-10 h-7 w-7 rounded-full bg-black/70 text-white/80 hover:bg-black/90 hover:text-white'>
                                        <a
                                            href={img.path}
                                            download={img.filename}
                                            onClick={(event) => event.stopPropagation()}
                                            aria-label={t('output.downloadImageAria', { filename: img.filename })}>
                                            <Download className='h-4 w-4' />
                                        </a>
                                    </Button>
                                </div>
                            ))}
                        </div>
                    ) : imageBatch[viewMode] ? (
                        <>
                            <button
                                type='button'
                                className='flex h-full w-full cursor-zoom-in items-center justify-center'
                                onClick={() => openPreview(imageBatch[viewMode])}
                                aria-label={t('output.previewImageAria', { filename: imageBatch[viewMode].filename })}>
                                <Image
                                    src={imageBatch[viewMode].path}
                                    alt={altText}
                                    width={512}
                                    height={512}
                                    className='max-h-full max-w-full object-contain'
                                    unoptimized
                                />
                            </button>
                            {showCarousel && (
                                <>
                                    <Button
                                        type='button'
                                        variant='ghost'
                                        size='icon'
                                        onClick={goToPreviousImage}
                                        className='absolute top-1/2 left-2 h-9 w-9 -translate-y-1/2 rounded-full bg-black/70 text-white/80 hover:bg-black/90 hover:text-white'
                                        aria-label={t('output.previousImageAria')}>
                                        <ChevronLeft className='h-5 w-5' />
                                    </Button>
                                    <Button
                                        type='button'
                                        variant='ghost'
                                        size='icon'
                                        onClick={goToNextImage}
                                        className='absolute top-1/2 right-2 h-9 w-9 -translate-y-1/2 rounded-full bg-black/70 text-white/80 hover:bg-black/90 hover:text-white'
                                        aria-label={t('output.nextImageAria')}>
                                        <ChevronRight className='h-5 w-5' />
                                    </Button>
                                    <div className='absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-2 py-1 text-xs text-white/75'>
                                        {viewMode + 1}/{imageBatch.length}
                                    </div>
                                </>
                            )}
                        </>
                    ) : (
                        <div className='text-center text-slate-400 dark:text-white/40'>
                            <p>{t('output.displayError')}</p>
                        </div>
                    )
                ) : (
                    <div className='text-center text-slate-400 dark:text-white/40'>
                        <p>{t('output.empty')}</p>
                    </div>
                )}
            </div>

            {selectedImage && activePrompt && (
                <div className='max-h-20 w-full shrink-0 overflow-y-auto border border-slate-200 bg-white p-3 text-[12px] text-slate-600 dark:border-white/10 dark:bg-white/[0.035] dark:text-white/70'>
                    <div className='mb-1 flex items-center justify-between gap-2'>
                        <p className='font-medium text-slate-800 dark:text-white/85'>{t('common.prompt')}</p>
                    </div>
                    <p className='whitespace-pre-wrap'>{activePrompt}</p>
                </div>
            )}

            <div className='flex h-10 w-full shrink-0 items-center justify-center gap-3'>
                {showCarousel && (
                    <div className='flex items-center gap-1.5 rounded-md border border-white/10 bg-neutral-800/50 p-1'>
                        <Button
                            variant='ghost'
                            size='icon'
                            className={cn(
                                'h-8 w-8 rounded p-1',
                                viewMode === 'grid'
                                    ? 'bg-white/20 text-white'
                                    : 'text-white/50 hover:bg-white/10 hover:text-white/80'
                            )}
                            onClick={() => onViewChange('grid')}
                            aria-label={t('output.gridAria')}>
                            <Grid className='h-4 w-4' />
                        </Button>
                        {imageBatch.map((img, index) => (
                            <Button
                                key={img.filename}
                                variant='ghost'
                                size='icon'
                                className={cn(
                                    'h-8 w-8 overflow-hidden rounded p-0.5',
                                    viewMode === index
                                        ? 'ring-2 ring-white ring-offset-1 ring-offset-black'
                                        : 'opacity-60 hover:opacity-100'
                                )}
                                onClick={() => onViewChange(index)}
                                aria-label={t('output.selectImageAria', { index: index + 1 })}>
                                <Image
                                    src={img.path}
                                    alt={t('output.thumbnailAlt', { index: index + 1 })}
                                    width={28}
                                    height={28}
                                    className='h-full w-full object-cover'
                                    unoptimized
                                />
                            </Button>
                        ))}
                    </div>
                )}

                {selectedImage ? (
                    <Button
                        asChild
                        variant='outline'
                        size='sm'
                        className={cn(
                            'shrink-0 border-white/20 text-white/80 hover:bg-white/10 hover:text-white',
                            singleActionClass
                        )}>
                        <a href={selectedImage.path} download={selectedImage.filename}>
                            <Download className='mr-2 h-4 w-4' />
                            {t('output.downloadImage')}
                        </a>
                    </Button>
                ) : (
                    <Button
                        variant='outline'
                        size='sm'
                        disabled
                        className={cn(
                            'shrink-0 border-white/20 text-white/80 disabled:pointer-events-none disabled:opacity-50',
                            singleActionClass
                        )}>
                        <Download className='mr-2 h-4 w-4' />
                        {t('output.downloadImage')}
                    </Button>
                )}

                <Button
                    variant='outline'
                    size='sm'
                    onClick={handleSendClick}
                    disabled={!canSendToEdit}
                    className={cn(
                        'shrink-0 border-white/20 text-white/80 hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-50',
                        singleActionClass
                    )}>
                    <Send className='mr-2 h-4 w-4' />
                    {t('output.sendToEdit')}
                </Button>
            </div>
        </div>
    );
}
