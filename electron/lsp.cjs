/* Minimal LSP client (JSON-RPC over stdio) for java-language-server.
 *
 * It lives in the main process: it spawns `org.javacs.Main` with the system JDK,
 * keeps the initialize/initialized/shutdown/exit cycle going and forwards
 * notifications (diagnostics) to the renderer. The renderer never talks
 * to the server directly: it uses the `lsp:*` handlers in main.cjs.
 */
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const { t } = require("./i18n.cjs");

const JAVA_EXPORTS = [
  "--add-exports",
  "jdk.compiler/com.sun.tools.javac.api=ALL-UNNAMED",
  "--add-exports",
  "jdk.compiler/com.sun.tools.javac.code=ALL-UNNAMED",
  "--add-exports",
  "jdk.compiler/com.sun.tools.javac.comp=ALL-UNNAMED",
  "--add-exports",
  "jdk.compiler/com.sun.tools.javac.main=ALL-UNNAMED",
  "--add-exports",
  "jdk.compiler/com.sun.tools.javac.tree=ALL-UNNAMED",
  "--add-exports",
  "jdk.compiler/com.sun.tools.javac.model=ALL-UNNAMED",
  "--add-exports",
  "jdk.compiler/com.sun.tools.javac.util=ALL-UNNAMED",
  "--add-opens",
  "jdk.compiler/com.sun.tools.javac.api=ALL-UNNAMED",
];

function serverBaseDir(app) {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "lsp-servers", "java-language-server");
  }
  return path.join(app.getAppPath(), "lsp-servers", "java-language-server");
}

function configuredJdkHome() {
  try {
    const { getSetting } = require("./settings.cjs");
    const home = getSetting("jdkPath", "");
    if (typeof home === "string" && home.trim()) return home.trim();
  } catch {
    // no settings file: auto-detect
  }
  return "";
}

async function resolveJava(rootDir, serverJar) {
  const exe = process.platform === "win32" ? "java.exe" : "java";
  const launchable = (h) => {
    try {
      return fs.statSync(path.join(h, "bin", exe)).isFile();
    } catch {
      return false;
    }
  };
  const { selectProjectJdk, jdkMajorOf, serverRequiredMajor } = require("./external/projectJdk.cjs");
  const { jdkHomes } = require("./external/jdk.cjs");
  const serverMin = (await serverRequiredMajor(serverJar)) ?? 9;
  // Lowest installed JDK able to RUN the server ("the minimum required").
  const lowestCapable = () => {
    let best = null;
    let bestMajor = Infinity;
    for (const h of jdkHomes()) {
      const m = jdkMajorOf(h);
      if (m === null || m < serverMin || m >= bestMajor || !launchable(h)) continue;
      best = h;
      bestMajor = m;
    }
    return best;
  };
  // 1. Explicit UI setting (validated): the user knows best, but a JDK older
  // than the server minimum cannot launch it -> minimum required + warning.
  const configured = configuredJdkHome();
  if (configured) {
    const cand = path.join(configured, "bin", exe);
    if (fs.existsSync(cand)) {
      const major = jdkMajorOf(configured);
      if (major === null || major >= serverMin) return { bin: cand, warning: null };
      const best = lowestCapable();
      if (best) {
        return {
          bin: path.join(best, "bin", exe),
          warning: t("settings.java.jdkTooOld", {
            found: major,
            min: serverMin,
            used: path.basename(best),
          }),
        };
      }
      return { bin: cand, warning: null }; // nothing better: try anyway, stderr will explain
    }
    console.warn(`[lsp] jdkPath invalid (${configured}), falling back to auto-detect`);
    return { bin: autoJavaBinary(), warning: t("settings.java.jdkInvalid", { exe, path: configured }) };
  }
  // 2. Build-declared Java version (falls back to first found inside).
  try {
    const sel = selectProjectJdk({ rootDir });
    if (sel.home) {
      const major = jdkMajorOf(sel.home);
      if (major === null || major >= serverMin) {
        return { bin: path.join(sel.home, "bin", exe), warning: null };
      }
      // Build JDK too old to run the server: minimum required instead.
      console.warn(`[lsp] build JDK is Java ${major}: server needs Java ${serverMin}+`);
      const best = lowestCapable();
      if (best) return { bin: path.join(best, "bin", exe), warning: null };
    }
  } catch {
    // selection failed: fall through to auto-detect
  }
  // 3. Auto-detect (JAVA_HOME or PATH).
  return { bin: autoJavaBinary(), warning: null };
}

