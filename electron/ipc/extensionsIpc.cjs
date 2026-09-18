// Extensions filesystem bridge (theme packs only).
// Renderer discovers user themes here; all validation happens in the
// renderer (extensions/manifest.ts + themes/schema.ts). Reads are jailed to
// the extensions root plus the requested extension dir: no "..", no absolute
// paths.
//
// Locations:
//   - dev: <project>/extensions (the repo folder itself).
//   - packaged: <userData>/extensions.
const fs = require("fs");
const path = require("path");
const { dialog, shell } = require("electron");

let cachedRoot = null;

function extensionsRoot(app) {
  if (cachedRoot) return cachedRoot;
  let root;
  if (app && app.isPackaged) {
    // Like VSCode and like this editor's own settings: user data, which is
    // always writable (install dirs usually are not).
    root = path.join(app.getPath("userData"), "extensions");
  } else {
    const base = app ? app.getAppPath() : path.join(__dirname, "..");
    root = path.join(base, "extensions");
  }
  try {
    fs.mkdirSync(root, { recursive: true });
  } catch {
    // scan reports the failure
  }
  cachedRoot = { root, fallback: false };
  return cachedRoot;
}

/** Test hook: forget the resolved root (does not touch the filesystem). */
function resetRootForTests() {
  cachedRoot = null;
}

function isInsideRoot(root, dir) {
  const normRoot = path.normalize(root);
  const normDir = path.normalize(dir);
  return normDir === normRoot || normDir.startsWith(normRoot + path.sep);
}

function safeJoin(dir, rel) {
  if (typeof rel !== "string" || !rel || rel.includes("..") || path.isAbsolute(rel) || /^[a-zA-Z]:/.test(rel)) {
    return null;
  }
  const full = path.normalize(path.join(dir, rel));
  if (full !== dir && !full.startsWith(dir + path.sep)) return null;
  return full;
}

function readJsonFile(full) {
  const text = fs.readFileSync(full, "utf8");
  return JSON.parse(text);
}

const EXT_ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;

