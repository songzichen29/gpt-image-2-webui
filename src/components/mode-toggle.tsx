'use client';

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useI18n } from '@/lib/i18n';

type ModeToggleProps = {
    currentMode: 'generate' | 'edit';
    onModeChange: (mode: 'generate' | 'edit') => void;
};

export function ModeToggle({ currentMode, onModeChange }: ModeToggleProps) {
    const { t } = useI18n();

    return (
        <Tabs
            value={currentMode}
            onValueChange={(value) => onModeChange(value as 'generate' | 'edit')}
            className='w-auto'>
            <TabsList className='grid h-auto grid-cols-2 gap-1 rounded-md border border-slate-200 bg-slate-50 p-1 dark:border-white/10 dark:bg-white/[0.03]'>
                <TabsTrigger
                    value='generate'
                    className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                        currentMode === 'generate'
                            ? 'border-[#cddbf7] bg-[#edf3ff] text-[#2454c6] dark:border-white/20 dark:bg-white/10 dark:text-white'
                            : 'border-transparent bg-transparent text-slate-500 hover:bg-white hover:text-slate-900 dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-white/85'
                    } `}>
                    {t('mode.generate')}
                </TabsTrigger>
                <TabsTrigger
                    value='edit'
                    className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                        currentMode === 'edit'
                            ? 'border-[#cddbf7] bg-[#edf3ff] text-[#2454c6] dark:border-white/20 dark:bg-white/10 dark:text-white'
                            : 'border-transparent bg-transparent text-slate-500 hover:bg-white hover:text-slate-900 dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-white/85'
                    } `}>
                    {t('mode.edit')}
                </TabsTrigger>
            </TabsList>
        </Tabs>
    );
}
