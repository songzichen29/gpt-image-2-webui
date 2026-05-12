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
import { ChevronLeft, ChevronRight, Download, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
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

const minZoom = 0.5;
const maxZoom = 6;
const defaultZoom = 1;
const zoomStep = 0.2;

function clampZoom(value: number): number {
    return Math.min(maxZoom, Math.max(minZoom, value));
}

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
    const [zoom, setZoom] = React.useState(defaultZoom);
    const [pan, setPan] = React.useState({ x: 0, y: 0 });
    const hasMultipleImages = typeof totalCount === 'number' && totalCount > 1;
    const viewportRef = React.useRef<HTMLDivElement>(null);
    const touchStartXRef = React.useRef<number | null>(null);
    const touchStartYRef = React.useRef<number | null>(null);
    const swipeHandledRef = React.useRef(false);
    const dragStartRef = React.useRef<{
        pointerId: number;
        startX: number;
        startY: number;
        panX: number;
        panY: number;
    } | null>(null);
    const hasDraggedRef = React.useRef(false);
    const isZoomed = zoom > 1.01;

    const resetView = React.useCallback(() => {
        setZoom(defaultZoom);
        setPan({ x: 0, y: 0 });
    }, []);

    const updateZoom = React.useCallback((nextZoom: number, origin?: { x: number; y: number }) => {
        const clampedZoom = clampZoom(nextZoom);

        setZoom((currentZoom) => {
            const safeCurrentZoom = currentZoom || defaultZoom;
            const viewport = viewportRef.current;

            if (!origin || !viewport) {
                if (clampedZoom <= defaultZoom) {
                    setPan({ x: 0, y: 0 });
                }

                return clampedZoom;
            }

            const rect = viewport.getBoundingClientRect();
            const viewportCenterX = rect.left + rect.width / 2;
            const viewportCenterY = rect.top + rect.height / 2;
            const originOffsetX = origin.x - viewportCenterX;
            const originOffsetY = origin.y - viewportCenterY;
            const scaleRatio = clampedZoom / safeCurrentZoom;

            setPan((currentPan) => {
                if (clampedZoom <= defaultZoom) {
                    return { x: 0, y: 0 };
                }

                return {
                    x: originOffsetX - (originOffsetX - currentPan.x) * scaleRatio,
                    y: originOffsetY - (originOffsetY - currentPan.y) * scaleRatio
                };
            });

            return clampedZoom;
        });
    }, []);

    React.useEffect(() => {
        resetView();
        touchStartXRef.current = null;
        touchStartYRef.current = null;
        swipeHandledRef.current = false;
        dragStartRef.current = null;
        hasDraggedRef.current = false;
    }, [image?.src, open, resetView]);

    React.useEffect(() => {
        if (!open) return;

        const handleKeyDown = (event: KeyboardEvent) => {
            if ((event.ctrlKey || event.metaKey) && (event.key === '+' || event.key === '=')) {
                event.preventDefault();
                updateZoom(zoom + zoomStep);
                return;
            }

            if ((event.ctrlKey || event.metaKey) && event.key === '-') {
                event.preventDefault();
                updateZoom(zoom - zoomStep);
                return;
            }

            if ((event.ctrlKey || event.metaKey) && event.key === '0') {
                event.preventDefault();
                resetView();
                return;
            }

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
    }, [hasMultipleImages, onNext, onPrevious, open, resetView, updateZoom, zoom]);

    const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();

        const delta = event.deltaY > 0 ? -zoomStep : zoomStep;
        const multiplier = event.ctrlKey || event.metaKey ? 1.6 : 1;
        updateZoom(zoom + delta * multiplier, { x: event.clientX, y: event.clientY });
    };

    const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return;

        hasDraggedRef.current = false;
        dragStartRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            panX: pan.x,
            panY: pan.y
        };
        event.currentTarget.setPointerCapture(event.pointerId);
    };

    const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
        const dragStart = dragStartRef.current;
        if (!dragStart || dragStart.pointerId !== event.pointerId || !isZoomed) {
            return;
        }

        const deltaX = event.clientX - dragStart.startX;
        const deltaY = event.clientY - dragStart.startY;
        if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) {
            hasDraggedRef.current = true;
        }
        setPan({
            x: dragStart.panX + deltaX,
            y: dragStart.panY + deltaY
        });
    };

    const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
        if (dragStartRef.current?.pointerId === event.pointerId) {
            dragStartRef.current = null;
        }

        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
    };

    const handlePreviewDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
        event.preventDefault();

        if (isZoomed) {
            resetView();
            return;
        }

        updateZoom(2, { x: event.clientX, y: event.clientY });
    };

    const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
        const touch = event.touches[0];
        touchStartXRef.current = touch.clientX;
        touchStartYRef.current = touch.clientY;
        swipeHandledRef.current = false;
    };

    const handleTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
        if (isZoomed || !hasMultipleImages || !onPrevious || !onNext || swipeHandledRef.current) {
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
                    <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
                        <div className='min-w-0'>
                            <DialogTitle className='truncate text-white'>
                                {image?.filename || t('output.previewTitle')}
                            </DialogTitle>
                            <DialogDescription className='sr-only'>{t('output.previewDescription')}</DialogDescription>
                        </div>
                        {image && (
                            <div className='flex shrink-0 items-center gap-1.5'>
                                <button
                                    type='button'
                                    onClick={() => updateZoom(isZoomed ? defaultZoom : 2)}
                                    className='rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-xs text-white/80 transition hover:bg-white/15 hover:text-white'
                                    aria-label={t(isZoomed ? 'output.zoomOutImageAria' : 'output.zoomInImageAria', {
                                        filename: image.filename
                                    })}>
                                    {Math.round(zoom * 100)}%
                                </button>
                                <Button
                                    type='button'
                                    variant='ghost'
                                    size='icon'
                                    onClick={() => updateZoom(zoom - zoomStep)}
                                    className='h-8 w-8 rounded-full bg-white/10 text-white/80 hover:bg-white/15 hover:text-white'
                                    aria-label={t('output.zoomOutImageAria', { filename: image.filename })}>
                                    <ZoomOut className='h-4 w-4' />
                                </Button>
                                <Button
                                    type='button'
                                    variant='ghost'
                                    size='icon'
                                    onClick={() => updateZoom(zoom + zoomStep)}
                                    className='h-8 w-8 rounded-full bg-white/10 text-white/80 hover:bg-white/15 hover:text-white'
                                    aria-label={t('output.zoomInImageAria', { filename: image.filename })}>
                                    <ZoomIn className='h-4 w-4' />
                                </Button>
                                <Button
                                    type='button'
                                    variant='ghost'
                                    size='icon'
                                    onClick={resetView}
                                    className='h-8 w-8 rounded-full bg-white/10 text-white/80 hover:bg-white/15 hover:text-white'
                                    aria-label={t('output.resetPreviewAria')}>
                                    <RotateCcw className='h-4 w-4' />
                                </Button>
                            </div>
                        )}
                    </div>
                </DialogHeader>
                {image && (
                    <div className='relative h-[70vh] min-h-[320px] w-full'>
                        <div
                            ref={viewportRef}
                            role='button'
                            tabIndex={0}
                            onWheel={handleWheel}
                            onPointerDown={handlePointerDown}
                            onPointerMove={handlePointerMove}
                            onPointerUp={handlePointerUp}
                            onPointerCancel={handlePointerUp}
                            onDoubleClick={handlePreviewDoubleClick}
                            onTouchStart={handleTouchStart}
                            onTouchMove={handleTouchMove}
                            onTouchEnd={handleTouchEnd}
                            className={`relative h-full w-full touch-none select-none overflow-hidden rounded-md bg-black text-left ${
                                isZoomed ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in'
                            }`}
                            aria-label={t(isZoomed ? 'output.zoomOutImageAria' : 'output.zoomInImageAria', {
                                filename: image.filename
                            })}>
                            <div
                                className='relative flex h-full w-full items-center justify-center'
                                style={{
                                    transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
                                    transformOrigin: 'center center',
                                    transition: dragStartRef.current ? 'none' : 'transform 120ms ease-out'
                                }}>
                                <Image
                                    src={image.src}
                                    alt={image.alt || image.filename}
                                    width={1600}
                                    height={1600}
                                    className='h-full w-full object-contain'
                                    draggable={false}
                                    sizes='92vw'
                                    unoptimized
                                />
                            </div>
                            <div className='pointer-events-none absolute right-3 bottom-3 rounded-full bg-black/70 px-2.5 py-1 text-[11px] text-white/65'>
                                {t('output.previewControlsHint')}
                            </div>
                        </div>

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