function register({ ipcMain, app, getWindow }) {
  const root = () => extensionsRoot(app).root;

  ipcMain.handle("extensions:scan", async () => {
    const dir = root();
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      return { ok: false, error: `no se pudo crear ${dir}`, entries: [] };
    }
    let names;
    try {
      names = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      return { ok: false, error: String(err?.message ?? err), entries: [] };
    }
    const entries = [];
    for (const ent of names) {
      if (!ent.isDirectory()) continue;
      const extDir = path.join(dir, ent.name);
      const manifestPath = path.join(extDir, "extension.json");
      try {
        entries.push({ dir: extDir, manifest: readJsonFile(manifestPath) });
      } catch (err) {
        entries.push({ dir: extDir, error: String(err?.message ?? err) });
      }
    }
    return { ok: true, root: dir, entries };
  });

  ipcMain.handle("extensions:readJson", async (_event, { dir, rel } = {}) => {
    const rootDir = root();
    if (typeof dir !== "string" || !isInsideRoot(rootDir, dir)) {
      return { ok: false, error: "directorio fuera de extensions" };
    }
    const full = safeJoin(path.normalize(dir), rel);
    if (!full) return { ok: false, error: "ruta no permitida" };
    try {
      return { ok: true, json: readJsonFile(full) };
    } catch (err) {
      return { ok: false, error: String(err?.message ?? err) };
    }
  });

  // Binary assets (theme backgrounds, icon SVGs). Same jail as readJson, plus
  // an allowlisted suffix set and a hard size cap (animated GIFs can be big).
  const ASSET_MIME = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
  };
  const ASSET_MAX_BYTES = 5 * 1024 * 1024;
  ipcMain.handle("extensions:readAsset", async (_event, { dir, rel } = {}) => {
    const rootDir = root();
    if (typeof dir !== "string" || !isInsideRoot(rootDir, dir)) {
      return { ok: false, error: "directorio fuera de extensions" };
    }
    const full = safeJoin(path.normalize(dir), rel);
    if (!full) return { ok: false, error: "ruta no permitida" };
    const mime = ASSET_MIME[path.extname(full).toLowerCase()];
    if (!mime) return { ok: false, error: "formato de asset no permitido" };
    let stat;
    try {
      stat = fs.statSync(full);
    } catch (err) {
      return { ok: false, error: String(err?.message ?? err) };
    }
    if (!stat.isFile() || stat.size > ASSET_MAX_BYTES) {
      return { ok: false, error: `asset inválido o mayor de ${ASSET_MAX_BYTES} bytes` };
    }
    try {
      const data = fs.readFileSync(full).toString("base64");
      return { ok: true, mime, dataUrl: `data:${mime};base64,${data}` };
    } catch (err) {
      return { ok: false, error: String(err?.message ?? err) };
    }
  });

  // Install: user picks a folder containing extension.json; it is copied
  // into the extensions root under its manifest id. Returns the installed
  // id so the renderer can rediscover immediately.
  ipcMain.handle("extensions:install", async () => {
    const rootDir = root();
    let picked;
    try {
      const result = await dialog.showOpenDialog(getWindow ? getWindow() : null, {
        properties: ["openDirectory"],
      });
      if (result.canceled || result.filePaths.length === 0) return { ok: false, cancelled: true };
      picked = result.filePaths[0];
    } catch (err) {
      return { ok: false, error: String(err?.message ?? err) };
    }
    let manifest;
    try {
      manifest = readJsonFile(path.join(picked, "extension.json"));
    } catch {
      return { ok: false, error: "la carpeta no contiene un extension.json válido" };
    }
    const id = manifest && typeof manifest.id === "string" ? manifest.id : "";
    if (!EXT_ID_RE.test(id)) {
      return { ok: false, error: "extension.json tiene un id inválido" };
    }
    const dest = path.join(rootDir, id);
    if (!isInsideRoot(rootDir, dest)) return { ok: false, error: "destino fuera de extensions" };
    try {
      if (fs.existsSync(dest)) {
        return { ok: false, error: `"${id}" ya está instalada (desinstálala primero para actualizar)` };
      }
      fs.mkdirSync(rootDir, { recursive: true });
      fs.cpSync(picked, dest, { recursive: true });
    } catch (err) {
      try {
        fs.rmSync(dest, { recursive: true, force: true });
      } catch {
        // best-effort cleanup of a half-copied install
      }
      return { ok: false, error: String(err?.message ?? err) };
    }
    return { ok: true, id };
  });

  // Uninstall: removes an installed extension folder by id. Only direct
  // children of the extensions root can be removed (never built-ins, which
  // don't live on disk here anyway).
  ipcMain.handle("extensions:uninstall", async (_event, { id } = {}) => {
    const rootDir = root();
    if (typeof id !== "string" || !EXT_ID_RE.test(id)) {
      return { ok: false, error: "id de extensión inválido" };
    }
    const dest = path.join(rootDir, id);
    if (!isInsideRoot(rootDir, dest) || path.normalize(dest) === path.normalize(rootDir)) {
      return { ok: false, error: "destino fuera de extensions" };
    }
    try {
      if (!fs.existsSync(dest)) return { ok: false, error: `"${id}" no está instalada` };
      fs.rmSync(dest, { recursive: true, force: true });
    } catch (err) {
      return { ok: false, error: String(err?.message ?? err) };
    }
    return { ok: true, id };
  });

  // Reveals the extensions folder in the OS file explorer.
  ipcMain.handle("extensions:openFolder", async () => {
    const dir = root();
    try {
      fs.mkdirSync(dir, { recursive: true });
      const err = await shell.openPath(dir);
      if (err) return { ok: false, error: err };
      return { ok: true, root: dir };
    } catch (err) {
      return { ok: false, error: String(err?.message ?? err) };
    }
  });
}

module.exports = { registerExtensions: register, extensionsRoot, resetRootForTests };
