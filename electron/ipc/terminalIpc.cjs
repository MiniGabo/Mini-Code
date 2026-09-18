// Integrated terminal backend (Option B: real PTY via node-pty).
// Single persistent shell session: the panel attaches/detaches on show/hide
// (Alt+T) without spawning or killing anything, so toggling is cheap and
// never leaks shells. Only an explicit close (restart button) or the shell
// exiting on its own ends the session. Pausing while detached stops PTY -> IPC
// traffic when nobody is watching.
//
// node-pty 1.x is N-API, so the prebuilt binary works in Electron without a rebuild.
//
// Windows note: killing a ConPTY session with the default backend forks
// conpty_console_list_agent, which crashes inside Electron ("AttachConsole
// failed"). Spawning with useConptyDll uses the bundled conpty.dll backend
// whose kill path needs no agent process (falls back to the default backend
// if the DLL one fails to spawn).
const fs = require("fs/promises");
const os = require("os");

let pty = null;
let ptyError = null;
try {
  pty = require("node-pty");
} catch (err) {
  ptyError = err;
}

/** At most one live shell. { id, proc } or null. */
let session = null;
let nextId = 1;

const MIN_COLS = 2;
const MAX_COLS = 500;
const MIN_ROWS = 2;
const MAX_ROWS = 200;

function clamp(n, min, max, fallback) {
  const v = parseInt(String(n ?? ""), 10);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

function defaultShell() {
  if (process.platform === "win32") {
    return { shell: "powershell.exe", args: ["-NoLogo"] };
  }
  return { shell: process.env.SHELL || "/bin/bash", args: [] };
}

async function resolveCwd(cwd) {
  if (typeof cwd === "string" && cwd) {
    try {
      const st = await fs.stat(cwd);
      if (st.isDirectory()) return cwd;
    } catch {
      // falls through to home
    }
  }
  return os.homedir();
}

function sendToWindow(getWindow, channel, value) {
  try {
    const win = typeof getWindow === "function" ? getWindow() : null;
    if (!win || win.isDestroyed()) return;
    win.webContents.send(channel, value);
  } catch {
    // window gone: drop the chunk
  }
}

function spawnShell(startCwd, cols, rows) {
  const { shell, args } = defaultShell();
  const baseOpts = {
    name: "xterm-256color",
    cwd: startCwd,
    cols,
    rows,
    env: { ...process.env, TERM: "xterm-256color" },
  };
  // Prefer the conpty.dll backend (kill needs no helper process); fall back
  // to the default backend when it cannot spawn.
  if (process.platform === "win32") {
    try {
      return pty.spawn(shell, args, { ...baseOpts, useConptyDll: true });
    } catch {
      // falls through to the default backend below
    }
  }
  return pty.spawn(shell, args, baseOpts);
}

function forgetSession(id) {
  if (session && session.id === Number(id)) session = null;
}

function killSession(id) {
  const target = session && session.id === Number(id) ? session : null;
  if (!target) return;
  session = null;
  try {
    target.proc.kill();
  } catch {
    // already dead
  }
}

function register({ ipcMain, getWindow }) {
  // Attach to the persistent shell, spawning it on first use. Never kills:
  // hiding the panel is just a detach (pause + drop listeners on the
  // renderer side).
  ipcMain.handle("terminal:open", async (_event, { cwd, cols, rows } = {}) => {
    if (!pty) {
      return { ok: false, error: `node-pty no disponible: ${ptyError?.message ?? ptyError}` };
    }
    const c = clamp(cols, MIN_COLS, MAX_COLS, 80);
    const r = clamp(rows, MIN_ROWS, MAX_ROWS, 24);
    if (session) {
      try {
        session.proc.resume();
      } catch {
        // resume best-effort
      }
      try {
        session.proc.resize(c, r);
      } catch {
        // resize best-effort (e.g. exited between handlers)
      }
      return { ok: true, id: session.id, reused: true };
    }
    const startCwd = await resolveCwd(cwd);
    let proc;
    try {
      proc = spawnShell(startCwd, c, r);
    } catch (err) {
      return { ok: false, error: String(err?.message ?? err) };
    }
    const id = nextId++;
    session = { id, proc };
    proc.onData((data) => sendToWindow(getWindow, "terminal:data", { id, data }));
    proc.onExit(({ exitCode }) => {
      forgetSession(id);
      sendToWindow(getWindow, "terminal:exit", { id, exitCode });
    });
    return { ok: true, id, reused: false };
  });

  ipcMain.handle("terminal:write", async (_event, { id, data } = {}) => {
    if (!session || session.id !== Number(id)) return { ok: false };
    try {
      session.proc.write(String(data ?? ""));
    } catch {
      return { ok: false };
    }
    return { ok: true };
  });

  ipcMain.handle("terminal:resize", async (_event, { id, cols, rows } = {}) => {
    if (!session || session.id !== Number(id)) return { ok: false };
    try {
      session.proc.resize(clamp(cols, MIN_COLS, MAX_COLS, 80), clamp(rows, MIN_ROWS, MAX_ROWS, 24));
    } catch {
      return { ok: false };
    }
    return { ok: true };
  });

  // Pause PTY output while the panel is hidden (detach). Cheap guard against
  // background output (watchers, servers) burning IPC/CPU with no viewer.
  ipcMain.handle("terminal:pause", async (_event, { id } = {}) => {
    if (!session || session.id !== Number(id)) return { ok: false };
    try {
      session.proc.pause();
    } catch {
      return { ok: false };
    }
    return { ok: true };
  });

  // Explicit kill of the persistent session (kill button / Alt+K).
  // Hiding the panel never calls this. The shell's exit is reported through
  // "terminal:exit" like any other exit, so an attached frontend shows its
  // usual terminated state with a restart option.
  ipcMain.handle("terminal:closeAll", async () => {
    if (!session) return { ok: true, killed: false };
    const { proc } = session;
    session = null;
    try {
      proc.kill();
    } catch {
      // already dead
    }
    return { ok: true, killed: true };
  });
}

function killAllTerminals() {
  if (!session) return;
  const { proc } = session;
  session = null;
  try {
    proc.kill();
  } catch {
    // best-effort
  }
}

module.exports = { registerTerminal: register, killAllTerminals };
