// i18n context + useT() hook for play-web (change: play-web-i18n-hebrew).
// Kept separate from i18n.ts so the pure translation maps can be imported by the
// parity test without pulling in React.
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { translations, type Lang, type T } from './i18n';
import { loadLang, saveLang } from './store';

interface I18nValue {
  t: T;
  lang: Lang;
  dir: 'rtl' | 'ltr';
  setLang: (l: Lang) => void;
  toggleLang: () => void;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => loadLang());

  const value = useMemo<I18nValue>(() => {
    const setLang = (l: Lang) => { saveLang(l); setLangState(l); };
    const t = translations[lang];
    return {
      t,
      lang,
      dir: t.dir,
      setLang,
      toggleLang: () => setLang(lang === 'he' ? 'en' : 'he'),
    };
  }, [lang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useT must be used within <I18nProvider>');
  return ctx;
}
