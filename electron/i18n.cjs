// Main-process i18n: user-facing strings from electron/* (dialog labels,
// LSP errors, resolve progress) come from the SAME locale JSONs as the
// renderer (src/i18n/locales/<code>.json), read from disk.
// Dev: <appPath>/src/i18n/locales. Packaged: <resources>/locales
// (shipped via electron-builder extraResources).
// The renderer pushes its language via settings:setLanguage; default is en_EN.
const fs = require("fs");
const path = require("path");

const DEFAULT_CODE = "en_EN";
let appRef = null;
let code = DEFAULT_CODE;
let dict = {};

function localesDir() {
  if (appRef && appRef.isPackaged) {
    return path.join(process.resourcesPath, "locales");
  }
  const base = appRef ? appRef.getAppPath() : path.join(__dirname, "..");
  return path.join(base, "src", "i18n", "locales");
}

function loadDict(target) {
  const dir = localesDir();
  const tryLoad = (c) => {
    try {
      const raw = fs.readFileSync(path.join(dir, `${c}.json`), "utf8");
      return JSON.parse(raw) ?? {};
    } catch {
      return null;
    }
  };
  const next = tryLoad(target) ?? tryLoad(DEFAULT_CODE) ?? {};
  code = tryLoad(target) ? target : DEFAULT_CODE;
  dict = next;
}

function initI18n(app, initialCode) {
  appRef = app;
  loadDict(initialCode || DEFAULT_CODE);
}

function setLanguage(nextCode) {
  if (!nextCode || nextCode === code) return code;
  loadDict(nextCode);
  return code;
}

function t(key, vars) {
  let text = dict[key];
  if (typeof text !== "string") return key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.split(`{${name}}`).join(String(value));
    }
  }
  return text;
}

function getLanguage() {
  return code;
}

module.exports = { initI18n, setLanguage, getLanguage, t };
