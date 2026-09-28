import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import es from './locales/es.json';

export const LANGS = ['en', 'es'] as const;
export type Lang = (typeof LANGS)[number];

const STORAGE_KEY = 'rc.lang';

function storedLang(): Lang {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'es' ? 'es' : 'en';
  } catch {
    return 'en';
  }
}

export function setLang(lang: Lang) {
  void i18n.changeLanguage(lang);
  document.documentElement.lang = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* storage blocked: the choice just won't persist */
  }
}

const initial = storedLang();
document.documentElement.lang = initial;

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, es: { translation: es } },
  lng: initial,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export default i18n;
