'use client';

import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { CircleHelp, Clock3, Moon, Settings2, Sun } from 'lucide-react';
import * as React from 'react';

type AppTopbarProps = {
    currentTheme: string;
    menuLabel: string;
    onOpenHelp: () => void;
    onOpenHistory: () => void;
    onOpenSettings: () => void;
    onToggleTheme: () => void;
};

function useIsEmbeddedPage() {
    const [isEmbeddedPage, setIsEmbeddedPage] = React.useState(false);

    React.useEffect(() => {
        try {
            setIsEmbeddedPage(window.self !== window.top);
        } catch {
            setIsEmbeddedPage(true);
        }
    }, []);

    return isEmbeddedPage;
}

export function AppTopbar({
    currentTheme,
    menuLabel,
    onOpenHelp,
    onOpenHistory,
    onOpenSettings,
    onToggleTheme
}: AppTopbarProps) {
    const { t } = useI18n();
    const isEmbeddedPage = useIsEmbeddedPage();
    const actionLabelClassName = isEmbeddedPage ? 'hidden md:inline' : 'hidden sm:inline';

    return (
        <header className='z-20 shrink-0 border-b border-slate-200 bg-[#fbfbfc] dark:border-white/10 dark:bg-[#0f1115]'>
            <div className='flex h-14 items-center justify-between px-3 lg:px-4'>
                <span className='min-w-0 truncate text-[13px] font-medium text-slate-700 dark:text-white/80'>{menuLabel}</span>

                <div className={cn('flex shrink-0 items-center gap-1.5', isEmbeddedPage && 'pr-40')}>
                    <Button
                        type='button'
                        variant='outline'
                        onClick={onOpenHelp}
                        className='h-9 rounded-md border-slate-200 bg-[#fbfbfc] px-2.5 text-[12px] text-slate-700 hover:bg-white dark:border-white/15 dark:bg-white/5 dark:text-white/80 dark:hover:bg-white/10'>
                        <CircleHelp className='h-4 w-4' />
                        <span className={actionLabelClassName}>{t('nav.help')}</span>
                    </Button>
                    <Button
                        type='button'
                        variant='outline'
                        onClick={onOpenHistory}
                        className='h-9 rounded-md border-slate-200 bg-[#fbfbfc] px-2.5 text-[12px] text-slate-700 hover:bg-white dark:border-white/15 dark:bg-white/5 dark:text-white/80 dark:hover:bg-white/10'>
                        <Clock3 className='h-4 w-4' />
                        <span className={actionLabelClassName}>{t('nav.history')}</span>
                    </Button>
                    <Button
                        type='button'
                        variant='outline'
                        onClick={onOpenSettings}
                        className='h-9 rounded-md border-slate-200 bg-[#fbfbfc] px-2.5 text-[12px] text-slate-700 hover:bg-white dark:border-white/15 dark:bg-white/5 dark:text-white/80 dark:hover:bg-white/10'>
                        <Settings2 className='h-4 w-4' />
                        <span className={actionLabelClassName}>{t('home.openSettings')}</span>
                    </Button>
                    <Button
                        type='button'
                        variant='outline'
                        size='icon'
                        onClick={onToggleTheme}
                        className='h-9 w-9 rounded-md border-slate-200 bg-[#fbfbfc] text-slate-700 hover:bg-white dark:border-white/15 dark:bg-white/5 dark:text-white/80 dark:hover:bg-white/10'
                        aria-label={t('home.toggleTheme')}>
                        {currentTheme === 'dark' ? <Moon className='h-4 w-4' /> : <Sun className='h-4 w-4' />}
                    </Button>
                </div>
            </div>
        </header>
    );
}
