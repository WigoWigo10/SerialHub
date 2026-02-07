import { useCallback } from "react";
import { useSettingsStore } from "../stores/settingsStore";
import { translations, LanguageKey } from "../i18n/translations";

export function useLanguage() {
  const { language } = useSettingsStore();

  const t = useCallback((key: LanguageKey): string => {
    const currentLang = translations[language];
    // @ts-ignore
    return currentLang[key] || translations['en-US'][key] || key;
  }, [language]); // Só recria se o idioma mudar

  return { t, language };
}