"use client";

import { useLayoutEffect } from "react";
import { usePreferences } from "@/lib/store/prefs";

/**
 * Applies the stored theme to the document element.
 *
 * `useLayoutEffect` rather than `useEffect` on purpose: it runs before the
 * browser paints, so a visitor who has chosen light mode does not see a frame
 * of dark first. That avoids needing a blocking inline script in <head>, which
 * is the usual fix and would mean shipping `dangerouslySetInnerHTML`.
 *
 * Dark needs no attribute — it is the stylesheet's default, so the common case
 * costs nothing at all.
 */
export function ThemeApplier() {
  const { prefs } = usePreferences();

  useLayoutEffect(() => {
    const root = document.documentElement;
    if (prefs.theme === "light") {
      root.dataset.theme = "light";
      root.style.colorScheme = "light";
    } else {
      delete root.dataset.theme;
      root.style.colorScheme = "dark";
    }
  }, [prefs.theme]);

  return null;
}
