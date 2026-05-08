'use client';

import { EditingForm } from '@/components/editing-form';
import { GenerationForm } from '@/components/generation-form';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useI18n } from '@/lib/i18n';
import type * as React from 'react';

type MobileParametersPanelProps = {
    editingProps: React.ComponentProps<typeof EditingForm>;
    generationProps: React.ComponentProps<typeof GenerationForm>;
    mode: 'generate' | 'edit';
    onOpenChange: (open: boolean) => void;
    open: boolean;
};

export function MobileParametersPanel({
    editingProps,
    generationProps,
    mode,
    onOpenChange,
    open
}: MobileParametersPanelProps) {
    const { t } = useI18n();

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className='top-auto bottom-[calc(3rem+env(safe-area-inset-bottom))] left-0 z-[70] flex h-[58dvh] max-h-[58dvh] w-full max-w-none translate-x-0 translate-y-0 grid-cols-none flex-col gap-0 overflow-hidden overscroll-contain rounded-t-md rounded-b-none border-x-0 border-b-0 border-slate-200 bg-[#fbfbfc] p-0 shadow-sm duration-150 sm:max-w-none dark:border-white/10 dark:bg-[#0f1115]'>
                <DialogHeader className='shrink-0 border-b border-slate-200 px-3 py-2 text-left dark:border-white/10'>
                    <DialogTitle className='text-[13px] font-semibold text-slate-900 dark:text-white'>
                        {mode === 'edit' ? t('workspace.imageEdit') : t('workspace.generateMode')} {t('workspace.parameters')}
                    </DialogTitle>
                </DialogHeader>

                <div className='min-h-0 flex-1 overflow-hidden overscroll-contain p-3'>
                    <div className={mode === 'generate' ? 'block h-full min-h-0' : 'hidden'}>
                        <GenerationForm {...generationProps} />
                    </div>

                    <div className={mode === 'edit' ? 'block h-full min-h-0' : 'hidden'}>
                        <EditingForm {...editingProps} hideSubmit />
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
