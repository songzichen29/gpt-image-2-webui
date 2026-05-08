'use client';

import { CircleHelp, Clock3, ChevronLeft, ImagePlus } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';

type AppSidebarProps = {
    isMobile?: boolean;
    onClose?: () => void;
    onHelpClick: () => void;
    onHistoryClick: () => void;
    onWorkspaceClick: () => void;
};

export function AppSidebar({ isMobile = false, onClose, onHelpClick, onHistoryClick, onWorkspaceClick }: AppSidebarProps) {
    const { t } = useI18n();

    return (
        <aside
            className={cn(
                'border-r border-slate-200 bg-white dark:border-white/10 dark:bg-[#0f1115]',
                isMobile ? 'flex min-h-screen w-[272px] flex-col' : 'hidden min-h-screen lg:flex lg:flex-col'
            )}>
            <div className='flex items-center gap-3 px-6 py-6'>
                <div className='flex h-10 w-10 items-center justify-center rounded-lg bg-[#5b8cff] text-xs font-semibold text-white'>
                    AI
                </div>
                <div className='min-w-0'>
                    <p className='truncate text-base font-semibold text-slate-900 dark:text-white'>{t('home.title')}</p>
                </div>
            </div>

            <nav className='space-y-3 px-4 pt-4'>
                <button
                    type='button'
                    onClick={onWorkspaceClick}
                    className='flex w-full items-center gap-3 rounded-2xl bg-[#eef4ff] px-4 py-3 text-left text-sm font-medium text-[#4f7fff] dark:bg-white/10 dark:text-white'>
                    <ImagePlus className='h-4 w-4' />
                    {t('nav.generate')}
                </button>
                <button
                    type='button'
                    onClick={onHistoryClick}
                    className='flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm text-slate-600 transition-colors hover:bg-[#f6f7f9] hover:text-slate-900 dark:text-white/65 dark:hover:bg-white/5 dark:hover:text-white'>
                    <Clock3 className='h-4 w-4' />
                    {t('nav.history')}
                </button>
                <button
                    type='button'
                    onClick={onHelpClick}
                    className='flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm text-slate-600 transition-colors hover:bg-[#f6f7f9] hover:text-slate-900 dark:text-white/65 dark:hover:bg-white/5 dark:hover:text-white'>
                    <CircleHelp className='h-4 w-4' />
                    {t('nav.help')}
                </button>
            </nav>

            <div className='mt-auto px-6 py-6'>
                <button
                    type='button'
                    onClick={onClose}
                    className='flex items-center gap-2 text-sm text-slate-500 dark:text-white/45'>
                    <ChevronLeft className='h-4 w-4' />
                    收起侧边栏
                </button>
            </div>
        </aside>
    );
}
