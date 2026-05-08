'use client';

import * as React from 'react';

export type Image2User = {
    id: number;
    email?: string;
    username?: string;
    role?: string;
};

type AuthMode = 'password' | 'sub2api';

type AuthStatusApiResult = {
    authMode?: AuthMode;
    authenticated?: boolean;
    user?: Image2User | null;
    loginUrl?: string | null;
    passwordRequired: boolean;
    configuredBaseUrl?: string;
    keysUrl?: string | null;
};

type ExchangeResult = {
    authenticated?: boolean;
    user?: Image2User | null;
    error?: string;
    loginUrl?: string | null;
};

function removeTokenFromUrl() {
    const url = new URL(window.location.href);
    url.searchParams.delete('token');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

export function useHomeAuth() {
    const [authMode, setAuthMode] = React.useState<AuthMode>('sub2api');
    const [isAuthReady, setIsAuthReady] = React.useState(false);
    const [image2User, setImage2User] = React.useState<Image2User | null>(null);
    const [loginUrl, setLoginUrl] = React.useState<string | null>(null);
    const [isPasswordRequiredByBackend, setIsPasswordRequiredByBackend] = React.useState<boolean | null>(null);
    const [configuredBaseUrl, setConfiguredBaseUrl] = React.useState('');
    const [keysUrl, setKeysUrl] = React.useState<string | null>(null);
    const [clientPasswordHash, setClientPasswordHash] = React.useState<string | null>(null);

    React.useEffect(() => {
        let cancelled = false;

        const applyStatus = (data: AuthStatusApiResult) => {
            const nextAuthMode = data.authMode || 'password';
            setAuthMode(nextAuthMode);
            setIsPasswordRequiredByBackend(nextAuthMode === 'sub2api' ? false : data.passwordRequired);
            setConfiguredBaseUrl(data.configuredBaseUrl?.trim() || '');
            setKeysUrl(data.keysUrl || null);
            setLoginUrl(data.loginUrl || null);
            setImage2User(data.user ?? null);

            if (nextAuthMode === 'sub2api' && !data.authenticated && data.loginUrl) {
                window.location.assign(data.loginUrl);
                return;
            }

            setIsAuthReady(true);
        };

        const fetchAuthStatus = async () => {
            try {
                const token = new URL(window.location.href).searchParams.get('token');
                if (token) {
                    const exchangeResponse = await fetch('/api/sub2api-session/exchange', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ token, source: 'embedded' })
                    });
                    const exchangeData = (await exchangeResponse.json()) as ExchangeResult;
                    removeTokenFromUrl();

                    if (!exchangeResponse.ok) {
                        if (exchangeData.loginUrl) {
                            window.location.assign(exchangeData.loginUrl);
                            return;
                        }
                        throw new Error(exchangeData.error || 'Failed to exchange sub2api token.');
                    }
                }

                const response = await fetch('/api/auth-status', { cache: 'no-store' });
                if (!response.ok) {
                    throw new Error('Failed to fetch auth status');
                }

                const data: AuthStatusApiResult = await response.json();
                if (!cancelled) {
                    applyStatus(data);
                }
            } catch (error) {
                console.error('Error fetching auth status:', error);
                if (!cancelled) {
                    setAuthMode('password');
                    setIsPasswordRequiredByBackend(false);
                    setConfiguredBaseUrl('');
                    setKeysUrl(null);
                    setLoginUrl(null);
                    setImage2User(null);
                    setIsAuthReady(true);
                }
            }
        };

        fetchAuthStatus();

        const storedHash = localStorage.getItem('clientPasswordHash');
        if (storedHash) {
            setClientPasswordHash(storedHash);
        }

        return () => {
            cancelled = true;
        };
    }, []);

    return {
        authMode,
        clientPasswordHash,
        configuredBaseUrl,
        image2User,
        isAuthReady,
        isPasswordRequiredByBackend,
        keysUrl,
        loginUrl,
        setClientPasswordHash
    };
}

