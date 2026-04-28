'use client';

import { useI18n, type Language, type LanguagePreference, type TranslationKey } from '@/lib/i18n';
import * as React from 'react';

const languagePreferenceId = 'gpt-image-language-preference';

const languageOptions: { value: LanguagePreference; labelKey: TranslationKey }[] = [
    { value: 'system', labelKey: 'settings.system' },
    { value: 'en', labelKey: 'settings.english' },
    { value: 'zh', labelKey: 'settings.chinese' }
];

const devToolsTextKeys: Record<string, TranslationKey> = {
    Preferences: 'devtools.preferences',
    Theme: 'devtools.theme',
    'Select your theme preference.': 'devtools.themeDescription',
    System: 'devtools.system',
    Light: 'devtools.light',
    Dark: 'devtools.dark',
    Position: 'devtools.position',
    'Adjust the placement of your dev tools.': 'devtools.positionDescription',
    'Bottom Left': 'devtools.bottomLeft',
    'Bottom Right': 'devtools.bottomRight',
    'Top Left': 'devtools.topLeft',
    'Top Right': 'devtools.topRight',
    Size: 'devtools.size',
    'Adjust the size of your dev tools.': 'devtools.sizeDescription',
    Small: 'devtools.small',
    Medium: 'devtools.medium',
    Large: 'devtools.large',
    'Hide Dev Tools for this session': 'devtools.hideSession',
    'Hide Dev Tools until you restart your dev server, or 1 day.': 'devtools.hideSessionDescription',
    Hide: 'devtools.hide',
    'Hide Dev Tools shortcut': 'devtools.hideShortcut',
    'Set a custom keyboard shortcut to toggle visibility.': 'devtools.hideShortcutDescription',
    'Disable Dev Tools for this project': 'devtools.disableProject',
    'Restart Dev Server': 'devtools.restartServer',
    'Restarts the development server without needing to leave the browser.': 'devtools.restartServerDescription',
    Restart: 'devtools.restart',
    'Reset Bundler Cache': 'devtools.resetBundlerCache',
    'Clears the bundler cache and restarts the dev server. Helpful if you are seeing stale errors or changes are not appearing.':
        'devtools.resetBundlerCacheDescription',
    'Reset Cache': 'devtools.resetCache'
};

const devToolsOriginalText = new WeakMap<Text, string>();

function setText(element: Element | null, text: string) {
    if (element && element.textContent !== text) {
        element.textContent = text;
    }
}

function createChevronIcon(documentRef: Document) {
    const svg = documentRef.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('aria-hidden', 'true');

    const path = documentRef.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('fill-rule', 'evenodd');
    path.setAttribute('clip-rule', 'evenodd');
    path.setAttribute(
        'd',
        'M14.0607 5.49999L13.5303 6.03032L8.7071 10.8535C8.31658 11.2441 7.68341 11.2441 7.29289 10.8535L2.46966 6.03032L1.93933 5.49999L2.99999 4.43933L3.53032 4.96966L7.99999 9.43933L12.4697 4.96966L13 4.43933L14.0607 5.49999Z'
    );
    path.setAttribute('fill', 'currentColor');
    svg.appendChild(path);

    return svg;
}

function translateDevToolsText(shadowRoot: ShadowRoot, language: Language, t: (key: TranslationKey) => string) {
    const walker = document.createTreeWalker(shadowRoot, NodeFilter.SHOW_TEXT);
    let currentNode = walker.nextNode();

    while (currentNode) {
        const textNode = currentNode as Text;
        const currentText = textNode.nodeValue ?? '';
        const trimmedText = currentText.trim();

        if (trimmedText) {
            const storedOriginal = devToolsOriginalText.get(textNode);
            const originalText = storedOriginal ?? trimmedText;
            const translationKey = devToolsTextKeys[originalText];

            if (translationKey) {
                if (!storedOriginal) {
                    devToolsOriginalText.set(textNode, originalText);
                }

                const nextText = language === 'zh' ? t(translationKey) : originalText;
                const nextNodeValue = currentText.replace(trimmedText, nextText);

                if (textNode.nodeValue !== nextNodeValue) {
                    textNode.nodeValue = nextNodeValue;
                }
            }
        }

        currentNode = walker.nextNode();
    }
}

