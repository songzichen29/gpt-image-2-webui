'use client';

import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/components/ui/dialog';
import { useI18n } from '@/lib/i18n';
import { ChevronLeft, ChevronRight, Download } from 'lucide-react';
import Image from 'next/image';
import * as React from 'react';

export type PreviewImage = {
    src: string;
    filename: string;
    alt?: string;
};

type ImagePreviewDialogProps = {
    image: PreviewImage | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    currentIndex?: number;
    totalCount?: number;
    onPrevious?: () => void;
    onNext?: () => void;
};

export function ImagePreviewDialog({
    image,
    open,
    onOpenChange,
    currentIndex,
    totalCount,
    onPrevious,
    onNext
}: ImagePreviewDialogProps) {
    const { t } = useI18n();
    const [isZoomed, setIsZoomed] = React.useState(false);
    const hasMultipleImages = typeof totalCount === 'number' && totalCount > 1;
    const touchStartXRef = React.useRef<number | null>(null);
    const touchStartYRef = React.useRef<number | null>(null);
    const swipeHandledRef = React.useRef(false);

    React.useEffect(() => {
        if (!open) {
            setIsZoomed(false);
            touchStartXRef.current = null;
            touchStartYRef.current = null;
            swipeHandledRef.current = false;
        }
    }, [image?.src, open]);

    React.useEffect(() => {
        if (!open) return;

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'ArrowLeft' && hasMultipleImages && onPrevious) {
                event.preventDefault();
                onPrevious();
            }

            if (event.key === 'ArrowRight' && hasMultipleImages && onNext) {
                event.preventDefault();
                onNext();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [hasMultipleImages, onNext, onPrevious, open]);

    const handleTouchStart = (event: React.TouchEvent<HTMLButtonElement>) => {
        const touch = event.touches[0];
        touchStartXRef.current = touch.clientX;
        touchStartYRef.current = touch.clientY;
        swipeHandledRef.current = false;
    };

    const handleTouchMove = (event: React.TouchEvent<HTMLButtonElement>) => {
        if (!hasMultipleImages || !onPrevious || !onNext || swipeHandledRef.current) {
            return;
        }

        const touch = event.touches[0];
        const startX = touchStartXRef.current;
        const startY = touchStartYRef.current;

        if (startX === null || startY === null) {
            return;
        }

        const deltaX = touch.clientX - startX;
        const deltaY = touch.clientY - startY;

        if (Math.abs(deltaY) > Math.abs(deltaX)) {
            return;
        }

        if (Math.abs(deltaX) < 56) {
            return;
        }

        swipeHandledRef.current = true;
        event.preventDefault();

        if (deltaX > 0) {
            onPrevious();
        } else {
            onNext();
        }
    };

    const handleTouchEnd = () => {
        touchStartXRef.current = null;
        touchStartYRef.current = null;
        swipeHandledRef.current = false;
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className='max-h-[92vh] border-neutral-700 bg-neutral-950 p-4 text-white sm:max-w-[92vw]'>
                <DialogHeader className='pr-8'>
                    <DialogTitle className='truncate text-white'>
                        {image?.filename || t('output.previewTitle')}
                    </DialogTitle>
                    <DialogDescription className='sr-only'>{t('output.previewDescription')}</DialogDescription>
                </DialogHeader>
                {image && (
                    <div className='relative h-[70vh] min-h-[320px] w-full'>
                        <button
                            type='button'
                            onClick={() => setIsZoomed((current) => !current)}
                            onTouchStart={handleTouchStart}
                            onTouchMove={handleTouchMove}
                            onTouchEnd={handleTouchEnd}
                            className='relative h-full w-full overflow-auto rounded-md bg-black text-left'
                            aria-label={t(isZoomed ? 'output.zoomOutImageAria' : 'output.zoomInImageAria', {
                                filename: image.filename
                            })}>
                            <div
                                className={`relative flex min-h-full min-w-full items-center justify-center ${
                                    isZoomed ? 'h-max w-max' : 'h-full w-full'
                                }`}>
                                <Image
                                    src={image.src}
                                    alt={image.alt || image.filename}
                                    width={1600}
                                    height={1600}
                                    className={
                                        isZoomed ? 'h-auto max-w-none object-contain' : 'h-full w-full object-contain'
                                    }
                                    sizes='92vw'
                                    unoptimized
                                />
                            </div>
                        </button>

                        {hasMultipleImages && onPrevious && onNext && (
                            <>
                                <Button
                                    type='button'
                                    variant='ghost'
                                    size='icon'
                                    onClick={onPrevious}
                                    className='absolute top-1/2 left-2 h-10 w-10 -translate-y-1/2 rounded-full bg-black/70 text-white/80 hover:bg-black/90 hover:text-white'
                                    aria-label={t('output.previousImageAria')}>
                                    <ChevronLeft className='h-5 w-5' />
                                </Button>
                                <Button
                                    type='button'
                                    variant='ghost'
                                    size='icon'
                                    onClick={onNext}
                                    className='absolute top-1/2 right-2 h-10 w-10 -translate-y-1/2 rounded-full bg-black/70 text-white/80 hover:bg-black/90 hover:text-white'
                                    aria-label={t('output.nextImageAria')}>
                                    <ChevronRight className='h-5 w-5' />
                                </Button>
                                <div className='absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-2.5 py-1 text-xs text-white/80'>
                                    {(currentIndex ?? 0) + 1}/{totalCount}
                                </div>
                            </>
                        )}
                    </div>
                )}
                <DialogFooter>
                    {image && (
                        <Button
                            asChild
                            type='button'
                            variant='outline'
                            size='sm'
                            className='border-white/20 text-white/80 hover:bg-white/10 hover:text-white'>
                            <a href={image.src} download={image.filename}>
                                <Download className='h-4 w-4' />
                                {t('common.download')}
                            </a>
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
