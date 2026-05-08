'use client';

import type { AppSettings } from '@/lib/app-settings';
import { useI18n } from '@/lib/i18n';
import type { GptImageModel } from '@/lib/cost-utils';
import * as React from 'react';

function removeIncompletePrefixModels(models: string[]): string[] {
    return models.filter((model) => {
        const looksIncomplete = model.endsWith('-') || !/\d/.test(model);
        if (!looksIncomplete) return true;

        return !models.some((otherModel) => otherModel !== model && otherModel.startsWith(model));
    });
}

function normalizeModelOptions(model: string, existingModels: string[]): string[] {
    const seen = new Set<string>();
    const nextModels: string[] = [];

    for (const rawModel of [model, ...existingModels]) {
        const trimmedModel = rawModel.trim();
        if (!trimmedModel || seen.has(trimmedModel)) continue;

        seen.add(trimmedModel);
        nextModels.push(trimmedModel);
    }

    const withoutIncompletePrefixes = removeIncompletePrefixModels(nextModels);

    return withoutIncompletePrefixes.length > 0 ? withoutIncompletePrefixes : ['gpt-image-2'];
}

function mergeModelOptions(groups: string[][]): string[] {
    const seen = new Set<string>();
    const options: string[] = [];

    for (const group of groups) {
        for (const rawModel of removeIncompletePrefixModels(group)) {
            const model = rawModel.trim();
            if (!model || seen.has(model)) continue;

            seen.add(model);
            options.push(model);
        }
    }

    return options.length > 0 ? options : ['gpt-image-2'];
}

type UseModelPreferencesParams = {
    clientPasswordHash: string | null;
    initialModelOptions: string[];
    isPasswordRequiredByBackend: boolean | null;
    saveSettings: (settings: AppSettings) => void;
    settings: AppSettings;
};

export function useModelPreferences({
    clientPasswordHash,
    initialModelOptions,
    isPasswordRequiredByBackend,
    saveSettings,
    settings
}: UseModelPreferencesParams) {
    const { t } = useI18n();
    const [apiKeyDraft, setApiKeyDraft] = React.useState(settings.apiKey);
    const [modelDraft, setModelDraft] = React.useState(settings.models[0] ?? 'gpt-image-2');
    const [remoteModelOptions, setRemoteModelOptions] = React.useState<string[]>([]);
    const [isModelMenuOpen, setIsModelMenuOpen] = React.useState(false);
    const [isFetchingModels, setIsFetchingModels] = React.useState(false);
    const [modelFetchError, setModelFetchError] = React.useState<string | null>(null);

    React.useEffect(() => {
        setApiKeyDraft(settings.apiKey);
        setModelDraft(settings.models[0] ?? 'gpt-image-2');
    }, [settings.apiKey, settings.models]);

    const selectedModel = (modelDraft.trim() || settings.models[0] || 'gpt-image-2') as GptImageModel;

    const combinedModelOptions = React.useMemo(
        () => mergeModelOptions([remoteModelOptions, initialModelOptions]),
        [initialModelOptions, remoteModelOptions]
    );

    const filteredModelOptions = React.useMemo(() => {
        const query = modelDraft.trim().toLowerCase();
        const filteredOptions = query
            ? combinedModelOptions.filter((model) => model.toLowerCase().includes(query))
            : combinedModelOptions;

        return filteredOptions.slice(0, 50);
    }, [combinedModelOptions, modelDraft]);

    const handleApiKeyChange = React.useCallback(
        (value: string) => {
            setApiKeyDraft(value);
            saveSettings({
                ...settings,
                apiKey: value,
                models: settings.models
            });
        },
        [saveSettings, settings]
    );

    const handleModelChange = React.useCallback((value: string) => {
        setModelDraft(value);
    }, []);

    const saveModelChoice = React.useCallback(
        (value: string) => {
            if (!value.trim()) return;

            saveSettings({
                ...settings,
                apiKey: apiKeyDraft,
                models: normalizeModelOptions(value, settings.models)
            });
        },
        [apiKeyDraft, saveSettings, settings]
    );

    const handleModelSelect = React.useCallback(
        (value: string) => {
            setModelDraft(value);
            saveSettings({
                ...settings,
                apiKey: apiKeyDraft,
                models: normalizeModelOptions(value, settings.models)
            });
        },
        [apiKeyDraft, saveSettings, settings]
    );

    const fetchModelOptions = React.useCallback(async () => {
        if (isPasswordRequiredByBackend && !clientPasswordHash) {
            setModelFetchError(t('page.passwordMissing'));
            return;
        }

        setIsFetchingModels(true);
        setModelFetchError(null);

        try {
            const response = await fetch('/api/models', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    apiKey: apiKeyDraft.trim() || undefined,
                    ...(isPasswordRequiredByBackend && clientPasswordHash ? { passwordHash: clientPasswordHash } : {})
                })
            });
            const result = (await response.json()) as { models?: string[]; error?: string };

            if (!response.ok) {
                throw new Error(result.error || t('page.apiRequestFailed', { status: response.status }));
            }

            setRemoteModelOptions(Array.isArray(result.models) ? result.models : []);
        } catch (error) {
            setRemoteModelOptions([]);
            setModelFetchError(error instanceof Error ? error.message : t('settings.modelsFetchFailed'));
        } finally {
            setIsFetchingModels(false);
        }
    }, [apiKeyDraft, clientPasswordHash, isPasswordRequiredByBackend, t]);

    React.useEffect(() => {
        if (isPasswordRequiredByBackend === null) return;

        const timeoutId = window.setTimeout(() => {
            fetchModelOptions();
        }, 600);

        return () => window.clearTimeout(timeoutId);
    }, [fetchModelOptions, isPasswordRequiredByBackend]);

    return {
        apiKeyDraft,
        fetchModelOptions,
        filteredModelOptions,
        handleApiKeyChange,
        handleModelChange,
        handleModelSelect,
        isFetchingModels,
        isModelMenuOpen,
        modelDraft,
        modelFetchError,
        saveModelChoice,
        selectedModel,
        setIsModelMenuOpen
    };
}
