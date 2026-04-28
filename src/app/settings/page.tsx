'use client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { defaultModelIds, useAppSettings, type AppSettings } from '@/lib/app-settings';
import { useI18n, type LanguagePreference } from '@/lib/i18n';
import { ArrowLeft, Eye, EyeOff, Info, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useRouter } from 'next/navigation';
import * as React from 'react';

function normalizeDraft(settings: AppSettings): AppSettings {
    return {
        baseUrl: settings.baseUrl,
        apiKey: settings.apiKey,
        models: settings.models.length > 0 ? settings.models : defaultModelIds
    };
}

export default function SettingsPage() {
    const router = useRouter();
    const { languagePreference, setLanguagePreference, t } = useI18n();
    const { settings, saveSettings, resetSettings } = useAppSettings();
    const { theme, setTheme } = useTheme();
    const [mounted, setMounted] = React.useState(false);
    const [draft, setDraft] = React.useState<AppSettings>(() => normalizeDraft(settings));
    const [modelInput, setModelInput] = React.useState('');
    const [showApiKey, setShowApiKey] = React.useState(false);
    const [statusMessage, setStatusMessage] = React.useState<string | null>(null);

    React.useEffect(() => {
        setMounted(true);
    }, []);

    React.useEffect(() => {
        setDraft(normalizeDraft(settings));
    }, [settings]);

    const currentTheme = mounted ? (theme ?? 'dark') : 'dark';

    const handleBack = () => {
        if (window.history.length > 1) {
            router.back();
            return;
        }

        router.push('/');
    };

    const handleAddModel = () => {
        const nextModel = modelInput.trim();
        if (!nextModel) {
            setStatusMessage(t('settings.emptyModel'));
            return;
        }

        if (draft.models.includes(nextModel)) {
            setStatusMessage(t('settings.duplicateModel'));
            return;
        }

        setDraft((currentDraft) => ({
            ...currentDraft,
            models: [...currentDraft.models, nextModel]
        }));
        setModelInput('');
        setStatusMessage(null);
    };

    const handleRemoveModel = (model: string) => {
        if (draft.models.length <= 1) {
            setStatusMessage(t('settings.modelsRequired'));
            return;
        }

        setDraft((currentDraft) => ({
            ...currentDraft,
            models: currentDraft.models.filter((item) => item !== model)
        }));
        setStatusMessage(null);
    };

    const handleSave = () => {
        const normalizedModels = draft.models.map((model) => model.trim()).filter(Boolean);
        if (normalizedModels.length === 0) {
            setStatusMessage(t('settings.modelsRequired'));
            return;
        }

        saveSettings({
            baseUrl: draft.baseUrl.trim(),
            apiKey: draft.apiKey.trim(),
            models: Array.from(new Set(normalizedModels))
        });
        setStatusMessage(t('settings.saved'));
    };

    const handleReset = () => {
        resetSettings();
        setModelInput('');
        setStatusMessage(t('settings.saved'));
    };

    return (
        <main className='min-h-screen bg-black p-4 text-white md:p-8'>
            <div className='mx-auto flex w-full max-w-3xl flex-col gap-6'>
                <header className='flex items-start justify-between gap-4 border-b border-white/10 pb-5'>
                    <div className='space-y-1'>
                        <Button
                            type='button'
                            variant='ghost'
                            onClick={handleBack}
                            className='-ml-3 text-white/70 hover:bg-white/10 hover:text-white'>
                            <ArrowLeft className='h-4 w-4' />
                            {t('settings.back')}
                        </Button>
                        <div>
                            <h1 className='text-2xl font-semibold tracking-normal text-white'>
                                {t('settings.pageTitle')}
                            </h1>
                            <p className='mt-1 text-sm text-white/60'>{t('settings.pageDescription')}</p>
                        </div>
                    </div>
                </header>

                <Alert className='border-amber-400/30 bg-amber-400/10 text-amber-100'>
                    <Info className='h-4 w-4' />
                    <AlertTitle>{t('settings.localOnlyTitle')}</AlertTitle>
                    <AlertDescription className='text-amber-100/80'>
                        {t('settings.localOnlyDescription')}
                    </AlertDescription>
                </Alert>

                <section className='space-y-5 rounded-lg border border-white/10 bg-black p-5'>
                    <div>
                        <h2 className='text-base font-medium text-white'>{t('settings.interface')}</h2>
                    </div>

                    <div className='grid gap-5 sm:grid-cols-2'>
                        <div className='space-y-2'>
                            <Label htmlFor='settings-language' className='text-white'>
                                {t('settings.language')}
                            </Label>
                            <Select
                                value={languagePreference}
                                onValueChange={(value) => setLanguagePreference(value as LanguagePreference)}>
                                <SelectTrigger
                                    id='settings-language'
                                    className='w-full border-white/20 bg-black text-white focus:border-white/50 focus:ring-white/50'>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent className='border-white/20 bg-black text-white'>
                                    <SelectItem value='system' className='focus:bg-white/10'>
                                        {t('settings.system')}
                                    </SelectItem>
                                    <SelectItem value='en' className='focus:bg-white/10'>
                                        {t('settings.english')}
                                    </SelectItem>
                                    <SelectItem value='zh' className='focus:bg-white/10'>
                                        {t('settings.chinese')}
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                            <p className='text-xs text-white/50'>{t('settings.languageDescription')}</p>
                        </div>

                        <div className='space-y-2'>
                            <Label htmlFor='settings-theme' className='text-white'>
                                {t('settings.theme')}
                            </Label>
                            <Select value={currentTheme} onValueChange={setTheme}>
                                <SelectTrigger
                                    id='settings-theme'
                                    className='w-full border-white/20 bg-black text-white focus:border-white/50 focus:ring-white/50'>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent className='border-white/20 bg-black text-white'>
                                    <SelectItem value='system' className='focus:bg-white/10'>
                                        {t('settings.system')}
                                    </SelectItem>
                                    <SelectItem value='dark' className='focus:bg-white/10'>
                                        {t('settings.dark')}
                                    </SelectItem>
                                    <SelectItem value='light' className='focus:bg-white/10'>
                                        {t('settings.light')}
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                            <p className='text-xs text-white/50'>{t('settings.themeDescription')}</p>
                        </div>
                    </div>
                </section>

                <section className='space-y-5 rounded-lg border border-white/10 bg-black p-5'>
                    <div>
                        <h2 className='text-base font-medium text-white'>{t('settings.api')}</h2>
                    </div>

                    <div className='space-y-2'>
                        <Label htmlFor='settings-base-url' className='text-white'>
                            {t('settings.baseUrl')}
                        </Label>
                        <Input
                            id='settings-base-url'
                            value={draft.baseUrl}
                            onChange={(event) =>
                                setDraft((currentDraft) => ({ ...currentDraft, baseUrl: event.target.value }))
                            }
                            placeholder={t('settings.baseUrlPlaceholder')}
                            className='border-white/20 bg-black text-white placeholder:text-white/35 focus:border-white/50 focus:ring-white/50'
                        />
                        <p className='text-xs text-white/50'>{t('settings.baseUrlHelp')}</p>
                    </div>

                    <div className='space-y-2'>
                        <Label htmlFor='settings-api-key' className='text-white'>
                            {t('settings.apiKey')}
                        </Label>
                        <div className='flex gap-2'>
                            <Input
                                id='settings-api-key'
                                type={showApiKey ? 'text' : 'password'}
                                value={draft.apiKey}
                                onChange={(event) =>
                                    setDraft((currentDraft) => ({ ...currentDraft, apiKey: event.target.value }))
                                }
                                placeholder={t('settings.apiKeyPlaceholder')}
                                className='border-white/20 bg-black text-white placeholder:text-white/35 focus:border-white/50 focus:ring-white/50'
                            />
                            <Button
                                type='button'
                                variant='outline'
                                size='icon'
                                onClick={() => setShowApiKey((current) => !current)}
                                className='border-white/20 text-white/80 hover:bg-white/10 hover:text-white'
                                aria-label={showApiKey ? 'Hide API key' : 'Show API key'}>
                                {showApiKey ? <EyeOff className='h-4 w-4' /> : <Eye className='h-4 w-4' />}
                            </Button>
                        </div>
                        <p className='text-xs text-white/50'>{t('settings.apiKeyHelp')}</p>
                    </div>
                </section>

                <section className='space-y-5 rounded-lg border border-white/10 bg-black p-5'>
                    <div>
                        <h2 className='text-base font-medium text-white'>{t('settings.models')}</h2>
                        <p className='mt-1 text-sm text-white/60'>{t('settings.modelsDescription')}</p>
                    </div>

                    <div className='flex gap-2'>
                        <Input
                            value={modelInput}
                            onChange={(event) => setModelInput(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    event.preventDefault();
                                    handleAddModel();
                                }
                            }}
                            placeholder={t('settings.modelPlaceholder')}
                            className='border-white/20 bg-black text-white placeholder:text-white/35 focus:border-white/50 focus:ring-white/50'
                        />
                        <Button
                            type='button'
                            onClick={handleAddModel}
                            className='bg-white text-black hover:bg-white/90'>
                            <Plus className='h-4 w-4' />
                            {t('settings.addModel')}
                        </Button>
                    </div>

                    <div className='space-y-2'>
                        {draft.models.map((model) => (
                            <div
                                key={model}
                                className='flex min-h-10 items-center justify-between gap-3 rounded-md border border-white/10 bg-white/5 px-3 py-2'>
                                <span className='font-mono text-sm break-all text-white/85'>{model}</span>
                                <Button
                                    type='button'
                                    variant='ghost'
                                    size='icon'
                                    onClick={() => handleRemoveModel(model)}
                                    className='text-white/60 hover:bg-white/10 hover:text-white'
                                    aria-label={t('settings.removeModel', { model })}>
                                    <Trash2 className='h-4 w-4' />
                                </Button>
                            </div>
                        ))}
                    </div>
                </section>

                <footer className='sticky bottom-0 flex flex-col gap-3 border-t border-white/10 bg-black/95 py-4 backdrop-blur sm:flex-row sm:items-center sm:justify-between'>
                    <p className='min-h-5 text-sm text-white/60' role='status'>
                        {statusMessage}
                    </p>
                    <div className='flex gap-2'>
                        <Button
                            type='button'
                            variant='outline'
                            onClick={handleReset}
                            className='border-white/20 text-white/80 hover:bg-white/10 hover:text-white'>
                            <RotateCcw className='h-4 w-4' />
                            {t('settings.resetDefaults')}
                        </Button>
                        <Button type='button' onClick={handleSave} className='bg-white text-black hover:bg-white/90'>
                            <Save className='h-4 w-4' />
                            {t('settings.saveSettings')}
                        </Button>
                    </div>
                </footer>
            </div>
        </main>
    );
}
