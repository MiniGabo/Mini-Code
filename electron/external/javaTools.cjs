const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
function javaBinary() {
  if (process.env.JAVA_HOME) {
    const exe = process.platform === "win32" ? "java.exe" : "java";
    return path.join(process.env.JAVA_HOME, "bin", exe);
  }
  return process.platform === "win32" ? "java.exe" : "java";
}

function toolNextToJava(name) {
  const jb = javaBinary();
  const dir = path.dirname(jb);
  const exe = process.platform === "win32" ? name + ".exe" : name;
  const full = path.join(dir, exe);
  if (path.isAbsolute(jb) || path.dirname(jb) !== ".") {
    try {
      if (fs.existsSync(full)) return full;
    } catch {
      // seguir con el nombre del PATH
    }
  }
  return process.platform === "win32" ? exe : name;
}

function fernflowerJar(app) {
  const base = app.isPackaged
    ? path.join(process.resourcesPath, "lsp-servers", "fernflower")
    : path.join(app.getAppPath(), "lsp-servers", "fernflower");
  return path.join(base, "fernflower.jar");
}
function cacheKey(s) {
  return crypto.createHash("sha1").update(s).digest("hex").slice(0, 16);
}

module.exports = { javaBinary, toolNextToJava, fernflowerJar, cacheKey };
