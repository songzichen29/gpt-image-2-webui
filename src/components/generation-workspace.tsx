'use client';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useI18n } from '@/lib/i18n';
import { Eraser, FileImage, Loader2 } from 'lucide-react';

type GenerationWorkspaceProps = {
    customSizeInvalid: boolean;
    isLoading: boolean;
    mode: 'generate' | 'edit';
    onGenerate: () => void;
    onSwitchToGenerate: () => void;
    onSwitchToEdit: () => void;
    prompt: string;
    setPrompt: (value: string) => void;
};

export function GenerationWorkspace({
    customSizeInvalid,
    isLoading,
    mode,
    onGenerate,
    onSwitchToGenerate,
    onSwitchToEdit,
    prompt,
    setPrompt
}: GenerationWorkspaceProps) {
    const { t } = useI18n();

    return (
        <>
            <div className='border border-slate-200 bg-[#fbfbfc] p-3 lg:p-4 dark:border-white/10 dark:bg-[#0f1115]'>
                <div className='space-y-1.5'>
                    <Label htmlFor='prompt' className='sr-only'>
                        {t('common.prompt')}
                    </Label>
                    <Textarea
                        id='prompt'
                        placeholder={t('form.generate.promptPlaceholder')}
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        required
                        disabled={isLoading}
                        className='min-h-[88px] rounded-md border-slate-200 bg-white px-3 py-3 text-[13px] text-slate-900 placeholder:text-slate-400 lg:min-h-[132px] dark:border-white/10 dark:bg-white/[0.03] dark:text-white dark:placeholder:text-white/30'
                    />
                </div>

                <div className='mt-3 flex flex-wrap items-center gap-2 lg:mt-4'>
                    <Button
                        type='button'
                        variant='outline'
                        size='sm'
                        onClick={onSwitchToGenerate}
                        className={`h-9 rounded-md border-slate-200 px-3 text-[12px] ${
                            mode === 'generate'
                                ? 'border-[#cddbf7] bg-[#edf3ff] text-[#2454c6] dark:border-white/20 dark:bg-white/10 dark:text-white'
                                : 'bg-[#fbfbfc] text-slate-700 hover:bg-white dark:border-white/10 dark:bg-white/[0.03] dark:text-white/80 dark:hover:bg-white/10'
                        }`}>
                        <FileImage className='h-4 w-4' />
                        {t('workspace.generateMode')}
                    </Button>
                    <Button
                        type='button'
                        variant='outline'
                        size='sm'
                        onClick={onSwitchToEdit}
                        className={`h-9 rounded-md border-slate-200 px-3 text-[12px] ${
                            mode === 'edit'
                                ? 'border-[#cddbf7] bg-[#edf3ff] text-[#2454c6] dark:border-white/20 dark:bg-white/10 dark:text-white'
                                : 'bg-[#fbfbfc] text-slate-700 hover:bg-white dark:border-white/10 dark:bg-white/[0.03] dark:text-white/80 dark:hover:bg-white/10'
                        }`}>
                        <Eraser className='h-4 w-4' />
                        {t('workspace.imageEdit')}
                    </Button>
                    <Button
                        type='button'
                        onClick={onGenerate}
                        disabled={isLoading || !prompt || customSizeInvalid}
                        translate='no'
                        className='ml-auto h-10 rounded-md bg-[#2563eb] px-5 text-[13px] text-[#ffffff] hover:bg-[#1d4ed8] disabled:bg-slate-200 disabled:text-slate-500 dark:bg-white dark:text-[#0f172a] dark:hover:bg-white/90 dark:disabled:bg-white/10 dark:disabled:text-white/40'>
                        <Loader2
                            aria-hidden='true'
                            className={`h-4 w-4 ${isLoading ? 'animate-spin opacity-100' : 'hidden opacity-0'}`}
                        />
                        <span>{mode === 'edit' ? t('form.edit.button') : t('form.generate.button')}</span>
                    </Button>
                </div>
            </div>
        </>
    );
}
