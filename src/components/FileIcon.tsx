// Icono por tipo de archivo.
// Añadir un lenguaje = ampliar services/files/fileTypes (+ este mapa si
// lleva color propio).
import { FileCode2, File } from "lucide-react";
import { kindForFileName } from "../services/files/fileTypes";

const TONE_CLASS: Record<string, string> = {
  ember: "text-ember-400",
  sky: "text-sky-300",
  green: "text-green-300",
  purple: "text-purple-300",
  gray: "text-graphite-400",
};

const CODE_EXTS = [".java", ".class", ".yml", ".yaml", ".xml", ".md", ".markdown"];

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
  // `.class` (vista TabBar) usa el acento ember aunque no tenga lenguaje Monaco.
  const tone = lower.endsWith(".class") ? "ember" : kindForFileName(name).iconTone;
  return <FileCode2 size={size} className={`${TONE_CLASS[tone]} ${className}`} />;
}
