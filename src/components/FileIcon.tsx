// Icon by file type.
// Adding a language = extend services/files/fileTypes (+ this map if
// it has its own color). Active theme SVG icons (themes/iconService) win
// when present; otherwise the built-in lucide icons below.
import { FileCode2, File } from "lucide-react";
import { useSyncExternalStore } from "react";
import { kindForFileName } from "../services/files/fileTypes";
import { getFileIconUrl } from "../extensions/themes/iconService";
import { getRegistryVersion, subscribeRegistryChange } from "../extensions/themes/themeService";
import { useSettingsStore } from "../stores/settingsStore";

const TONE_CLASS: Record<string, string> = {
  ember: "text-ember-400",
  sky: "text-sky-300",
  green: "text-green-300",
  purple: "text-purple-300",
  gray: "text-graphite-400",
};

const CODE_EXTS = [".java", ".class", ".yml", ".yaml", ".xml", ".md", ".markdown", ".gradle", ".kts"];

export default function FileIcon({
  name,
  size = 14,
  className = "",
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  const theme = useSettingsStore((s) => s.theme);
  // Re-render once async theme SVGs land in the cache.
  useSyncExternalStore(subscribeRegistryChange, getRegistryVersion);
  const custom = getFileIconUrl(theme, name);
  if (custom) {
    return <img src={custom} width={size} height={size} alt="" draggable={false} className={`shrink-0 ${className}`} />;
  }
  const lower = (name ?? "").toLowerCase();
  if (!CODE_EXTS.some((e) => lower.endsWith(e))) {
    return <File size={size} className={`text-graphite-400 ${className}`} />;
  }
  // `.class` (TabBar view) uses the ember accent even without a Monaco language.
  const tone = lower.endsWith(".class") ? "ember" : kindForFileName(name).iconTone;
  return <FileCode2 size={size} className={`${TONE_CLASS[tone]} ${className}`} />;
}
