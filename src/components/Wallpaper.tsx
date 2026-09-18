// Theme background layer: an image behind the editor, sidebar or welcome
// screen, contributed by the active theme. Rendered as the first child of a
// relative container so content paints above it. Surfaces stay opaque unless
// the theme uses alpha colors, so legibility is the theme author's opt-in.
// Assets are capped (5 MB, image formats only) and cached per theme+file;
// a missing asset simply renders nothing.
import { useEffect, useState, useSyncExternalStore } from "react";
import { useSettingsStore } from "../stores/settingsStore";
import {
  getTheme,
  resolveThemeId,
  getRegistryVersion,
  subscribeRegistryChange,
  type ThemeBackground,
} from "../extensions/themes/themeService";
import { loadBackgroundAsset } from "../extensions/themes/wallpaperService";

function backgroundFor(bg: ThemeBackground): {
  backgroundSize: string;
  backgroundPosition: string;
  backgroundRepeat: string;
} {
  switch (bg.fit) {
    case "tile":
      return { backgroundSize: "auto", backgroundPosition: "top left", backgroundRepeat: "repeat" };
    case "contain":
      return { backgroundSize: "contain", backgroundPosition: "center", backgroundRepeat: "no-repeat" };
    case "center":
      return { backgroundSize: "auto", backgroundPosition: "center", backgroundRepeat: "no-repeat" };
    case "cover":
    default:
      return { backgroundSize: "cover", backgroundPosition: "center", backgroundRepeat: "no-repeat" };
  }
}

export default function Wallpaper({ region }: { region: "editor" | "sidebar" | "welcome" }) {
  const theme = useSettingsStore((s) => s.theme);
  const registryVersion = useSyncExternalStore(subscribeRegistryChange, getRegistryVersion);
  const [state, setState] = useState<{ url: string; bg: ThemeBackground } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const spec = getTheme(resolveThemeId(theme));
    const bg = spec?.background;
    if (!bg || !bg.where.includes(region) || !spec?.dir) {
      setState(null);
      return;
    }
    setState(null);
    void loadBackgroundAsset(spec.dir, bg.file).then((url) => {
      if (cancelled || !url) return;
      setState({ url, bg });
    });
    return () => {
      cancelled = true;
    };
  }, [theme, region, registryVersion]);

  if (!state) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-0"
      style={{
        backgroundImage: `url("${state.url}")`,
        ...backgroundFor(state.bg),
        opacity: state.bg.opacity,
      }}
    />
  );
}
