'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Slider } from '@/components/ui/slider';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { GptImageModel } from '@/lib/cost-utils';
import { formatSizeValidationReason, useI18n } from '@/lib/i18n';
import { getPresetTooltip, validateGptImage2Size } from '@/lib/size-utils';
import type { SizePreset } from '@/lib/size-utils';
import {
    Upload,
    Eraser,
    Save,
    Square,
    RectangleHorizontal,
    RectangleVertical,
    Sparkles,
    Tally1,
    Tally2,
    Tally3,
    Loader2,
    X,
    ScanEye,
    UploadCloud,
    SquareDashed
} from 'lucide-react';
import Image from 'next/image';
import * as React from 'react';

type DrawnPoint = {
    x: number;
    y: number;
    size: number;
};

export type EditingFormData = {
    prompt: string;
    n: number;
    size: SizePreset;
    customWidth: number;
    customHeight: number;
    quality: 'low' | 'medium' | 'high' | 'auto';
    imageFiles: File[];
    maskFile: File | null;
    model: GptImageModel;
};

type EditingFormProps = {
    onSubmit: (data: EditingFormData) => void;
    isLoading: boolean;
    hideSubmit?: boolean;
    isPasswordRequiredByBackend: boolean | null;
    clientPasswordHash: string | null;
    onOpenPasswordDialog: () => void;
    editModel: EditingFormData['model'];
    imageFiles: File[];
    sourceImagePreviewUrls: string[];
    setImageFiles: React.Dispatch<React.SetStateAction<File[]>>;
    setSourceImagePreviewUrls: React.Dispatch<React.SetStateAction<string[]>>;
    maxImages: number;
    editPrompt: string;
    setEditPrompt: React.Dispatch<React.SetStateAction<string>>;
    editN: number[];
    setEditN: React.Dispatch<React.SetStateAction<number[]>>;
    editSize: EditingFormData['size'];
    setEditSize: React.Dispatch<React.SetStateAction<EditingFormData['size']>>;
    editCustomWidth: number;
    setEditCustomWidth: React.Dispatch<React.SetStateAction<number>>;
    editCustomHeight: number;
    setEditCustomHeight: React.Dispatch<React.SetStateAction<number>>;
    editQuality: EditingFormData['quality'];
    setEditQuality: React.Dispatch<React.SetStateAction<EditingFormData['quality']>>;
    editBrushSize: number[];
    setEditBrushSize: React.Dispatch<React.SetStateAction<number[]>>;
    editShowMaskEditor: boolean;
    setEditShowMaskEditor: React.Dispatch<React.SetStateAction<boolean>>;
    editGeneratedMaskFile: File | null;
    setEditGeneratedMaskFile: React.Dispatch<React.SetStateAction<File | null>>;
    editIsMaskSaved: boolean;
    setEditIsMaskSaved: React.Dispatch<React.SetStateAction<boolean>>;
    editOriginalImageSize: { width: number; height: number } | null;
    setEditOriginalImageSize: React.Dispatch<React.SetStateAction<{ width: number; height: number } | null>>;
    editDrawnPoints: DrawnPoint[];
    setEditDrawnPoints: React.Dispatch<React.SetStateAction<DrawnPoint[]>>;
    editMaskPreviewUrl: string | null;
    setEditMaskPreviewUrl: React.Dispatch<React.SetStateAction<string | null>>;
};

const RadioItemWithIcon = ({
    value,
    id,
    label,
    Icon
}: {
    value: string;
    id: string;
    label: string;
    Icon: React.ElementType;
}) => (
    <div className='flex items-center space-x-2'>
        <RadioGroupItem
            value={value}
            id={id}
            className='border-slate-300 text-[#2563eb] data-[state=checked]:border-[#2563eb] data-[state=checked]:text-[#2563eb] dark:border-white/40 dark:text-white dark:data-[state=checked]:border-white dark:data-[state=checked]:text-white'
        />
        <Label htmlFor={id} className='flex cursor-pointer items-center gap-1.5 text-[12px] text-slate-700 dark:text-white/80'>
            <Icon className='h-4 w-4 text-slate-400 dark:text-white/60' />
            {label}
        </Label>
    </div>
);

