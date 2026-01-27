import { useSettingsStore } from "../stores/settingsStore";
import { translations, LanguageKey } from "../i18n/translations";

export function useLanguage() {
  const { language } = useSettingsStore();

  const t = (key: LanguageKey): string => {
    const currentLang = translations[language];
    // @ts-ignore
    return currentLang[key] || translations['en-US'][key] || key;
  };

  return { t, language };
}