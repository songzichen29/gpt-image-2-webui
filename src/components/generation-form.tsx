'use client';

import { ModeToggle } from '@/components/mode-toggle';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
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
    Square,
    RectangleHorizontal,
    RectangleVertical,
    Sparkles,
    Eraser,
    ShieldCheck,
    ShieldAlert,
    FileImage,
    Tally1,
    Tally2,
    Tally3,
    Loader2,
    BrickWall,
    Lock,
    LockOpen,
    SquareDashed
} from 'lucide-react';
import * as React from 'react';

export type GenerationFormData = {
    prompt: string;
    n: number;
    size: SizePreset;
    customWidth: number;
    customHeight: number;
    quality: 'low' | 'medium' | 'high' | 'auto';
    output_format: 'png' | 'jpeg' | 'webp';
    output_compression?: number;
    background: 'transparent' | 'opaque' | 'auto';
    moderation: 'low' | 'auto';
    model: GptImageModel;
    stream: boolean;
    partialImages: 1 | 2 | 3;
};

type GenerationFormProps = {
    onSubmit: (data: GenerationFormData) => void;
    isLoading: boolean;
    currentMode: 'generate' | 'edit';
    onModeChange: (mode: 'generate' | 'edit') => void;
    isPasswordRequiredByBackend: boolean | null;
    clientPasswordHash: string | null;
    onOpenPasswordDialog: () => void;
    model: GenerationFormData['model'];
    prompt: string;
    setPrompt: React.Dispatch<React.SetStateAction<string>>;
    n: number[];
    setN: React.Dispatch<React.SetStateAction<number[]>>;
    size: GenerationFormData['size'];
    setSize: React.Dispatch<React.SetStateAction<GenerationFormData['size']>>;
    customWidth: number;
    setCustomWidth: React.Dispatch<React.SetStateAction<number>>;
    customHeight: number;
    setCustomHeight: React.Dispatch<React.SetStateAction<number>>;
    quality: GenerationFormData['quality'];
    setQuality: React.Dispatch<React.SetStateAction<GenerationFormData['quality']>>;
    outputFormat: GenerationFormData['output_format'];
    setOutputFormat: React.Dispatch<React.SetStateAction<GenerationFormData['output_format']>>;
    compression: number[];
    setCompression: React.Dispatch<React.SetStateAction<number[]>>;
    background: GenerationFormData['background'];
    setBackground: React.Dispatch<React.SetStateAction<GenerationFormData['background']>>;
    moderation: GenerationFormData['moderation'];
    setModeration: React.Dispatch<React.SetStateAction<GenerationFormData['moderation']>>;
    streamEnabled: boolean;
    setStreamEnabled: React.Dispatch<React.SetStateAction<boolean>>;
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

export function GenerationForm({
    onSubmit,
    isLoading,
    currentMode,
    onModeChange,
    isPasswordRequiredByBackend,
    clientPasswordHash,
    onOpenPasswordDialog,
    model,
    prompt,
    n,
    setN,
    size,
    setSize,
    customWidth,
    setCustomWidth,
    customHeight,
    setCustomHeight,
    quality,
    setQuality,
    outputFormat,
    setOutputFormat,
    compression,
    setCompression,
    background,
    setBackground,
    moderation,
    setModeration,
    streamEnabled,
    setStreamEnabled
}: GenerationFormProps) {
    const { t } = useI18n();
    const showCompression = outputFormat === 'jpeg' || outputFormat === 'webp';
    const isGptImage2 = model === 'gpt-image-2';
    const supportsCustomSize = true;
    const customSizeValidation =
        size === 'custom' ? validateGptImage2Size(customWidth, customHeight) : { valid: true as const };
    const customSizeInvalid = size === 'custom' && !customSizeValidation.valid;

    // Reset transparent background when switching to gpt-image-2 (not supported)
    React.useEffect(() => {
        if (isGptImage2 && background === 'transparent') {
            setBackground('auto');
        }
    }, [isGptImage2, background, setBackground]);

    React.useEffect(() => {
        if (n[0] !== 1 && streamEnabled) {
            setStreamEnabled(false);
        }
    }, [n, streamEnabled, setStreamEnabled]);

    const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (customSizeInvalid) {
            return;
        }
        const formData: GenerationFormData = {
            prompt,
            n: n[0],
            size,
            customWidth,
            customHeight,
            quality,
            output_format: outputFormat,
            background,
            moderation,
            model,
            stream: streamEnabled && n[0] === 1,
            partialImages: 2
        };
        if (showCompression) {
            formData.output_compression = compression[0];
        }
        onSubmit(formData);
    };

    const customPixelCount = customWidth * customHeight;
    const customPixelPercent = ((customPixelCount / 8_294_400) * 100).toFixed(1);
    const customRatio =
        customWidth > 0 && customHeight > 0
            ? (Math.max(customWidth, customHeight) / Math.min(customWidth, customHeight)).toFixed(2)
            : null;

    return (
        <Card className='flex h-full w-full flex-col overflow-hidden rounded-none border-0 bg-transparent shadow-none'>
            <CardHeader className='hidden items-start justify-between border-b border-slate-200 pb-4 dark:border-white/10'>
                <div>
                    <div className='flex items-center'>
                        <CardTitle className='py-1 text-lg font-medium text-slate-900 dark:text-white'>
                            {t('form.generate.title')}
                        </CardTitle>
                        {isPasswordRequiredByBackend && (
                            <Button
                                variant='ghost'
                                size='icon'
                                onClick={onOpenPasswordDialog}
                                className='ml-2 text-slate-500 hover:text-slate-900 dark:text-white/60 dark:hover:text-white'
                                aria-label={t('page.configurePassword')}>
                                {clientPasswordHash ? <Lock className='h-4 w-4' /> : <LockOpen className='h-4 w-4' />}
                            </Button>
                        )}
                    </div>
                    <CardDescription className='mt-1 text-slate-500 dark:text-white/60'>
                        {t('form.generate.description')}
                    </CardDescription>
                </div>
                <ModeToggle currentMode={currentMode} onModeChange={onModeChange} />
            </CardHeader>
            <form onSubmit={handleSubmit} className='flex h-full flex-1 flex-col overflow-hidden'>
                <CardContent className='flex-1 space-y-3 overflow-y-auto p-0 pr-1'>
                    <div className='space-y-5'>
                            <div className='space-y-2'>
                                <Label htmlFor='n-slider' className='text-slate-700 dark:text-white'>
                                    {t('form.numberOfImages', { count: n[0] })}
                                </Label>
                                <Slider
                                    id='n-slider'
                                    min={1}
                                    max={10}
                                    step={1}
                                    value={n}
                                    onValueChange={setN}
                                    disabled={isLoading}
                                    className='mt-2 [&>button]:border-[#2563eb] [&>button]:bg-[#2563eb] [&>button]:ring-offset-white dark:[&>button]:border-white/20 dark:[&>button]:bg-white dark:[&>button]:ring-offset-[#0f1115] [&>span:first-child]:h-1 [&>span:first-child>span]:bg-[#2563eb] dark:[&>span:first-child>span]:bg-white'
                                />
                            </div>

                            <div className='flex items-start gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-white/[0.03]'>
                                <Checkbox
                                    id='stream-enabled'
                                    checked={streamEnabled}
                                    onCheckedChange={(checked) => setStreamEnabled(checked === true)}
                                    disabled={isLoading || n[0] !== 1}
                                    className='mt-0.5 border-slate-300 data-[state=checked]:border-[#2563eb] data-[state=checked]:bg-[#2563eb] data-[state=checked]:text-white dark:border-white/40 dark:data-[state=checked]:border-white dark:data-[state=checked]:bg-white dark:data-[state=checked]:text-black'
                                />
                                <div className='space-y-1'>
                                    <Label htmlFor='stream-enabled' className='cursor-pointer text-sm text-slate-700 dark:text-white'>
                                        {t('form.enableStreaming')}
                                    </Label>
                                    <p className='text-xs text-slate-500 dark:text-white/50'>
                                        {n[0] === 1 ? t('form.streamingTooltip') : t('form.streamingSingleTooltip')}
                                    </p>
                                </div>
                            </div>

                            <div className='space-y-3'>
                                <Label className='block text-slate-700 dark:text-white'>{t('common.size')}</Label>
                                <RadioGroup
                                    value={size}
                                    onValueChange={(value) => setSize(value as GenerationFormData['size'])}
                                    disabled={isLoading}
                                    className='grid grid-cols-2 gap-2'>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <div>
                                                <RadioItemWithIcon
                                                    value='square'
                                                    id='size-square'
                                                    label={t('common.square')}
                                                    Icon={Square}
                                                />
                                            </div>
                                        </TooltipTrigger>
                                        <TooltipContent>{getPresetTooltip('square', model)}</TooltipContent>
                                    </Tooltip>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <div>
                                                <RadioItemWithIcon
                                                    value='landscape'
                                                    id='size-landscape'
                                                    label={t('common.landscape')}
                                                    Icon={RectangleHorizontal}
                                                />
                                            </div>
                                        </TooltipTrigger>
                                        <TooltipContent>{getPresetTooltip('landscape', model)}</TooltipContent>
                                    </Tooltip>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <div>
                                                <RadioItemWithIcon
                                                    value='portrait'
                                                    id='size-portrait'
                                                    label={t('common.portrait')}
                                                    Icon={RectangleVertical}
                                                />
                                            </div>
                                        </TooltipTrigger>
                                        <TooltipContent>{getPresetTooltip('portrait', model)}</TooltipContent>
                                    </Tooltip>
                                    {supportsCustomSize && (
                                        <RadioItemWithIcon
                                            value='custom'
                                            id='size-custom'
                                            label={t('common.custom')}
                                            Icon={SquareDashed}
                                        />
                                    )}
                                </RadioGroup>
                                {supportsCustomSize && size === 'custom' && (
                                    <div className='space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-white/[0.03]'>
                                        <div className='flex items-center gap-3'>
                                            <div className='flex-1 space-y-1'>
                                                <Label htmlFor='custom-width' className='text-xs text-slate-500 dark:text-white/70'>
                                                    {t('common.width')}
                                                </Label>
                                                <Input
                                                    id='custom-width'
                                                    type='number'
                                                    min={16}
                                                    max={3840}
                                                    step={16}
                                                    value={customWidth}
                                                    onChange={(e) => setCustomWidth(parseInt(e.target.value, 10) || 0)}
                                                    disabled={isLoading}
                                                    className='rounded-md border-slate-200 bg-white text-slate-900 dark:border-white/10 dark:bg-white/[0.03] dark:text-white'
                                                />
                                            </div>
                                            <span className='pt-5 text-slate-400 dark:text-white/60'>×</span>
                                            <div className='flex-1 space-y-1'>
                                                <Label htmlFor='custom-height' className='text-xs text-slate-500 dark:text-white/70'>
                                                    {t('common.height')}
                                                </Label>
                                                <Input
                                                    id='custom-height'
                                                    type='number'
                                                    min={16}
                                                    max={3840}
                                                    step={16}
                                                    value={customHeight}
                                                    onChange={(e) => setCustomHeight(parseInt(e.target.value, 10) || 0)}
                                                    disabled={isLoading}
                                                    className='rounded-md border-slate-200 bg-white text-slate-900 dark:border-white/10 dark:bg-white/[0.03] dark:text-white'
                                                />
                                            </div>
                                        </div>
                                        <p className='text-xs text-slate-500 dark:text-white/50'>
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
                                    <Label className='block text-slate-700 dark:text-white'>{t('common.quality')}</Label>
                                    <p className='mt-1 text-xs text-slate-500 dark:text-white/50'>
                                        {t('form.qualityDescription')}
                                    </p>
                                </div>
                                <RadioGroup
                                    value={quality}
                                    onValueChange={(value) => setQuality(value as GenerationFormData['quality'])}
                                    disabled={isLoading}
                                    className='grid grid-cols-2 gap-2'>
                                    <RadioItemWithIcon
                                        value='auto'
                                        id='quality-auto'
                                        label={t('common.auto')}
                                        Icon={Sparkles}
                                    />
                                    <RadioItemWithIcon value='low' id='quality-low' label={t('common.low')} Icon={Tally1} />
                                    <RadioItemWithIcon
                                        value='medium'
                                        id='quality-medium'
                                        label={t('common.medium')}
                                        Icon={Tally2}
                                    />
                                    <RadioItemWithIcon value='high' id='quality-high' label={t('common.high')} Icon={Tally3} />
                                </RadioGroup>
                            </div>

                    {!isGptImage2 && (
                        <div className='space-y-3'>
                            <Label className='block text-slate-700 dark:text-white'>{t('common.background')}</Label>
                            <RadioGroup
                                value={background}
                                onValueChange={(value) => setBackground(value as GenerationFormData['background'])}
                                disabled={isLoading}
                                className='grid grid-cols-2 gap-2'>
                                <RadioItemWithIcon value='auto' id='bg-auto' label={t('common.auto')} Icon={Sparkles} />
                                <RadioItemWithIcon
                                    value='opaque'
                                    id='bg-opaque'
                                    label={t('common.opaque')}
                                    Icon={BrickWall}
                                />
                                <RadioItemWithIcon
                                    value='transparent'
                                    id='bg-transparent'
                                    label={t('common.transparent')}
                                    Icon={Eraser}
                                />
                            </RadioGroup>
                        </div>
                    )}

                    <div className='space-y-3'>
                        <Label className='block text-slate-700 dark:text-white'>{t('common.outputFormat')}</Label>
                        <RadioGroup
                            value={outputFormat}
                            onValueChange={(value) => setOutputFormat(value as GenerationFormData['output_format'])}
                            disabled={isLoading}
                            className='grid grid-cols-2 gap-2'>
                            <RadioItemWithIcon value='png' id='format-png' label='PNG' Icon={FileImage} />
                            <RadioItemWithIcon value='jpeg' id='format-jpeg' label='JPEG' Icon={FileImage} />
                            <RadioItemWithIcon value='webp' id='format-webp' label='WebP' Icon={FileImage} />
                        </RadioGroup>
                    </div>

                    {showCompression && (
                        <div className='space-y-2 pt-2 transition-opacity duration-300'>
                            <Label htmlFor='compression-slider' className='text-slate-700 dark:text-white'>
                                {t('common.compression')}: {compression[0]}%
                            </Label>
                            <Slider
                                id='compression-slider'
                                min={0}
                                max={100}
                                step={1}
                                value={compression}
                                onValueChange={setCompression}
                                disabled={isLoading}
                                className='mt-2 [&>button]:border-[#2563eb] [&>button]:bg-[#2563eb] [&>button]:ring-offset-white dark:[&>button]:border-white/20 dark:[&>button]:bg-white dark:[&>button]:ring-offset-[#0f1115] [&>span:first-child]:h-1 [&>span:first-child>span]:bg-[#2563eb] dark:[&>span:first-child>span]:bg-white'
                            />
                        </div>
                    )}

                            <div className='space-y-3'>
                                <Label className='block text-slate-700 dark:text-white'>{t('common.moderationLevel')}</Label>
                                <RadioGroup
                                    value={moderation}
                                    onValueChange={(value) => setModeration(value as GenerationFormData['moderation'])}
                                    disabled={isLoading}
                                    className='grid grid-cols-2 gap-2'>
                                    <RadioItemWithIcon
                                        value='auto'
                                        id='mod-auto'
                                        label={t('common.auto')}
                                        Icon={ShieldCheck}
                                    />
                                    <RadioItemWithIcon
                                        value='low'
                                        id='mod-low'
                                        label={t('common.low')}
                                        Icon={ShieldAlert}
                                    />
                                </RadioGroup>
                            </div>
                    </div>
                </CardContent>
                <CardFooter className='hidden'>
                    <Button
                        type='submit'
                        disabled={isLoading || !prompt || customSizeInvalid}
                        translate='no'
                        className='flex w-full items-center justify-center gap-2 rounded-md bg-[#2563eb] text-[#ffffff] hover:bg-[#1d4ed8] disabled:bg-slate-200 disabled:text-slate-500 dark:bg-white dark:text-[#0f172a] dark:hover:bg-white/90 dark:disabled:bg-white/10 dark:disabled:text-white/40'>
                        <Loader2
                            aria-hidden='true'
                            className={`h-4 w-4 ${isLoading ? 'animate-spin opacity-100' : 'hidden opacity-0'}`}
                        />
                        <span>{isLoading ? t('form.generate.buttonLoading') : t('form.generate.button')}</span>
                    </Button>
                </CardFooter>
            </form>
        </Card>
    );
}
