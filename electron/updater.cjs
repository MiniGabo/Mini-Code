// Lightweight auto-updater based on the latest.yml published by electron-builder
// on GitHub Releases. No extra dependencies (does not use electron-updater):
//  1. Downloads latest.yml -> reads `version` and the listed installer (.exe).
//  2. Compares semver against app.getVersion().
//  3. If an update exists, the renderer can download the .exe with progress and
//     run it (the NSIS installer takes care of closing/updating the app).
//
// URLs used by electron-builder with the github provider:
//   latest.yml -> https://github.com/<owner>/<repo>/releases/latest/download/latest.yml
//   installer  -> https://github.com/<owner>/<repo>/releases/download/v<version>/<file>
const https = require("https");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

const OWNER = "MiniGabo";
const REPO = "Mini-Code";
const LATEST_YML_URL = `https://github.com/${OWNER}/${REPO}/releases/latest/download/latest.yml`;
const RELEASE_PAGE_URL = `https://github.com/${OWNER}/${REPO}/releases/latest`;

const REQUEST_TIMEOUT_MS = 15000;
const MAX_REDIRECTS = 5;

function fetchText(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > MAX_REDIRECTS) {
      reject(new Error("too many redirects"));
      return;
    }
    let parsed;
    try {
      parsed = new URL(url);
    } catch (err) {
      reject(err);
      return;
    }
    const lib = parsed.protocol === "http:" ? http : https;
    const req = lib.request(
      parsed,
      {
        method: "GET",
        headers: {
          "User-Agent": "Mini-Code-Updater",
          Accept: "text/yaml, text/plain, */*",
          "Cache-Control": "no-cache",
        },
      },
      (res) => {
        const { statusCode, headers } = res;
        if (statusCode >= 300 && statusCode < 400 && headers.location) {
          res.resume();
          const next = new URL(headers.location, url).toString();
          fetchText(next, redirects + 1).then(resolve, reject);
          return;
        }
        if (statusCode !== 200) {
          res.resume();
          reject(new Error(`latest.yml HTTP ${statusCode}`));
          return;
        }
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
          if (body.length > 512 * 1024) {
            req.destroy(new Error("latest.yml too large"));
          }
        });
        res.on("end", () => resolve(body));
        res.on("error", reject);
      }
    );
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error("timeout checking for updates"));
    });
    req.on("error", reject);
    req.end();
  });
}