function autoJavaBinary() {
  if (process.env.JAVA_HOME) {
    const exe = process.platform === "win32" ? "java.exe" : "java";
    return path.join(process.env.JAVA_HOME, "bin", exe);
  }
  return process.platform === "win32" ? "java.exe" : "java";
}

function javaXmxFlag() {
  // Explicit UI setting wins (strict shape guards a hand-edited settings.json);
  // MINICODE_JAVA_XMX stays as power-user fallback.
  try {
    const { getSetting } = require("./settings.cjs");
    const v = getSetting("javaXmx", "");
    if (typeof v === "string" && /^\d+[mMgG]$/.test(v.trim())) return "-Xmx" + v.trim();
  } catch {
    // no settings file: defaults below
  }
  return process.env.MINICODE_JAVA_XMX || "-Xmx768m";
}

// The server invokes `mvn` to infer dependencies (InferConfig). Since
// Electron doesn't always inherit the terminal's PATH, typical
// Maven locations are searched and prepended to the child's PATH (best-effort).
function extraPathDirs() {
  const dirs = [];
  for (const v of [process.env.MAVEN_HOME, process.env.M2_HOME]) {
    if (!v) continue;
    const bin = path.join(v, "bin");
    if (fs.existsSync(path.join(bin, process.platform === "win32" ? "mvn.cmd" : "mvn"))) {
      dirs.push(bin);
    }
  }
  if (process.platform === "win32") {
    try {
      for (const entry of fs.readdirSync("C:\\", { withFileTypes: true })) {
        if (!entry.isDirectory() || !/^apache-maven/i.test(entry.name)) continue;
        const bin = path.join("C:\\", entry.name, "bin");
        if (fs.existsSync(path.join(bin, "mvn.cmd"))) dirs.push(bin);
      }
    } catch {
      // no access to the root: skipped
    }
  }
  return [...new Set(dirs)];
}

function toRootUri(rootPath) {
  let p = path.resolve(rootPath).replace(/\\/g, "/");
  // file:///C:/... (encodes spaces and special characters)
  return "file://" + (p.startsWith("/") ? "" : "/") + encodeURI(p);
}

/** Last non-empty stderr lines (bounded): surfaces the real JVM/server reason. */
function stderrTail(text) {
  return String(text ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-3)
    .join(" | ");
}

class JavaLanguageClient {
  constructor({ app, onNotification, onUnexpectedExit }) {
    this.app = app;
    this.onNotification = onNotification;
    this.onUnexpectedExit = onUnexpectedExit;
    this.proc = null;
    this.rootPath = null;
    this.buffer = Buffer.alloc(0);
    this.nextId = 1;
    this.pending = new Map(); // id -> { resolve, reject, timer }
    this.versions = new Map(); // uri -> version
    this.ready = false;
    this.expectExit = false;
    this.lastAutoRestart = 0;
  }

  isRunning() {
    return !!this.proc && !this.proc.killed && this.proc.exitCode === null;
  }

  serverJars() {
    const base = serverBaseDir(this.app);
    const cpDir = path.join(base, "dist", "classpath");
    const jars = ["gson-2.8.9.jar", "protobuf-java-3.25.5.jar", "java-language-server.jar"].map(
      (j) => path.join(cpDir, j)
    );
    const missing = jars.filter((j) => !fs.existsSync(j));
    if (missing.length > 0) {
      throw new Error(t("main.missingJars", { jars: missing.join(", ") }));
    }
    return jars;
  }

