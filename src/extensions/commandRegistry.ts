// Central command registry for built-in commands (App's global shortcuts).
// Extension contributions were removed in the v2 theme-only model: extensions
// contribute theme data, never commands, so everything registered here is
// first-party and always available.

export interface Command {
  id: string;
  title: string;
  /** Canonical shortcut, e.g. "ctrl+s", "ctrl+shift+e", "alt+t". Informational only. */
  shortcut?: string;
  run: () => void | Promise<void>;
}

const commands = new Map<string, Command>();

export function registerCommand(cmd: Command): () => void {
  commands.set(cmd.id, cmd);
  return () => {
    if (commands.get(cmd.id) === cmd) commands.delete(cmd.id);
  };
}

export function getCommand(id: string): Command | undefined {
  return commands.get(id);
}

/** Removes a command by id (used by the extension loader on unload). */
export function unregisterCommand(id: string): void {
  commands.delete(id);
}

export function listCommands(): Command[] {
  return [...commands.values()];
}

function keyOf(e: KeyboardEvent, isMac: boolean): string | null {
  const k = e.key.toLowerCase();
  if (k.length !== 1 && k !== "," && k !== ".") {
    // Keep single-char keys plus the "," / "." used by existing commands.
    // Anything else (Enter, Escape, F-keys...) is not a command shortcut.
    return null;
  }
  const shift = e.shiftKey ? "+shift" : "";
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (mod) return `ctrl${shift}+${k}`;
  // Alt-only shortcuts (e.g. Alt+T for the integrated terminal). Requires
  // Alt without Ctrl/Meta so Ctrl+Alt combos don't collide on Windows.
  if (e.altKey && !e.ctrlKey && !e.metaKey) return `alt${shift}+${k}`;
  return null;
}

/**
 * Connects the shortcut -> command-id map. App calls it once with
 * its handlers; tests can call runCommand directly.
 */
export function handleShortcutEvent(
  e: KeyboardEvent,
  bindings: Record<string, string>,
  isMac: boolean,
): boolean {
  const key = keyOf(e, isMac);
  if (!key) return false;
  // Alt-key toggles (e.g. Alt+T): holding the keys must not flip the panel
  // back on via OS key auto-repeat right after closing it.
  if (e.repeat && key.startsWith("alt+")) return false;
  const id = bindings[key];
  if (!id) return false;
  const cmd = commands.get(id);
  if (!cmd) return false;
  e.preventDefault();
  void cmd.run();
  return true;
}
