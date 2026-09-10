/* Cliente LSP mínimo (JSON-RPC por stdio) para java-language-server.
 *
 * Vive en el proceso main: lanza `org.javacs.Main` con el JDK del sistema,
 * mantiene el ciclo initialize/initialized/shutdown/exit y traduce
 * notificaciones (diagnósticos) hacia el renderer. El renderer nunca habla
 * con el servidor directamente: usa los handlers `lsp:*` de main.cjs.
 */
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

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

function javaBinary() {
  if (process.env.JAVA_HOME) {
    const exe = process.platform === "win32" ? "java.exe" : "java";
    return path.join(process.env.JAVA_HOME, "bin", exe);
  }
  return process.platform === "win32" ? "java.exe" : "java";
}

// El servidor invoca `mvn` para inferir dependencias (InferConfig). Como
// Electron no siempre hereda el PATH de la terminal, se buscan ubicaciones
// típicas de Maven y se anteponen al PATH del hijo (best-effort).
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
      // sin acceso al raíz: se omite
    }
  }
  return [...new Set(dirs)];
}

function toRootUri(rootPath) {
  let p = path.resolve(rootPath).replace(/\\/g, "/");
  // file:///C:/... (codifica espacios y caracteres especiales)
  return "file://" + (p.startsWith("/") ? "" : "/") + encodeURI(p);
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
      throw new Error(
        "Faltan los jars del language server, que raro, en: " + missing.join(", ")
      );
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

    // Techo de memoria JVM. Sin -Xmx la JVM del language server
    // crecía libre (1-2 GB típico). 768M rinde bien en proyectos normales;
    // se puede subir con MINICODE_JAVA_XMX=1G si un proyecto gigante lo pide.
    // TieredStopAtLevel=1 acelera el arranque y baja CPU inicial.
    const javaXmx = process.env.MINICODE_JAVA_XMX || "-Xmx768m";
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
    this.proc = spawn(javaBinary(), [...JAVA_MEM, ...JAVA_EXPORTS, "-classpath", cp, "org.javacs.Main"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: childEnv,
    });
    // Generación: ignora eventos tardíos de procesos ya reemplazados
    const gen = (this.generation = (this.generation ?? 0) + 1);
    this.rootPath = resolved;
    this.ready = false;
    this.buffer = Buffer.alloc(0);

    this.proc.stdout.on("data", (chunk) => this.onData(chunk));
    // Drenar stderr sin loguear: si nadie lo lee, el pipe se llena y bloquea al hijo.
    this.proc.stderr.on("data", () => {});
    this.proc.on("exit", (code, signal) => {
      if (gen !== this.generation) return; // proceso viejo, ignorar
      const unexpected = !this.expectExit;
      this.proc = null;
      this.ready = false;
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new Error("El language server terminó inesperadamente"));
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

    // Pequeña espera para detectar fallo inmediato de arranque (sin java, etc.)
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 800);
      this.proc.once("exit", () => {
        clearTimeout(timer);
        reject(new Error("El language server terminó al arrancar (¿java disponible?)"));
      });
      this.proc.once("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
    if (!this.isRunning()) {
      throw new Error("El language server no está en ejecución tras el arranque");
    }

    // initialize va por requestRaw directo, no por request():
    // request() exige ready=true y nada está ready antes de initialize.
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
      throw new Error("Respuesta de initialize inválida");
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
      p.reject(new Error("Cliente LSP detenido"));
    }
    this.pending.clear();
    if (!proc) return;
    try {
      await this.requestRaw(proc, "shutdown", null, 5000).catch(() => null);
      this.sendRaw(proc, { jsonrpc: "2.0", method: "exit" });
    } catch {
      // sigue con el kill
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
        pending.reject(new Error(message.error.message || "Error del language server"));
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
        reject(new Error(`Timeout en ${method}`));
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
    // Auto-recuperación con freno SOLO si el proceso murió (no si está
    // arrancando: un request a mitad del arranque no debe matar el proceso
    // naciente). Un solo reintento por minuto.
    if (!this.isRunning()) {
      const now = Date.now();
      if (this.rootPath && now - this.lastAutoRestart > 60000) {
        this.lastAutoRestart = now;
        try {
          await this.start(this.rootPath);
        } catch {
          // reintento fallido: se informará en el próximo request
        }
      }
    }
    if (!this.isRunning() || !this.ready) {
      throw new Error("Language server no iniciado (reabre la carpeta)");
    }
    return this.requestRaw(this.proc, method, params, timeoutMs);
  }

  notify(method, params) {
    if (!this.isRunning()) return;
    try {
      this.sendRaw(this.proc, { jsonrpc: "2.0", method, params: params ?? {} });
    } catch {
      // notificaciones best-effort
    }
  }

  didOpen(uri, languageId, text) {
    if (!this.isRunning()) return;
    // Idempotente: un segundo didOpen sin didClose (StrictMode, remontaje)
    // no debe re-abrir el doc en el servidor. Se
    // re-sincroniza como cambio y se mantiene la versión.
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
    // didChange llega en cada pausa de tecleo; sin log en prod.
    const version = (this.versions.get(uri) ?? 0) + 1;
    this.versions.set(uri, version);
    // Reemplazo total: válido aunque el servidor anuncie sync incremental
    this.notify("textDocument/didChange", {
      textDocument: { uri, version },
      contentChanges: [{ text }],
    });
  }

  didClose(uri) {
    if (!this.isRunning()) return;
    // Solo cerrar docs conocidos: evita didClose huérfanos del doble
    // montaje que cerraban un doc aún abierto en el editor.
    if (!this.versions.has(uri)) return;
    this.versions.delete(uri);
    this.notify("textDocument/didClose", { textDocument: { uri } });
  }
}

module.exports = { JavaLanguageClient, toRootUri };
