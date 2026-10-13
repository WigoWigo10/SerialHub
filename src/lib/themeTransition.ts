import { flushSync } from "react-dom";

type Theme = "dark" | "light";
export const THEME_TRANSITION_MS = 350;
let generation = 0;
let pendingTheme: Theme | undefined;
let active: ViewTransition | undefined;
let fallbackTimer: ReturnType<typeof setTimeout> | undefined;

export function cancelThemeTransition() {
  generation++;
  active?.skipTransition();
  active = undefined;
  pendingTheme = undefined;
  clearTimeout(fallbackTimer);
  document.documentElement.classList.remove("theme-changing", "theme-animating");
}

// Capture before changing the store so React, CSS and xterm share the same
// old/new frames. A newer request invalidates even callbacks not yet executed.
export function transitionTheme(theme: Theme, current: Theme, update: () => void) {
  if (theme === (pendingTheme ?? current)) return;
  cancelThemeTransition();
  const request = generation;
  pendingTheme = theme;
  const root = document.documentElement;
  root.style.setProperty("--theme-transition-duration", `${THEME_TRANSITION_MS}ms`);
  const finish = () => {
    if (request !== generation) return;
    active = undefined;
    pendingTheme = undefined;
    root.classList.remove("theme-changing", "theme-animating");
  };

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    flushSync(update);
    finish();
    return;
  }

  if (typeof document.startViewTransition === "function") {
    try {
      active = document.startViewTransition(() => {
        if (request !== generation) return;
        root.classList.add("theme-changing");
        flushSync(update);
        // Rendering is paused during this callback, so never await animation
        // frames here. flushSync also runs the theme effects before capture.
      });
      void active.ready.catch(() => {}); // skipped transitions reject ready
      void active.finished.then(finish, finish);
      return;
    } catch {
      // Older WebViews can fall back to synchronized CSS colors.
    }
  }

  root.classList.add("theme-animating");
  void root.offsetWidth; // register the transition rule before changing colors
  flushSync(update);
  fallbackTimer = setTimeout(finish, THEME_TRANSITION_MS);
}
