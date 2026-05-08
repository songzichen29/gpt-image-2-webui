'use client';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { LanguagePreference } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n';
import { ChevronDown, ChevronLeft, ExternalLink, Eye, EyeOff, Loader2 } from 'lucide-react';
import * as React from 'react';

type PreferencesPanelProps = {
    apiKeyDraft: string;
    configuredBaseUrl: string;
    isFetchingModels: boolean;
    isMobile?: boolean;
    isModelMenuOpen: boolean;
    keysUrl: string | null;
    languagePreference: LanguagePreference;
    modelDraft: string;
    modelFetchError: string | null;
    modelMenuRef: React.RefObject<HTMLDivElement | null>;
    onApiKeyChange: (value: string) => void;
    onClose: () => void;
    onLanguagePreferenceChange: (value: LanguagePreference) => void;
    onModelBlur: (event: React.FocusEvent<HTMLInputElement>) => void;
    onModelChange: (value: string) => void;
    onModelSelect: (value: string) => void;
    onToggleApiKeyVisibility: () => void;
    onToggleModelMenu: () => void;
    open: boolean;
    onSave: () => void;
    selectedModel: string;
    showApiKey: boolean;
    visibleModelOptions: string[];
};

function PanelBody({
    apiKeyDraft,
    configuredBaseUrl,
    isFetchingModels,
    isMobile = false,
    isModelMenuOpen,
    keysUrl,
    languagePreference,
    modelDraft,
    modelFetchError,
    modelMenuRef,
    onApiKeyChange,
    onClose,
    onLanguagePreferenceChange,
    onModelBlur,
    onModelChange,
    onModelSelect,
    onSave,
    onToggleApiKeyVisibility,
    onToggleModelMenu,
    selectedModel,
    showApiKey,
    visibleModelOptions
}: Omit<PreferencesPanelProps, 'open'>) {
    const { t } = useI18n();
    let fallbackKeysUrl: string | null = null;
    if (!keysUrl && configuredBaseUrl) {
        try {
            fallbackKeysUrl = new URL('/keys', new URL(configuredBaseUrl).origin).toString();
        } catch {
            fallbackKeysUrl = null;
        }
    }
    const resolvedKeysUrl = keysUrl || fallbackKeysUrl;

    return (
        <div className='flex h-full flex-col bg-[#fbfbfc] text-slate-900 dark:bg-[#0f1115] dark:text-white'>
            <div className='flex h-12 items-center gap-3 border-b border-slate-200 px-4 dark:border-white/10'>
                {isMobile && (
                    <button
                        type='button'
                        onClick={onClose}
                        className='flex h-9 w-9 items-center justify-center rounded-md text-slate-700 hover:bg-slate-100 dark:text-white/80 dark:hover:bg-white/10'>
                        <ChevronLeft className='h-5 w-5' />
                    </button>
                )}
                <DialogTitle className='text-base font-semibold text-slate-900 dark:text-white'>
                    {t('home.openSettings')}
                </DialogTitle>
            </div>

            <div className='min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3'>
                <div className='rounded-md border border-slate-200 bg-white dark:border-white/10 dark:bg-white/[0.02]'>
                    <div className='border-b border-slate-200 px-3 py-2 dark:border-white/10'>
                        <Label className='text-sm font-medium text-slate-700 dark:text-white/85'>{t('common.model')}</Label>
                    </div>
                    <div className='px-3 py-2.5'>
                        <div ref={modelMenuRef} className='relative min-w-0'>
                            <div className='flex gap-2'>
                                <Input
                                    id='home-model'
                                    value={modelDraft}
                                    onChange={(event) => onModelChange(event.target.value)}
                                    onBlur={onModelBlur}
                                    placeholder={t('settings.modelPlaceholder')}
                                    className='h-9 rounded-md border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 dark:border-white/15 dark:bg-white/5 dark:text-white dark:placeholder:text-white/30'
                                />
                                <Button
                                    type='button'
                                    variant='outline'
                                    size='icon'
                                    onClick={onToggleModelMenu}
                                    className='h-9 w-9 rounded-md border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-white/15 dark:bg-white/5 dark:text-white/80 dark:hover:bg-white/10'
                                    aria-label={t('settings.models')}>
                                    {isFetchingModels ? (
                                        <Loader2 className='h-4 w-4 animate-spin' />
                                    ) : (
                                        <ChevronDown className='h-4 w-4' />
                                    )}
                                </Button>
                            </div>
                            {isModelMenuOpen && (
                                <div className='absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-[#11151c]'>
                                    {visibleModelOptions.length > 0 ? (
                                        visibleModelOptions.map((option) => (
                                            <button
                                                key={option}
                                                type='button'
                                                onMouseDown={(event) => event.preventDefault()}
                                                onClick={() => onModelSelect(option)}
                                                className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors ${
                                                    option === selectedModel
                                                        ? 'bg-[#edf3ff] text-[#2454c6] dark:bg-white/10 dark:text-white'
                                                        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-white/70 dark:hover:bg-white/5 dark:hover:text-white'
                                                }`}>
                                                <span className='truncate'>{option}</span>
                                            </button>
                                        ))
                                    ) : (
                                        <div className='px-3 py-2 text-sm text-slate-500 dark:text-white/45'>
                                            {isFetchingModels ? t('settings.modelsLoading') : modelFetchError || t('settings.noModelsFound')}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <div className='rounded-md border border-slate-200 bg-white dark:border-white/10 dark:bg-white/[0.02]'>
                    <div className='border-b border-slate-200 px-3 py-2 dark:border-white/10'>
                        <Label className='text-sm font-medium text-slate-700 dark:text-white/85'>{t('settings.baseUrl')}</Label>
                    </div>
                    <div className='px-3 py-2.5'>
                        <Input
                            type='url'
                            value={configuredBaseUrl}
                            placeholder={t('settings.baseUrlPlaceholder')}
                            readOnly
                            className='h-9 rounded-md border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 dark:border-white/15 dark:bg-white/5 dark:text-white dark:placeholder:text-white/30'
                        />
                    </div>
                </div>

                <div className='rounded-md border border-slate-200 bg-white dark:border-white/10 dark:bg-white/[0.02]'>
                    <div className='border-b border-slate-200 px-3 py-2 dark:border-white/10'>
                        <Label className='text-sm font-medium text-slate-700 dark:text-white/85'>{t('settings.apiKey')}</Label>
                    </div>
                    <div className='px-3 py-2.5'>
                        <div className='flex gap-2'>
                            <Input
                                type={showApiKey ? 'text' : 'password'}
                                value={apiKeyDraft}
                                onChange={(event) => onApiKeyChange(event.target.value)}
                                placeholder={t('settings.apiKeyPlaceholder')}
                                className='h-9 rounded-md border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 dark:border-white/15 dark:bg-white/5 dark:text-white dark:placeholder:text-white/30'
                            />
                            <Button
                                type='button'
                                variant='outline'
                                size='icon'
                                onClick={onToggleApiKeyVisibility}
                                className='h-9 w-9 rounded-md border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-white/15 dark:bg-white/5 dark:text-white/80 dark:hover:bg-white/10'
                                aria-label={showApiKey ? t('home.hideApiKey') : t('home.showApiKey')}>
                                {showApiKey ? <EyeOff className='h-4 w-4' /> : <Eye className='h-4 w-4' />}
                            </Button>
                        </div>
                        <div className='mt-3'>
                            <Button
                                asChild={Boolean(resolvedKeysUrl)}
                                type='button'
                                variant='outline'
                                disabled={!resolvedKeysUrl}
                                className='h-10 rounded-md border-slate-200 bg-white px-3 text-slate-700 hover:bg-slate-50 dark:border-white/15 dark:bg-white/5 dark:text-white/80 dark:hover:bg-white/10'>
                                {resolvedKeysUrl ? (
                                    <a
                                        href={resolvedKeysUrl}
                                        target='_blank'
                                        rel='noreferrer'
                                        aria-label={t('home.getApiKeyAria')}>
                                        <ExternalLink className='h-3.5 w-3.5' />
                                        {t('home.getApiKey')}
                                    </a>
                                ) : (
                                    <>
                                        <ExternalLink className='h-3.5 w-3.5' />
                                        {t('home.getApiKey')}
                                    </>
                                )}
                            </Button>
                        </div>
                    </div>
                </div>

                <div className='rounded-md border border-slate-200 bg-white dark:border-white/10 dark:bg-white/[0.02]'>
                    <div className='border-b border-slate-200 px-3 py-2 dark:border-white/10'>
                        <Label className='text-sm font-medium text-slate-700 dark:text-white/85'>{t('settings.language')}</Label>
                    </div>
                    <div className='px-3 py-2.5'>
                        <Select value={languagePreference} onValueChange={(value) => onLanguagePreferenceChange(value as LanguagePreference)}>
                            <SelectTrigger className='h-9 rounded-md border-slate-200 bg-white text-slate-900 dark:border-white/15 dark:bg-white/5 dark:text-white'>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent className='border-slate-200 bg-white text-slate-900 dark:border-white/15 dark:bg-[#11151c] dark:text-white'>
                                <SelectItem value='system'>{t('settings.system')}</SelectItem>
                                <SelectItem value='en'>{t('settings.english')}</SelectItem>
                                <SelectItem value='zh'>{t('settings.chinese')}</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>

            </div>

            <div className='border-t border-slate-200 px-4 py-3 dark:border-white/10'>
                <Button
                    type='button'
                    onClick={onSave}
                    className='h-9 w-full rounded-md bg-[#2563eb] text-[#ffffff] hover:bg-[#1d4ed8] dark:bg-white dark:text-[#0f172a] dark:hover:bg-white/90'>
                    {t('settings.saveSettings')}
                </Button>
            </div>
        </div>
    );
}

export function PreferencesPanel(props: PreferencesPanelProps) {
    const content = <PanelBody {...props} />;

    if (props.isMobile) {
        return (
            <Dialog open={props.open} onOpenChange={(open) => !open && props.onClose()}>
                <DialogContent className='h-dvh max-w-full translate-x-[-50%] translate-y-[-50%] rounded-none border-0 p-0 shadow-none sm:max-w-full'>
                    {content}
                </DialogContent>
            </Dialog>
        );
    }

    return (
        <Dialog open={props.open} onOpenChange={(open) => !open && props.onClose()}>
                <DialogContent className='overflow-hidden rounded-md border border-slate-200 bg-[#fbfbfc] p-0 shadow-sm sm:max-w-[560px] dark:border-white/10 dark:bg-[#0f1115]'>
                <DialogHeader className='sr-only'>
                    <DialogTitle>{props.selectedModel}</DialogTitle>
                </DialogHeader>
                {content}
            </DialogContent>
        </Dialog>
    );
}
