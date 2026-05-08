'use client';

import { useI18n } from '@/lib/i18n';
import { ChevronDown } from 'lucide-react';

type ApiInfoPanelProps = {
    durationText: string;
    errorText?: string;
    filenames?: string[];
    isOpen: boolean;
    rows: Array<[string, string]>;
    statusClassName: string;
    statusLabel: string;
    onToggle: () => void;
};

export function ApiInfoPanel({
    durationText,
    errorText,
    filenames,
    isOpen,
    rows,
    statusClassName,
    statusLabel,
    onToggle
}: ApiInfoPanelProps) {
    const { t } = useI18n();

    return (
        <section className='border border-slate-200 bg-[#fbfbfc] dark:border-white/10 dark:bg-[#0f1115]'>
            <button
                type='button'
                onClick={onToggle}
                className='flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-[12px] text-slate-700 hover:bg-white dark:text-white/80 dark:hover:bg-white/5'>
                <span className='flex min-w-0 items-center gap-2'>
                    <ChevronDown
                        className={`h-4 w-4 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                    />
                    <span className='font-medium'>{t('apiInfo.toggle')}</span>
                    {rows.length > 0 && (
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] ${statusClassName}`}>
                            {statusLabel}
                        </span>
                    )}
                </span>
                <span className='shrink-0 font-mono text-[12px] text-slate-400 dark:text-white/45'>{durationText}</span>
            </button>

            {isOpen && (
                <div className='border-t border-slate-200 p-3 dark:border-white/10'>
                    {rows.length === 0 ? (
                        <p className='text-xs text-slate-500 dark:text-white/45'>{t('apiInfo.empty')}</p>
                    ) : (
                        <div className='space-y-3'>
                            <div className='grid gap-2 text-[12px] sm:grid-cols-2 xl:grid-cols-3'>
                                {rows.map(([label, value]) => (
                                    <div
                                        key={label}
                                        className='min-w-0 border border-slate-200 bg-white px-3 py-2 dark:border-white/10 dark:bg-white/[0.035]'>
                                        <p className='truncate text-[11px] text-slate-500 dark:text-white/40'>{label}</p>
                                        <p className='mt-0.5 truncate font-mono text-[12px] font-medium text-slate-800 dark:text-white/80'>
                                            {value}
                                        </p>
                                    </div>
                                ))}
                            </div>
                            {filenames && filenames.length > 0 && (
                                <div className='border border-slate-200 bg-white px-3 py-2 text-[12px] dark:border-white/10 dark:bg-white/[0.035]'>
                                    <p className='mb-1 text-[11px] text-slate-500 dark:text-white/40'>{t('apiInfo.files')}</p>
                                    <div className='flex flex-wrap gap-1.5'>
                                        {filenames.map((filename) => (
                                            <span
                                                key={filename}
                                                className='border border-slate-200 px-1.5 py-0.5 font-mono text-[11px] text-slate-700 dark:border-white/10 dark:text-white/70'>
                                                {filename}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {errorText && (
                                <div className='rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-400/30 dark:bg-red-500/10 dark:text-red-200'>
                                    {errorText}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </section>
    );
}
