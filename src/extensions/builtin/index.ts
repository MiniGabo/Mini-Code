// Built-in themes: registered eagerly at startup so the theme list is
// complete even if no editor ever mounts (e.g. Settings opened straight
// from the welcome screen). Extension themes layer on top via the host.
import { getTheme, registerTheme } from "../themes/themeService";
import { miniCodeDark } from "./mini-code-dark";
import { miniCodeLight } from "./mini-code-light";

/** Eager registration of built-in themes (call at startup, not on editor mount). */
export function ensureBuiltinThemes(): void {
  if (!getTheme(miniCodeDark.id)) registerTheme(miniCodeDark);
  if (!getTheme(miniCodeLight.id)) registerTheme(miniCodeLight);
}
