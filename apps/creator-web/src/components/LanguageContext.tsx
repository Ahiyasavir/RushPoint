import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { translations, type Lang, type T } from '../i18n';

const LANG_KEY = 'rp-lang';

interface LangCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
}

const Ctx = createContext<LangCtx>({ lang: 'he', setLang: () => {} });

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    try {
      const stored = localStorage.getItem(LANG_KEY);
      if (stored === 'en' || stored === 'he') return stored;
    } catch { /* private mode */ }
    return 'he';
  });

  function setLang(l: Lang) {
    setLangState(l);
    try { localStorage.setItem(LANG_KEY, l); } catch { /* private mode */ }
  }

  useEffect(() => {
    document.documentElement.setAttribute('dir', translations[lang].dir);
    document.documentElement.setAttribute('lang', lang);
  }, [lang]);

  return <Ctx.Provider value={{ lang, setLang }}>{children}</Ctx.Provider>;
}

export function useLanguage() {
  return useContext(Ctx);
}

export function useT(): T {
  const { lang } = useLanguage();
  return translations[lang];
}
