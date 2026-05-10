'use client';

import { useI18n } from '@/lib/i18n';

export function HelpNotes() {
    const { t } = useI18n();

    const notes = [
        {
            title: t('home.getApiKey'),
            description: t('help.getKey'),
            href: 'https://api.dwai.cloud',
            linkLabel: t('help.getKeyLinkLabel')
        },
        { title: t('history.serverExpiryNoticeTitle'), description: t('help.retentionSimple') }
    ];

    return (
        <div className='grid gap-2 md:grid-cols-2'>
            {notes.map((note) => (
                <div
                    key={note.title}
                    className='rounded-md border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-white/[0.035]'>
                    <p className='text-[12px] font-medium text-slate-800 dark:text-white/85'>{note.title}</p>
                    <p className='mt-1.5 text-[12px] leading-5 text-slate-500 dark:text-white/55'>{note.description}</p>
                    {'href' in note && note.href && (
                        <a
                            href={note.href}
                            target='_blank'
                            rel='noreferrer'
                            className='mt-2 inline-flex text-[12px] text-[#2563eb] hover:underline dark:text-white'>
                            {note.linkLabel}
                        </a>
                    )}
                </div>
            ))}
        </div>
    );
}
