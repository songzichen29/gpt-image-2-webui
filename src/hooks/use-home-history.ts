'use client';

import * as React from 'react';

const HISTORY_STORAGE_KEY = 'openaiImageHistory';
const DELETE_CONFIRMATION_KEY = 'imageGenSkipDeleteConfirm';

export function getHistoryStorageKey(userId?: number | null): string | null {
    if (userId === null) return null;
    if (typeof userId === 'number' && Number.isFinite(userId) && userId > 0) {
        return `${HISTORY_STORAGE_KEY}:${userId}`;
    }

    return HISTORY_STORAGE_KEY;
}

function readHistoryFromStorage<T>(storageKey: string | null) {
    if (!storageKey) return [];

    try {
        const storedHistory = localStorage.getItem(storageKey);
        if (storedHistory) {
            const parsedHistory = JSON.parse(storedHistory) as T[];
            if (Array.isArray(parsedHistory)) {
                return parsedHistory;
            }

            console.warn('Invalid history data found in localStorage.');
            localStorage.removeItem(storageKey);
        }
    } catch (error) {
        console.error('Failed to load or parse history from localStorage:', error);
        localStorage.removeItem(storageKey);
    }

    return [];
}

export function useHomeHistory<T>(userId?: number | null) {
    const storageKey = React.useMemo(() => getHistoryStorageKey(userId), [userId]);
    const [history, setHistory] = React.useState<T[]>([]);
    const [isHistoryLoaded, setIsHistoryLoaded] = React.useState(false);
    const [skipDeleteConfirmation, setSkipDeleteConfirmation] = React.useState(false);

    React.useEffect(() => {
        setIsHistoryLoaded(false);
        setHistory(readHistoryFromStorage<T>(storageKey));
        setIsHistoryLoaded(true);
    }, [storageKey]);

    React.useEffect(() => {
        const refreshHistory = () => {
            setHistory(readHistoryFromStorage<T>(storageKey));
        };

        const refreshWhenVisible = () => {
            if (!document.hidden) {
                refreshHistory();
            }
        };

        window.addEventListener('pageshow', refreshHistory);
        window.addEventListener('focus', refreshHistory);
        document.addEventListener('visibilitychange', refreshWhenVisible);

        return () => {
            window.removeEventListener('pageshow', refreshHistory);
            window.removeEventListener('focus', refreshHistory);
            document.removeEventListener('visibilitychange', refreshWhenVisible);
        };
    }, [storageKey]);

    React.useEffect(() => {
        if (!isHistoryLoaded || !storageKey) {
            return;
        }

        try {
            localStorage.setItem(storageKey, JSON.stringify(history));
        } catch (error) {
            console.error('Failed to save history to localStorage:', error);
        }
    }, [history, isHistoryLoaded, storageKey]);

    React.useEffect(() => {
        const storedPreference = localStorage.getItem(DELETE_CONFIRMATION_KEY);
        if (storedPreference === 'true') {
            setSkipDeleteConfirmation(true);
        } else if (storedPreference === 'false') {
            setSkipDeleteConfirmation(false);
        }
    }, []);

    React.useEffect(() => {
        localStorage.setItem(DELETE_CONFIRMATION_KEY, String(skipDeleteConfirmation));
    }, [skipDeleteConfirmation]);

    const clearStoredHistory = React.useCallback(() => {
        if (!storageKey) return;
        localStorage.removeItem(storageKey);
    }, [storageKey]);

    return {
        clearStoredHistory,
        history,
        setHistory,
        setSkipDeleteConfirmation,
        skipDeleteConfirmation
    };
}
