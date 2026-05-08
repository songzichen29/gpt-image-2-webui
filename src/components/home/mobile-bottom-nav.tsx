'use client';

import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import { Clock3, Eraser, Sparkles } from 'lucide-react';

type MobileBottomNavProps = {
    currentItem: 'generate' | 'edit' | 'history';
    onEditClick: () => void;
    onGenerateClick: () => void;
    onHistoryClick: () => void;
};

export function MobileBottomNav({ currentItem, onEditClick, onGenerateClick, onHistoryClick }: MobileBottomNavProps) {
    const { t } = useI18n();
    const itemClass = (item: MobileBottomNavProps['currentItem']) =>
        cn(
            'flex h-12 flex-col items-center justify-center gap-0.5 text-[11px]',
            currentItem === item ? 'font-medium text-[#2563eb]' : 'text-slate-500 dark:text-white/55'
        );
    const iconClass = (item: MobileBottomNavProps['currentItem']) =>
        cn('h-4 w-4', currentItem === item ? 'text-[#2563eb]' : 'text-slate-400 dark:text-white/40');

    return (
        <nav
            className='fixed inset-x-0 bottom-0 z-[80] border-t border-slate-200 bg-white dark:border-white/10 dark:bg-[#0f1115] lg:hidden'
            style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
            <div className='grid min-h-12 grid-cols-3'>
                <button type='button' onClick={onGenerateClick} className={itemClass('generate')}>
                    <Sparkles className={iconClass('generate')} />
                    <span>{t('workspace.generateMode')}</span>
                </button>
                <button type='button' onClick={onEditClick} className={itemClass('edit')}>
                    <Eraser className={iconClass('edit')} />
                    <span>{t('workspace.imageEdit')}</span>
                </button>
                <button type='button' onClick={onHistoryClick} className={itemClass('history')}>
                    <Clock3 className={iconClass('history')} />
                    <span>{t('nav.history')}</span>
                </button>
            </div>
        </nav>
    );
}
