// Extension manifest: types + validation for extension.json.

export type ThemeUiTheme = "vs" | "vs-dark";

export interface ExtensionThemeContribution {
  id: string;
  label: string;
  /** Monaco base: "vs" (light) or "vs-dark" (dark). */
  uiTheme: ThemeUiTheme;
  /** Relative path to the theme file inside the extension folder. */
  path: string;
}

export interface ExtensionManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  contributes: {
    themes: ExtensionThemeContribution[];
  };
}

export type ManifestResult = { ok: true; manifest: ExtensionManifest } | { ok: false; errors: string[] };

const EXT_ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;
const VERSION_RE = /^\d+\.\d+\.\d+$/;
const UI_THEMES: ThemeUiTheme[] = ["vs", "vs-dark"];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function err(errors: string[], path: string, msg: string): void {
  errors.push(`${path}: ${msg}`);
}

function isSafeRelPath(p: unknown): p is string {
  return (
    typeof p === "string" &&
    !!p.trim() &&
    !p.includes("..") &&
    !p.startsWith("/") &&
    !/^[a-zA-Z]:/.test(p)
  );
}

export function validateManifest(raw: unknown): ManifestResult {
  const errors: string[] = [];
  if (!isRecord(raw)) return { ok: false, errors: ["manifest: debe ser un objeto JSON"] };

  if (typeof raw.id !== "string" || !EXT_ID_RE.test(raw.id)) {
    err(errors, "id", "requerido, minúsculas/números/guiones (2-64 caracteres)");
  }
  if (typeof raw.name !== "string" || !raw.name.trim()) {
    err(errors, "name", "requerido, no vacío");
  }
  if (typeof raw.version !== "string" || !VERSION_RE.test(raw.version)) {
    err(errors, "version", "requerido, formato semver X.Y.Z");
  }
  if (raw.description !== undefined && typeof raw.description !== "string") {
    err(errors, "description", "debe ser texto");
  }

  const themes: ExtensionThemeContribution[] = [];
  const contributes = raw.contributes;
  if (!isRecord(contributes)) {
    err(errors, "contributes", "requerido, debe ser un objeto con \"themes\"");
  } else {
    if (contributes.commands !== undefined) {
      err(
        errors,
        "contributes.commands",
        "ya no soportado: solo se admiten extensiones de tema (elimina \"commands\")",
      );
    }
    for (const key of Object.keys(contributes)) {
      if (key !== "themes" && key !== "commands") {
        err(errors, `contributes.${key}`, "solo se admite \"themes\"");
      }
    }
    if (contributes.themes === undefined) {
      err(errors, "contributes.themes", "requerido, lista no vacía de temas");
    } else if (!Array.isArray(contributes.themes) || contributes.themes.length === 0) {
      err(errors, "contributes.themes", "debe ser una lista no vacía");
    } else {
      const seenThemeIds = new Set<string>();
      contributes.themes.forEach((th: unknown, i: number) => {
        const p = `contributes.themes[${i}]`;
        if (!isRecord(th)) {
          err(errors, p, "debe ser un objeto");
          return;
        }
        let valid = true;
        if (typeof th.id !== "string" || !th.id.trim()) {
          err(errors, `${p}.id`, "requerido, no vacío");
          valid = false;
        } else if (seenThemeIds.has(th.id.trim())) {
          err(errors, `${p}.id`, `duplicado: "${th.id.trim()}" ya existe en esta extensión`);
          valid = false;
        }
        if (typeof th.label !== "string" || !th.label.trim()) {
          err(errors, `${p}.label`, "requerido, no vacío");
          valid = false;
        }
        if (typeof th.uiTheme !== "string" || !UI_THEMES.includes(th.uiTheme as ThemeUiTheme)) {
          err(errors, `${p}.uiTheme`, `debe ser uno de: ${UI_THEMES.join(", ")}`);
          valid = false;
        }
        if (!isSafeRelPath(th.path) && !isSafeRelPath(th.file)) {
          err(errors, `${p}.path`, "ruta relativa dentro de la extensión (sin .. ni absolutas)");
          valid = false;
        }
        if (valid) {
          const id = (th.id as string).trim();
          seenThemeIds.add(id);
          themes.push({
            id,
            label: (th.label as string).trim(),
            uiTheme: th.uiTheme as ThemeUiTheme,
            path: ((th.path ?? th.file) as string).trim(),
          });
        }
      });
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  const manifest: ExtensionManifest = {
    id: raw.id as string,
    name: (raw.name as string).trim(),
    version: raw.version as string,
    contributes: { themes },
    ...(typeof raw.description === "string" ? { description: raw.description } : {}),
  };
  return { ok: true, manifest };
}
