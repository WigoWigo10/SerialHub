import { useSettingsStore } from "../stores/settingsStore";
import { cancelThemeTransition } from "./themeTransition";

// Apply CSS colors directly; changing theme does not require rendering App.
// Animation is coordinated before the store changes by themeTransition.
export function startThemeSync() {
  const root = document.documentElement;

  const applyTheme = (theme: "dark" | "light") => {
    root.classList.toggle("dark", theme === "dark");
    root.classList.toggle("light", theme === "light");
    root.style.colorScheme = theme;
  };

  applyTheme(useSettingsStore.getState().theme);
  const unsubscribe = useSettingsStore.subscribe((state, previous) => {
    if (state.theme !== previous.theme) applyTheme(state.theme);
  });

  return () => {
    unsubscribe();
    cancelThemeTransition();
  };
}
