import { useSettingsStore } from "../stores/settingsStore";

// Apply CSS colors directly; changing theme does not require rendering App.
// Disable transitions for the switch so colors change together, then restore
// normal hover/layout transitions after the browser has painted the new theme.
export function startThemeSync() {
  const root = document.documentElement;
  let firstFrame = 0;
  let secondFrame = 0;

  const applyTheme = (theme: "dark" | "light") => {
    cancelAnimationFrame(firstFrame);
    cancelAnimationFrame(secondFrame);
    root.classList.add("theme-changing");
    root.classList.toggle("dark", theme === "dark");
    root.classList.toggle("light", theme === "light");
    root.style.colorScheme = theme;
    firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        root.classList.remove("theme-changing");
      });
    });
  };

  applyTheme(useSettingsStore.getState().theme);
  const unsubscribe = useSettingsStore.subscribe((state, previous) => {
    if (state.theme !== previous.theme) applyTheme(state.theme);
  });

  return () => {
    unsubscribe();
    cancelAnimationFrame(firstFrame);
    cancelAnimationFrame(secondFrame);
    root.classList.remove("theme-changing");
  };
}