function renderLanguagePreference({
    shadowRoot,
    languagePreference,
    setLanguagePreference,
    t
}: {
    shadowRoot: ShadowRoot;
    languagePreference: LanguagePreference;
    setLanguagePreference: (languagePreference: LanguagePreference) => void;
    t: (key: TranslationKey) => string;
}) {
    const preferencesContainer = shadowRoot.querySelector('.preferences-container');
    if (!preferencesContainer) return;

    let section = shadowRoot.getElementById(languagePreferenceId) as HTMLDivElement | null;

    if (!section) {
        section = document.createElement('div');
        section.id = languagePreferenceId;
        section.className = 'preference-section';
        section.innerHTML = `
            <div class="preference-header">
                <label for="gpt-image-language">${t('settings.language')}</label>
                <p class="preference-description">${t('settings.languageDescription')}</p>
            </div>
            <div class="select-button">
                <select id="gpt-image-language" name="gpt-image-language" aria-label="${t('settings.languageAria')}"></select>
            </div>
        `;

        const selectButton = section.querySelector('.select-button');
        selectButton?.appendChild(createChevronIcon(document));
    }

    if (preferencesContainer.firstElementChild !== section) {
        preferencesContainer.insertBefore(section, preferencesContainer.firstElementChild);
    }

    setText(section.querySelector('label'), t('settings.language'));
    setText(section.querySelector('.preference-description'), t('settings.languageDescription'));

    const select = section.querySelector('select') as HTMLSelectElement | null;
    if (!select) return;

    select.setAttribute('aria-label', t('settings.languageAria'));
    select.onchange = (event) => {
        const nextLanguagePreference = (event.currentTarget as HTMLSelectElement).value as LanguagePreference;
        setLanguagePreference(nextLanguagePreference);
    };

    for (const option of languageOptions) {
        let optionElement = select.querySelector(`option[value="${option.value}"]`) as HTMLOptionElement | null;

        if (!optionElement) {
            optionElement = document.createElement('option');
            optionElement.value = option.value;
            select.appendChild(optionElement);
        }

        setText(optionElement, t(option.labelKey));
    }

    if (select.value !== languagePreference) {
        select.value = languagePreference;
    }
}

export function LanguageSelect() {
    const { language, languagePreference, setLanguagePreference, t } = useI18n();
    const isDevelopment = process.env.NODE_ENV === 'development';

    React.useEffect(() => {
        if (!isDevelopment) return;

        const shadowObservers = new Map<ShadowRoot, MutationObserver>();

        const renderIntoNextDevtools = () => {
            const portals = Array.from(document.querySelectorAll('nextjs-portal'));

            for (const portal of portals) {
                const shadowRoot = (portal as HTMLElement).shadowRoot;
                if (!shadowRoot) continue;

                if (!shadowObservers.has(shadowRoot)) {
                    const shadowObserver = new MutationObserver(renderIntoNextDevtools);
                    shadowObserver.observe(shadowRoot, { childList: true, subtree: true });
                    shadowObservers.set(shadowRoot, shadowObserver);
                }

                renderLanguagePreference({
                    shadowRoot,
                    languagePreference,
                    setLanguagePreference,
                    t
                });
                translateDevToolsText(shadowRoot, language, t);
            }
        };

        const documentObserver = new MutationObserver(renderIntoNextDevtools);
        documentObserver.observe(document.body, { childList: true, subtree: true });
        const interval = window.setInterval(renderIntoNextDevtools, 500);
        renderIntoNextDevtools();

        return () => {
            documentObserver.disconnect();
            shadowObservers.forEach((observer) => observer.disconnect());
            window.clearInterval(interval);
        };
    }, [isDevelopment, language, languagePreference, setLanguagePreference, t]);

    return null;
}