// Minimal YAML parser, just enough for electron-builder's latest.yml:
//   version: 0.0.3
//   files:
//     - url: Mini Code Setup 0.0.3.exe
//       sha512: abc...
//       size: 123456
//   path: Mini Code Setup 0.0.3.exe
//   releaseDate: ...
function parseLatestYml(text) {
  const lines = String(text || "").split(/\r?\n/);
  let version = null;
  let topPath = null;
  const files = [];
  let inFiles = false;
  let current = null;
  for (const raw of lines) {
    const line = raw.replace(/\t/g, "  ");
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    // Top-level key (not indented): "version: x", "path: y", "files:"
    if (/^[^\s]/.test(line)) {
      inFiles = /^files\s*:/.test(trimmed);
      const m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(trimmed);
      if (m) {
        const key = m[1];
        const value = m[2].trim().replace(/^["']|["']$/g, "");
        if (key === "version" && value) version = value;
        if (key === "path" && value) topPath = value;
      }
      continue;
    }
    if (inFiles) {
      const itemStart = /^\s*-\s*(.*)$/.exec(line);
      if (itemStart) {
        current = {};
        files.push(current);
        const rest = itemStart[1].trim();
        if (rest) {
          const m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(rest);
          if (m) current[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
        }
      } else if (current) {
        const m = /^\s+([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
        if (m) current[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
      }
    }
  }
  return { version, path: topPath, files };
}

function normalizeVersion(v) {
  return String(v || "")
    .trim()
    .replace(/^v/i, "");
}

// -1 if a < b, 0 if equal, 1 if a > b. Numeric parts + simple suffix only.
function compareVersions(a, b) {
  const pa = normalizeVersion(a).split("-");
  const pb = normalizeVersion(b).split("-");
  const na = pa[0].split(".").map((x) => parseInt(x, 10));
  const nb = pb[0].split(".").map((x) => parseInt(x, 10));
  const len = Math.max(na.length, nb.length);
  for (let i = 0; i < len; i++) {
    const x = Number.isFinite(na[i]) ? na[i] : 0;
    const y = Number.isFinite(nb[i]) ? nb[i] : 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  const sa = pa[1] || "";
  const sb = pb[1] || "";
  if (sa === sb) return 0;
  // No suffix (release) > suffixed (prerelease).
  if (!sa && sb) return 1;
  if (sa && !sb) return -1;
  return sa < sb ? -1 : 1;
}

function pickInstallerFile(files, fallbackPath) {
  const list = Array.isArray(files) ? files : [];
  // Prefer the NSIS installer .exe (not the -blockmap file).
  const exe =
    list.find((f) => typeof f?.url === "string" && /\.exe$/i.test(f.url) && !/blockmap/i.test(f.url)) ||
    list.find((f) => typeof f?.url === "string" && !/blockmap/i.test(f.url)) ||
    null;
  if (exe) {
    return {
      fileName: exe.url,
      sha512: typeof exe.sha512 === "string" ? exe.sha512 : null,
      size: Number.isFinite(Number(exe.size)) ? Number(exe.size) : null,
    };
  }
  if (fallbackPath) {
    return { fileName: fallbackPath, sha512: null, size: null };
  }
  return null;
}

function downloadUrlFor(version, fileName) {
  const v = normalizeVersion(version);
  return `https://github.com/${OWNER}/${REPO}/releases/download/v${v}/${encodeURIComponent(fileName).replace(/%20/g, "%20")}`;
}

async function checkForUpdates(app) {
  const currentVersion = app ? app.getVersion() : require("../package.json").version;
  let yml;
  try {
    yml = await fetchText(LATEST_YML_URL);
  } catch (err) {
    return { ok: false, currentVersion, latestVersion: null, updateAvailable: false, error: String((err && err.message) || err) };
  }
  const parsed = parseLatestYml(yml);
  if (!parsed.version) {
    return { ok: false, currentVersion, latestVersion: null, updateAvailable: false, error: "latest.yml sin campo version" };
  }
  const latestVersion = normalizeVersion(parsed.version);
  const cmp = compareVersions(currentVersion, latestVersion);
  if (cmp >= 0) {
    return { ok: true, currentVersion, latestVersion, updateAvailable: false };
  }
  const file = pickInstallerFile(parsed.files, parsed.path);
  if (!file) {
    return { ok: false, currentVersion, latestVersion, updateAvailable: true, error: "latest.yml sin instalador" };
  }
  return {
    ok: true,
    currentVersion,
    latestVersion,
    updateAvailable: true,
    fileName: file.fileName,
    size: file.size,
    sha512: file.sha512,
    downloadUrl: downloadUrlFor(latestVersion, file.fileName),
    releasePage: RELEASE_PAGE_URL,
  };
}

function downloadUpdate(downloadUrl, expectedSha512, onProgress, signal) {
  return new Promise((resolve, reject) => {
    const start = (url, redirects = 0) => {
      if (signal && signal.aborted) {
        reject(new Error("descarga cancelada"));
        return;
      }
      if (redirects > MAX_REDIRECTS) {
        reject(new Error("too many redirects"));
        return;
      }
      let parsed;
      try {
        parsed = new URL(url);
      } catch (err) {
        reject(err);
        return;
      }
      const lib = parsed.protocol === "http:" ? http : https;
      const req = lib.request(
        parsed,
        { method: "GET", headers: { "User-Agent": "Mini-Code-Updater", Accept: "*/*" } },
        (res) => {
          const { statusCode, headers } = res;
          if (statusCode >= 300 && statusCode < 400 && headers.location) {
            res.resume();
            start(new URL(headers.location, url).toString(), redirects + 1);
            return;
          }
          if (statusCode !== 200) {
            res.resume();
            reject(new Error(`descarga HTTP ${statusCode}`));
            return;
          }
          const total = Number(headers["content-length"]);
          const tmpDir = path.join(os.tmpdir(), "mini-code-updates");
          try {
            fs.mkdirSync(tmpDir, { recursive: true });
          } catch {}
          const urlName = path.basename(parsed.pathname) || "Mini-Code-Setup.exe";
          const fileName = decodeURIComponent(urlName);
          const tmpPath = path.join(tmpDir, fileName);
          const hash = crypto.createHash("sha512");
          const out = fs.createWriteStream(tmpPath);
          let received = 0;
          const onAbort = () => {
            try {
              req.destroy(new Error("descarga cancelada"));
            } catch {}
            try {
              out.destroy();
            } catch {}
          };
          if (signal) signal.addEventListener("abort", onAbort, { once: true });
          res.on("data", (chunk) => {
            received += chunk.length;
            hash.update(chunk);
            if (typeof onProgress === "function") {
              try {
                onProgress({
                  received,
                  total: Number.isFinite(total) ? total : null,
                  percent: Number.isFinite(total) && total > 0 ? Math.min(100, (received / total) * 100) : null,
                });
              } catch {}
            }
          });
          res.pipe(out);
          out.on("finish", () => {
            if (signal) signal.removeEventListener("abort", onAbort);
            out.close(() => {
              if (signal && signal.aborted) {
                try {
                  fs.unlinkSync(tmpPath);
                } catch {}
                reject(new Error("descarga cancelada"));
                return;
              }
              if (expectedSha512) {
                const actual = hash.digest("base64");
                const normalize = (s) => String(s || "").trim().replace(/\s+/g, "");
                if (normalize(actual) !== normalize(expectedSha512)) {
                  try {
                    fs.unlinkSync(tmpPath);
                  } catch {}
                  reject(new Error("checksum sha512 no coincide"));
                  return;
                }
              }
              resolve(tmpPath);
            });
          });
          out.on("error", (err) => {
            if (signal) signal.removeEventListener("abort", onAbort);
            reject(err);
          });
          res.on("error", (err) => {
            if (signal) signal.removeEventListener("abort", onAbort);
            reject(err);
          });
        }
      );
      req.setTimeout(60000, () => req.destroy(new Error("timeout descargando actualización")));
      req.on("error", reject);
      req.end();
    };
    start(downloadUrl);
  });
}

module.exports = {
  OWNER,
  REPO,
  LATEST_YML_URL,
  RELEASE_PAGE_URL,
  checkForUpdates,
  downloadUpdate,
  compareVersions,
  parseLatestYml,
  downloadUrlFor,
};