  async start(rootPath) {
    const resolved = path.resolve(rootPath);
    if (this.isRunning() && this.rootPath === resolved && this.ready) return;
    await this.stop();

    const jars = this.serverJars();
    const cp = jars.join(process.platform === "win32" ? ";" : ":");
    const rootUri = toRootUri(resolved);

    const extraDirs = extraPathDirs();
    const childEnv = {
      ...process.env,
      PATH: [...extraDirs, process.env.PATH ?? ""].join(path.delimiter),
    };

    // JVM memory cap. Without -Xmx the language server's JVM
    // would grow freely (1-2 GB typical). 768M performs well on normal projects;
    // it can be raised in Settings or with MINICODE_JAVA_XMX=1G if a giant project needs it.
    // TieredStopAtLevel=1 speeds up startup and lowers initial CPU.
    const javaXmx = javaXmxFlag();
    const JAVA_MEM = [
      "-Xms256m",
      javaXmx,
      "-XX:+UseG1GC",
      "-XX:MaxGCPauseMillis=200",
      "-XX:+TieredCompilation",
      "-XX:TieredStopAtLevel=1",
      "-Dfile.encoding=UTF-8",
    ];
    this.expectExit = false;
    const serverJar = jars.find((j) => path.basename(j) === "java-language-server.jar") ?? jars[jars.length - 1];
    const { bin: javaBin, warning: jdkWarning } = await resolveJava(resolved, serverJar);
    this.jdkWarning = jdkWarning;
    this.proc = spawn(javaBin, [...JAVA_MEM, ...JAVA_EXPORTS, "-classpath", cp, "org.javacs.Main"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: childEnv,
    });
    // Generation: ignore late events from already replaced processes
    const gen = (this.generation = (this.generation ?? 0) + 1);
    this.rootPath = resolved;
    this.ready = false;
    this.buffer = Buffer.alloc(0);

    this.proc.stdout.on("data", (chunk) => this.onData(chunk));
    // Keep the stderr tail (bounded): the pipe must be drained so the child
    // never blocks, and the tail diagnoses startup failures.
    this.lastStderr = "";
    this.proc.stderr.on("data", (chunk) => {
      try {
        this.lastStderr = (this.lastStderr + chunk.toString("utf8")).slice(-4000);
      } catch {
        // binary noise: ignore
      }
    });
    this.proc.on("exit", (code, signal) => {
      if (gen !== this.generation) return; // old process, ignore
      const unexpected = !this.expectExit;
      this.proc = null;
      this.ready = false;
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new Error(t("main.serverDied")));
      }
      this.pending.clear();
      if (unexpected && this.onUnexpectedExit) {
        this.onUnexpectedExit({ code, signal, rootPath: this.rootPath });
      }
    });
    this.proc.on("error", (err) => {
      this.proc = null;
      this.ready = false;
      throw err;
    });

    // Brief wait to detect an immediate startup failure (no java, etc.)
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 800);
      this.proc.once("exit", () => {
        clearTimeout(timer);
        const tail = stderrTail(this.lastStderr);
        reject(new Error(tail ? `${t("main.startFailed")} — ${tail}` : t("main.startFailed")));
      });
      this.proc.once("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
    if (!this.isRunning()) {
      const tail = stderrTail(this.lastStderr);
      throw new Error(tail ? `${t("main.notRunning")} — ${tail}` : t("main.notRunning"));
    }

    // initialize goes through requestRaw directly, not request():
    // request() requires ready=true and nothing is ready before initialize.
    const result = await this.requestRaw(
      this.proc,
      "initialize",
      {
        processId: process.pid,
        rootUri,
        capabilities: {
          textDocument: {
            publishDiagnostics: {},
            completion: {
              completionItem: { documentationFormat: ["markdown", "plaintext"] },
            },
            hover: { contentFormat: ["markdown", "plaintext"] },
            signatureHelp: {},
          },
        },
      },
      30000
    );
    if (result == null || typeof result !== "object") {
      throw new Error(t("main.badInit"));
    }
    this.notify("initialized", {});
    this.ready = true;
    return result.capabilities ?? null;
  }

  async stop() {
    const proc = this.proc;
    this.generation = (this.generation ?? 0) + 1;
    this.expectExit = true;
    this.proc = null;
    this.ready = false;
    this.versions.clear();
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error(t("main.clientStopped")));
    }
    this.pending.clear();
    if (!proc) return;
    try {
      await this.requestRaw(proc, "shutdown", null, 5000).catch(() => null);
      this.sendRaw(proc, { jsonrpc: "2.0", method: "exit" });
    } catch {
      // proceed with the kill
    }
    if (!proc.killed && proc.exitCode === null) {
      proc.kill();
    }
  }

  sendRaw(proc, message) {
    const body = Buffer.from(JSON.stringify(message), "utf8");
    const head = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii");
    proc.stdin.write(Buffer.concat([head, body]));
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const sep = this.buffer.indexOf("\r\n\r\n");
      if (sep === -1) return;
      const head = this.buffer.slice(0, sep).toString("ascii");
      const match = /Content-Length:\s*(\d+)/i.exec(head);
      if (!match) {
        this.buffer = this.buffer.slice(sep + 4);
        continue;
      }
      const length = parseInt(match[1], 10);
      if (this.buffer.length < sep + 4 + length) return;
      const body = this.buffer.slice(sep + 4, sep + 4 + length).toString("utf8");
      this.buffer = this.buffer.slice(sep + 4 + length);
      let message;
      try {
        message = JSON.parse(body);
      } catch {
        continue;
      }
      this.dispatch(message);
    }
  }

  dispatch(message) {
    if (message.id != null && (message.result !== undefined || message.error !== undefined)) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error !== undefined) {
        pending.reject(new Error(message.error.message || t("main.serverError")));
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    if (message.method && this.onNotification) {
      this.onNotification(message.method, message.params ?? {});
    }
  }

  requestRaw(proc, method, params, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(t("main.timeout", { method })));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        const payload = { jsonrpc: "2.0", id, method };
        if (params !== undefined && params !== null) payload.params = params;
        this.sendRaw(proc, payload);
      } catch (err) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(err);
      }
    });
  }

  async request(method, params, timeoutMs) {
    // Auto-recovery with a brake ONLY if the process died (not if it is
    // starting: a request mid-startup must not kill the nascent
    // process). A single retry per minute.
    if (!this.isRunning()) {
      const now = Date.now();
      if (this.rootPath && now - this.lastAutoRestart > 60000) {
        this.lastAutoRestart = now;
        try {
          await this.start(this.rootPath);
        } catch {
          // failed retry: it will be reported on the next request
        }
      }
    }
    if (!this.isRunning() || !this.ready) {
      throw new Error(t("main.notStarted"));
    }
    return this.requestRaw(this.proc, method, params, timeoutMs);
  }

  notify(method, params) {
    if (!this.isRunning()) return;
    try {
      this.sendRaw(this.proc, { jsonrpc: "2.0", method, params: params ?? {} });
    } catch {
      // best-effort notifications
    }
  }

  didOpen(uri, languageId, text) {
    if (!this.isRunning()) return;
    // Idempotent: a second didOpen without didClose (StrictMode, remount)
    // must not re-open the doc on the server. It is
    // re-synced as a change and the version is kept.
    if (this.versions.has(uri)) {
      this.didChange(uri, text);
      return;
    }
    this.versions.set(uri, 1);
    this.notify("textDocument/didOpen", {
      textDocument: { uri, languageId, version: 1, text },
    });
  }

  didChange(uri, text) {
    if (!this.isRunning()) return;
    // didChange arrives on every typing pause; no logging in prod.
    const version = (this.versions.get(uri) ?? 0) + 1;
    this.versions.set(uri, version);
    // Full replacement: valid even if the server advertises incremental sync
    this.notify("textDocument/didChange", {
      textDocument: { uri, version },
      contentChanges: [{ text }],
    });
  }

  didClose(uri) {
    if (!this.isRunning()) return;
    // Only close known docs: avoids orphan didClose from the double
    // mount that closed a doc still open in the editor.
    if (!this.versions.has(uri)) return;
    this.versions.delete(uri);
    this.notify("textDocument/didClose", { textDocument: { uri } });
  }
}

module.exports = { JavaLanguageClient, toRootUri };
