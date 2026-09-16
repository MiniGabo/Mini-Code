// User settings backed by a settings.json file (generic key/value store).
// Dev: <project>/settings.json (local, gitignored).
// Packaged: <userData>/settings.json, i.e. %APPDATA%/Mini Code/settings.json
// on Windows — the standard per-user location (VS Code does the same).
// The install folder is NOT used: it is not user-writable without elevation
// and gets wiped on updates.
const fs = require("fs");
const path = require("path");

let appRef = null;
let cache = null;

function settingsPath() {
  if (appRef && appRef.isPackaged) {
    return path.join(appRef.getPath("userData"), "settings.json");
  }
  const base = appRef ? appRef.getAppPath() : path.join(__dirname, "..");
  return path.join(base, "settings.json");
}

function readAll() {
  if (cache && typeof cache === "object") return cache;
  let parsed = null;
  try {
    parsed = JSON.parse(fs.readFileSync(settingsPath(), "utf8"));
  } catch {
    parsed = null;
  }
  cache = parsed && typeof parsed === "object" ? parsed : {};
  return cache;
}

function writeAll() {
  try {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify(cache ?? {}, null, 2), "utf8");
  } catch {
    // unwritable location: settings live for the session only
  }
}

function initSettings(app) {
  appRef = app;
  cache = null;
}

function getAllSettings() {
  return { ...readAll() };
}

function getSetting(key, fallback) {
  const all = readAll();
  return all[key] !== undefined ? all[key] : fallback;
}

function setSetting(key, value) {
  const all = readAll();
  all[key] = value;
  writeAll();
  return value;
}

module.exports = { initSettings, getAllSettings, getSetting, setSetting, settingsPath };