const fieldLabelClass = 'text-[12px] font-medium text-slate-700 dark:text-white/85';
const fieldHintClass = 'text-[12px] text-slate-500 dark:text-white/50';
const controlSurfaceClass =
    'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-white/20 dark:bg-white/[0.03] dark:text-white/80 dark:hover:bg-white/10 dark:hover:text-white';
const sliderClass =
    'mt-2 [&>button]:border-[#2563eb] [&>button]:bg-[#2563eb] [&>button]:ring-offset-white dark:[&>button]:border-white/20 dark:[&>button]:bg-white dark:[&>button]:ring-offset-[#0f1115] [&>span:first-child]:h-1 [&>span:first-child>span]:bg-[#2563eb] dark:[&>span:first-child>span]:bg-white';

export function EditingForm({
    onSubmit,
    isLoading,
    hideSubmit = false,
    editModel,
    imageFiles,
    sourceImagePreviewUrls,
    setImageFiles,
    setSourceImagePreviewUrls,
    maxImages,
    editPrompt,
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
}: EditingFormProps) {
    const { t } = useI18n();
    const [firstImagePreviewUrl, setFirstImagePreviewUrl] = React.useState<string | null>(null);

    const supportsCustomSize = true;
    const customSizeValidation =
        editSize === 'custom' ? validateGptImage2Size(editCustomWidth, editCustomHeight) : { valid: true as const };
    const customSizeInvalid = editSize === 'custom' && !customSizeValidation.valid;

    const canvasRef = React.useRef<HTMLCanvasElement>(null);
    const visualFeedbackCanvasRef = React.useRef<HTMLCanvasElement | null>(null);
    const isDrawing = React.useRef(false);
    const lastPos = React.useRef<{ x: number; y: number } | null>(null);
    const maskInputRef = React.useRef<HTMLInputElement>(null);

    React.useEffect(() => {
        if (editOriginalImageSize) {
            if (!visualFeedbackCanvasRef.current) {
                visualFeedbackCanvasRef.current = document.createElement('canvas');
            }
            visualFeedbackCanvasRef.current.width = editOriginalImageSize.width;
            visualFeedbackCanvasRef.current.height = editOriginalImageSize.height;
        }
    }, [editOriginalImageSize]);

    React.useEffect(() => {
        setEditGeneratedMaskFile(null);
        setEditIsMaskSaved(false);
        setEditOriginalImageSize(null);
        setFirstImagePreviewUrl(null);
        setEditDrawnPoints([]);
        setEditMaskPreviewUrl(null);

        if (imageFiles.length > 0 && sourceImagePreviewUrls.length > 0) {
            const img = new window.Image();
            img.onload = () => {
                setEditOriginalImageSize({ width: img.width, height: img.height });
            };
            img.src = sourceImagePreviewUrls[0];
            setFirstImagePreviewUrl(sourceImagePreviewUrls[0]);
        } else {
            setEditShowMaskEditor(false);
        }
    }, [
        imageFiles,
        sourceImagePreviewUrls,
        setEditGeneratedMaskFile,
        setEditIsMaskSaved,
        setEditOriginalImageSize,
        setEditDrawnPoints,
        setEditMaskPreviewUrl,
        setEditShowMaskEditor
    ]);

    React.useEffect(() => {
        const displayCtx = canvasRef.current?.getContext('2d');
        const displayCanvas = canvasRef.current;
        const feedbackCanvas = visualFeedbackCanvasRef.current;

        if (!displayCtx || !displayCanvas || !feedbackCanvas || !editOriginalImageSize) return;

        const feedbackCtx = feedbackCanvas.getContext('2d');
        if (!feedbackCtx) return;

        feedbackCtx.clearRect(0, 0, feedbackCanvas.width, feedbackCanvas.height);
        feedbackCtx.fillStyle = 'red';
        editDrawnPoints.forEach((point) => {
            feedbackCtx.beginPath();
            feedbackCtx.arc(point.x, point.y, point.size, 0, Math.PI * 2);
            feedbackCtx.fill();
        });

        displayCtx.clearRect(0, 0, displayCanvas.width, displayCanvas.height);
        displayCtx.save();
        displayCtx.globalAlpha = 0.5;
        displayCtx.drawImage(feedbackCanvas, 0, 0, displayCanvas.width, displayCanvas.height);
        displayCtx.restore();
    }, [editDrawnPoints, editOriginalImageSize]);

    const getMousePos = (e: React.MouseEvent | React.TouchEvent) => {
        const canvas = canvasRef.current;
        if (!canvas) return null;
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
        return {
            x: (clientX - rect.left) * scaleX,
            y: (clientY - rect.top) * scaleY
        };
    };

    const addPoint = (x: number, y: number) => {
        setEditDrawnPoints((prevPoints) => [...prevPoints, { x, y, size: editBrushSize[0] }]);
        setEditIsMaskSaved(false);
        setEditMaskPreviewUrl(null);
    };

    const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
        e.preventDefault();
        isDrawing.current = true;
        const currentPos = getMousePos(e);
        if (!currentPos) return;
        lastPos.current = currentPos;
        addPoint(currentPos.x, currentPos.y);
    };

    const drawLine = (e: React.MouseEvent | React.TouchEvent) => {
        if (!isDrawing.current) return;
        e.preventDefault();
        const currentPos = getMousePos(e);
        if (!currentPos || !lastPos.current) return;

        const dist = Math.hypot(currentPos.x - lastPos.current.x, currentPos.y - lastPos.current.y);
        const angle = Math.atan2(currentPos.y - lastPos.current.y, currentPos.x - lastPos.current.x);
        const step = Math.max(1, editBrushSize[0] / 4);

        for (let i = step; i < dist; i += step) {
            const x = lastPos.current.x + Math.cos(angle) * i;
            const y = lastPos.current.y + Math.sin(angle) * i;
            addPoint(x, y);
        }
        addPoint(currentPos.x, currentPos.y);

        lastPos.current = currentPos;
    };

    const drawMaskStroke = (ctx: CanvasRenderingContext2D, x: number, y: number, size: number) => {
        ctx.fillStyle = 'black';
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
    };

    const stopDrawing = () => {
        isDrawing.current = false;
        lastPos.current = null;
    };

    const handleClearMask = () => {
        setEditDrawnPoints([]);
        setEditGeneratedMaskFile(null);
        setEditIsMaskSaved(false);
        setEditMaskPreviewUrl(null);
    };

    const generateAndSaveMask = () => {
        if (!editOriginalImageSize || editDrawnPoints.length === 0) {
            setEditGeneratedMaskFile(null);
            setEditIsMaskSaved(false);
            setEditMaskPreviewUrl(null);
            return;
        }

        const offscreenCanvas = document.createElement('canvas');
        offscreenCanvas.width = editOriginalImageSize.width;
        offscreenCanvas.height = editOriginalImageSize.height;
        const offscreenCtx = offscreenCanvas.getContext('2d');

        if (!offscreenCtx) return;

        offscreenCtx.fillStyle = '#000000';
        offscreenCtx.fillRect(0, 0, offscreenCanvas.width, offscreenCanvas.height);
        offscreenCtx.globalCompositeOperation = 'destination-out';
        editDrawnPoints.forEach((point) => {
            drawMaskStroke(offscreenCtx, point.x, point.y, point.size);
        });

        try {
            const dataUrl = offscreenCanvas.toDataURL('image/png');
            setEditMaskPreviewUrl(dataUrl);
        } catch (e) {
            console.error('Error generating mask preview data URL:', e);
            setEditMaskPreviewUrl(null);
        }

        offscreenCanvas.toBlob((blob) => {
            if (blob) {
                const maskFile = new File([blob], 'generated-mask.png', { type: 'image/png' });
                setEditGeneratedMaskFile(maskFile);
                setEditIsMaskSaved(true);
            } else {
                console.error('Failed to generate mask blob.');
                setEditIsMaskSaved(false);
                setEditMaskPreviewUrl(null);
            }
        }, 'image/png');
    };

    const handleImageFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        if (event.target.files) {
            const newFiles = Array.from(event.target.files);
            const totalFiles = imageFiles.length + newFiles.length;

            if (totalFiles > maxImages) {
                alert(t('form.invalidMaxFiles', { maxImages }));
                const allowedNewFiles = newFiles.slice(0, maxImages - imageFiles.length);
                if (allowedNewFiles.length === 0) {
                    event.target.value = '';
                    return;
                }
                newFiles.splice(allowedNewFiles.length);
            }

            setImageFiles((prevFiles) => [...prevFiles, ...newFiles]);

            const newFilePromises = newFiles.map((file) => {
                return new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result as string);
                    reader.onerror = reject;
                    reader.readAsDataURL(file);
                });
            });

            Promise.all(newFilePromises)
                .then((newUrls) => {
                    setSourceImagePreviewUrls((prevUrls) => [...prevUrls, ...newUrls]);
                })
                .catch((error) => {
                    console.error('Error reading new image files:', error);
                });

            event.target.value = '';
        }
    };

    const handleRemoveImage = (indexToRemove: number) => {
        setImageFiles((prevFiles) => prevFiles.filter((_, index) => index !== indexToRemove));
        setSourceImagePreviewUrls((prevUrls) => prevUrls.filter((_, index) => index !== indexToRemove));
    };

    const handleMaskFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file || !editOriginalImageSize) {
            event.target.value = '';
            return;
        }

        if (file.type !== 'image/png') {
            alert(t('form.validation.invalidMaskType'));
            event.target.value = '';
            return;
        }

        const reader = new FileReader();
        const img = new window.Image();
        const objectUrl = URL.createObjectURL(file);

        img.onload = () => {
            if (img.width !== editOriginalImageSize.width || img.height !== editOriginalImageSize.height) {
                alert(
                    t('form.validation.maskDimensionMismatch', {
                        maskWidth: img.width,
                        maskHeight: img.height,
                        imageWidth: editOriginalImageSize.width,
                        imageHeight: editOriginalImageSize.height
                    })
                );
                URL.revokeObjectURL(objectUrl);
                event.target.value = '';
                return;
            }

            setEditGeneratedMaskFile(file);
            setEditIsMaskSaved(true);
            setEditDrawnPoints([]);

            reader.onloadend = () => {
                setEditMaskPreviewUrl(reader.result as string);
                URL.revokeObjectURL(objectUrl);
            };
            reader.onerror = () => {
                console.error('Error reading mask file for preview.');
                setEditMaskPreviewUrl(null);
                URL.revokeObjectURL(objectUrl);
            };
            reader.readAsDataURL(file);

            event.target.value = '';
        };

        img.onerror = () => {
            alert(t('form.maskLoadFailed'));
            URL.revokeObjectURL(objectUrl);
            event.target.value = '';
        };

        img.src = objectUrl;
    };

    const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (imageFiles.length === 0) {
            alert(t('form.validation.noEditImage'));
            return;
        }
        if (editDrawnPoints.length > 0 && !editGeneratedMaskFile && !editIsMaskSaved) {
            alert(t('form.validation.saveMaskBeforeSubmit'));
            return;
        }
        if (customSizeInvalid) {
            return;
        }

        const formData: EditingFormData = {
            prompt: editPrompt,
            n: editN[0],
            size: editSize,
            customWidth: editCustomWidth,
            customHeight: editCustomHeight,
            quality: editQuality,
            imageFiles: imageFiles,
            maskFile: editGeneratedMaskFile,
            model: editModel
        };
        onSubmit(formData);
    };

    const displayFileNames = (files: File[]) => {
        if (files.length === 0) return t('form.noFileSelected');
        if (files.length === 1) return files[0].name;
        return t('form.filesSelected', { count: files.length });
    };

    const customPixelCount = editCustomWidth * editCustomHeight;
    const customPixelPercent = ((customPixelCount / 8_294_400) * 100).toFixed(1);
    const customRatio =
        editCustomWidth > 0 && editCustomHeight > 0
            ? (Math.max(editCustomWidth, editCustomHeight) / Math.min(editCustomWidth, editCustomHeight)).toFixed(2)
            : null;

    return (
        <Card className='flex h-full w-full flex-col overflow-hidden rounded-none border-0 bg-transparent shadow-none'>
            <form onSubmit={handleSubmit} className='flex h-full flex-1 flex-col overflow-hidden'>
                <CardContent className='min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-0 pr-1'>
                    <div className='space-y-2'>
                        <Label className={fieldLabelClass}>{t('form.sourceImages', { maxImages })}</Label>
                        <Label
                            htmlFor='image-files-input'
                            className={`flex h-9 w-full cursor-pointer items-center justify-between rounded-md px-3 py-2 text-[12px] transition-colors ${controlSurfaceClass}`}>
                            <span className='truncate pr-2 text-slate-500 dark:text-white/60'>{displayFileNames(imageFiles)}</span>
                            <span className='flex shrink-0 items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-white dark:border-white/10 dark:bg-white/10 dark:text-white/80 dark:hover:bg-white/20'>
                                <Upload className='h-3 w-3' /> {t('form.browse')}
                            </span>
                        </Label>
                        <Input
                            id='image-files-input'
                            type='file'
                            accept='image/png, image/jpeg, image/webp'
                            multiple
                            onChange={handleImageFileChange}
                            disabled={isLoading || imageFiles.length >= maxImages}
                            className='sr-only'
                        />
                        {sourceImagePreviewUrls.length > 0 && (
                            <div className='flex space-x-2 overflow-x-auto pt-2'>
                                {sourceImagePreviewUrls.map((url, index) => (
                                    <div key={url} className='relative shrink-0'>
                                        <Image
                                            src={url}
                                            alt={t('form.sourcePreviewAlt', { index: index + 1 })}
                                            width={80}
                                            height={80}
                                            className='rounded border border-slate-200 object-cover dark:border-white/10'
                                            unoptimized
                                        />
                                        <Button
                                            type='button'
                                            variant='destructive'
                                            size='icon'
                                            className='absolute top-0 right-0 h-5 w-5 translate-x-1/3 -translate-y-1/3 transform rounded-full bg-red-600 p-0.5 text-white hover:bg-red-700'
                                            onClick={() => handleRemoveImage(index)}
                                            aria-label={t('form.removeImageAria', { index: index + 1 })}>
                                            <X className='h-3 w-3' />
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className='space-y-3'>
                        <Label className={fieldLabelClass}>{t('common.mask')}</Label>
                        <Button
                            type='button'
                            variant='outline'
                            size='sm'
                            onClick={() => setEditShowMaskEditor(!editShowMaskEditor)}
                            disabled={isLoading || !editOriginalImageSize}
                            className={`w-full justify-start px-3 text-[12px] ${controlSurfaceClass}`}>
                            {editShowMaskEditor
                                ? t('form.maskCloseEditor')
                                : editGeneratedMaskFile
                                  ? t('form.maskEditSaved')
                                  : t('form.maskCreate')}
                            {editIsMaskSaved && !editShowMaskEditor && (
                                <span className='ml-auto text-xs text-green-400'>{t('form.maskSaved')}</span>
                            )}
                            <ScanEye className='mt-0.5' />
                        </Button>

                        {editShowMaskEditor && firstImagePreviewUrl && editOriginalImageSize && (
                            <div
                                className='space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3 overscroll-contain dark:border-white/20 dark:bg-black'
                                onWheel={(event) => event.stopPropagation()}
                                onTouchMove={(event) => {
                                    if (isDrawing.current) {
                                        event.stopPropagation();
                                    }
                                }}>
                                <p className={fieldHintClass}>{t('form.maskDescription')}</p>
                                <div
                                    className='relative mx-auto w-full overflow-hidden rounded border border-slate-200 dark:border-white/10'
                                    style={{
                                        maxWidth: `min(100%, ${editOriginalImageSize.width}px)`,
                                        aspectRatio: `${editOriginalImageSize.width} / ${editOriginalImageSize.height}`
                                    }}>
                                    <Image
                                        src={firstImagePreviewUrl}
                                        alt={t('form.sourcePreviewAlt', { index: 1 })}
                                        width={editOriginalImageSize.width}
                                        height={editOriginalImageSize.height}
                                        className='block h-auto w-full'
                                        unoptimized
                                    />
                                    <canvas
                                        ref={canvasRef}
                                        width={editOriginalImageSize.width}
                                        height={editOriginalImageSize.height}
                                        className='absolute top-0 left-0 h-full w-full touch-none cursor-crosshair select-none'
                                        onMouseDown={startDrawing}
                                        onMouseMove={drawLine}
                                        onMouseUp={stopDrawing}
                                        onMouseLeave={stopDrawing}
                                        onTouchStart={startDrawing}
                                        onTouchMove={drawLine}
                                        onTouchEnd={stopDrawing}
                                    />
                                </div>
                                <div className='grid grid-cols-1 gap-4 pt-2'>
                                    <div className='space-y-2'>
                                        <Label htmlFor='brush-size-slider' className={fieldLabelClass}>
                                            {t('form.brushSize', { size: editBrushSize[0] })}
                                        </Label>
                                        <Slider
                                            id='brush-size-slider'
                                            min={5}
                                            max={100}
                                            step={1}
                                            value={editBrushSize}
                                            onValueChange={setEditBrushSize}
                                            disabled={isLoading}
                                            className={sliderClass}
                                        />
                                    </div>
                                </div>
                                <div className='flex items-center justify-between gap-2 pt-3'>
                                    <Button
                                        type='button'
                                        variant='outline'
                                        size='sm'
                                        onClick={() => maskInputRef.current?.click()}
                                        disabled={isLoading || !editOriginalImageSize}
                                        className={`mr-auto text-[12px] ${controlSurfaceClass}`}>
                                        <UploadCloud className='mr-1.5 h-4 w-4' /> {t('form.maskUpload')}
                                    </Button>
                                    <Input
                                        ref={maskInputRef}
                                        id='mask-file-input'
                                        type='file'
                                        accept='image/png'
                                        onChange={handleMaskFileChange}
                                        className='sr-only'
                                    />
                                    <div className='flex gap-2'>
                                        <Button
                                            type='button'
                                            variant='outline'
                                            size='sm'
                                            onClick={handleClearMask}
                                            disabled={isLoading}
                                            className={`text-[12px] ${controlSurfaceClass}`}>
                                            <Eraser className='mr-1.5 h-4 w-4' /> {t('form.maskClear')}
                                        </Button>
                                        <Button
                                            type='button'
                                            variant='default'
                                            size='sm'
                                            onClick={generateAndSaveMask}
                                            disabled={isLoading || editDrawnPoints.length === 0}
                                            className='bg-[#2563eb] text-[#ffffff] hover:bg-[#1d4ed8] disabled:opacity-50 dark:bg-white dark:text-[#0f172a] dark:hover:bg-white/90'>
                                            <Save className='mr-1.5 h-4 w-4' /> {t('form.maskSave')}
                                        </Button>
                                    </div>
                                </div>
                                {editMaskPreviewUrl && (
                                    <div className='mt-3 border-t border-slate-200 pt-3 text-center dark:border-white/10'>
                                        <Label className={fieldLabelClass}>
                                            {t('form.maskPreviewLabel')}
                                        </Label>
                                        <div className='inline-block rounded border border-gray-300 bg-white p-1'>
                                            <Image
                                                src={editMaskPreviewUrl}
                                                alt={t('form.maskPreviewAlt')}
                                                width={0}
                                                height={134}
                                                className='block max-w-full'
                                                style={{ width: 'auto', height: '134px' }}
                                                unoptimized
                                            />
                                        </div>
                                    </div>
                                )}
                                {editIsMaskSaved && !editMaskPreviewUrl && (
                                    <p className='pt-1 text-center text-xs text-yellow-400'>
                                        {t('form.maskPreviewLoading')}
                                    </p>
                                )}
                                {editIsMaskSaved && editMaskPreviewUrl && (
                                    <p className='pt-1 text-center text-xs text-green-400'>
                                        {t('form.maskSavedSuccess')}
                                    </p>
                                )}
                            </div>
                        )}
                        {!editShowMaskEditor && editGeneratedMaskFile && (
                            <p className='pt-1 text-xs text-green-400'>
                                {t('form.maskApplied', { name: editGeneratedMaskFile.name })}
                            </p>
                        )}
                    </div>

                    <div className='space-y-2'>
                        <Label htmlFor='edit-n-slider' className={fieldLabelClass}>
                            {t('form.numberOfImages', { count: editN[0] })}
                        </Label>
                        <Slider
                            id='edit-n-slider'
                            min={1}
                            max={10}
                            step={1}
                            value={editN}
                            onValueChange={setEditN}
                            disabled={isLoading}
                            className={sliderClass}
                        />
                    </div>

                    <div className='space-y-3'>
                        <Label className={fieldLabelClass}>{t('common.size')}</Label>
                        <RadioGroup
                            value={editSize}
                            onValueChange={(value) => setEditSize(value as EditingFormData['size'])}
                            disabled={isLoading}
                            className='grid grid-cols-2 gap-2'>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <div>
                                        <RadioItemWithIcon
                                            value='square'
                                            id='edit-size-square'
                                            label={t('common.square')}
                                            Icon={Square}
                                        />
                                    </div>
                                </TooltipTrigger>
                                <TooltipContent>{getPresetTooltip('square', editModel)}</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <div>
                                        <RadioItemWithIcon
                                            value='landscape'
                                            id='edit-size-landscape'
                                            label={t('common.landscape')}
                                            Icon={RectangleHorizontal}
                                        />
                                    </div>
                                </TooltipTrigger>
                                <TooltipContent>{getPresetTooltip('landscape', editModel)}</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <div>
                                        <RadioItemWithIcon
                                            value='portrait'
                                            id='edit-size-portrait'
                                            label={t('common.portrait')}
                                            Icon={RectangleVertical}
                                        />
                                    </div>
                                </TooltipTrigger>
                                <TooltipContent>{getPresetTooltip('portrait', editModel)}</TooltipContent>
                            </Tooltip>
                            {supportsCustomSize && (
                                <RadioItemWithIcon
                                    value='custom'
                                    id='edit-size-custom'
                                    label={t('common.custom')}
                                    Icon={SquareDashed}
                                />
                            )}
                        </RadioGroup>
                        {supportsCustomSize && editSize === 'custom' && (
                            <div className='space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-white/5'>
                                <div className='flex items-center gap-3'>
                                    <div className='flex-1 space-y-1'>
                                        <Label htmlFor='edit-custom-width' className='text-xs text-slate-500 dark:text-white/70'>
                                            {t('common.width')}
                                        </Label>
                                        <Input
                                            id='edit-custom-width'
                                            type='number'
                                            min={16}
                                            max={3840}
                                            step={16}
                                            value={editCustomWidth}
                                            onChange={(e) => setEditCustomWidth(parseInt(e.target.value, 10) || 0)}
                                            disabled={isLoading}
                                            className='rounded-md border border-slate-200 bg-white text-slate-900 focus:border-[#2563eb] focus:ring-[#2563eb]/30 dark:border-white/20 dark:bg-black dark:text-white dark:focus:border-white/50 dark:focus:ring-white/50'
                                        />
                                    </div>
                                    <span className='pt-5 text-slate-400 dark:text-white/60'>×</span>
                                    <div className='flex-1 space-y-1'>
                                        <Label htmlFor='edit-custom-height' className='text-xs text-slate-500 dark:text-white/70'>
                                            {t('common.height')}
                                        </Label>
                                        <Input
                                            id='edit-custom-height'
                                            type='number'
                                            min={16}
                                            max={3840}
                                            step={16}
                                            value={editCustomHeight}
                                            onChange={(e) => setEditCustomHeight(parseInt(e.target.value, 10) || 0)}
                                            disabled={isLoading}
                                            className='rounded-md border border-slate-200 bg-white text-slate-900 focus:border-[#2563eb] focus:ring-[#2563eb]/30 dark:border-white/20 dark:bg-black dark:text-white dark:focus:border-white/50 dark:focus:ring-white/50'
                                        />
                                    </div>
                                </div>
                                <p className={fieldHintClass}>
                                    {customRatio
                                        ? t('form.customSizeSummary', {
                                              pixels: customPixelCount.toLocaleString(),
                                              percent: customPixelPercent,
                                              ratio: customRatio
                                          })
                                        : t('form.customSizeSummaryNoRatio', {
                                              pixels: customPixelCount.toLocaleString(),
                                              percent: customPixelPercent
                                          })}
                                </p>
                                {!customSizeValidation.valid && (
                                    <p className='text-xs text-red-400'>
                                        {formatSizeValidationReason(customSizeValidation.reason, t)}
                                    </p>
                                )}
                                <p className='text-xs text-slate-400 dark:text-white/40'>{t('form.customSizeConstraints')}</p>
                            </div>
                        )}
                    </div>

                    <div className='space-y-3'>
                        <div>
                            <Label className={fieldLabelClass}>{t('common.quality')}</Label>
                            <p className={fieldHintClass}>{t('form.qualityDescription')}</p>
                        </div>
                        <RadioGroup
                            value={editQuality}
                            onValueChange={(value) => setEditQuality(value as EditingFormData['quality'])}
                            disabled={isLoading}
                            className='grid grid-cols-2 gap-2'>
                            <RadioItemWithIcon
                                value='auto'
                                id='edit-quality-auto'
                                label={t('common.auto')}
                                Icon={Sparkles}
                            />
                            <RadioItemWithIcon
                                value='low'
                                id='edit-quality-low'
                                label={t('common.low')}
                                Icon={Tally1}
                            />
                            <RadioItemWithIcon
                                value='medium'
                                id='edit-quality-medium'
                                label={t('common.medium')}
                                Icon={Tally2}
                            />
                            <RadioItemWithIcon
                                value='high'
                                id='edit-quality-high'
                                label={t('common.high')}
                                Icon={Tally3}
                            />
                        </RadioGroup>
                    </div>

                </CardContent>
                {!hideSubmit && (
                    <CardFooter className='border-t border-slate-200 p-0 pt-3 dark:border-white/10'>
                        <Button
                            type='submit'
                            disabled={isLoading || imageFiles.length === 0 || customSizeInvalid}
                            translate='no'
                            className='flex w-full items-center justify-center gap-2 rounded-md bg-[#2563eb] text-[#ffffff] hover:bg-[#1d4ed8] disabled:bg-slate-200 disabled:text-slate-500 dark:bg-white dark:text-[#0f172a] dark:hover:bg-white/90 dark:disabled:bg-white/10 dark:disabled:text-white/40'>
                            <Loader2
                                aria-hidden='true'
                                className={`h-4 w-4 ${isLoading ? 'animate-spin opacity-100' : 'hidden opacity-0'}`}
                            />
                            <span>{isLoading ? t('form.edit.buttonLoading') : t('form.edit.button')}</span>
                        </Button>
                    </CardFooter>
                )}
            </form>
        </Card>
    );
}
