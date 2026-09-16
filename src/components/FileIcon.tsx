// Icon by file type.
// Adding a language = extend services/files/fileTypes (+ this map if
// it has its own color).
import { FileCode2, File } from "lucide-react";
import { kindForFileName } from "../services/files/fileTypes";

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
  const lower = (name ?? "").toLowerCase();
  if (!CODE_EXTS.some((e) => lower.endsWith(e))) {
    return <File size={size} className={`text-graphite-400 ${className}`} />;
  }
  // `.class` (TabBar view) uses the ember accent even without a Monaco language.
  const tone = lower.endsWith(".class") ? "ember" : kindForFileName(name).iconTone;
  return <FileCode2 size={size} className={`${TONE_CLASS[tone]} ${className}`} />;
}
