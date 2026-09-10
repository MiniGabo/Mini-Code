// Registro central de comandos. por comandos registrables: el día que haya
// plugins o terminal, añaden comandos acá sin tocar App.

export interface Command {
  id: string;
  title: string;
  /** Atajo canónico, p. ej. "ctrl+s", "ctrl+shift+e". Solo informativo. */
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

export function listCommands(): Command[] {
  return [...commands.values()];
}

function keyOf(e: KeyboardEvent, isMac: boolean): string | null {
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (!mod) return null;
  const k = e.key.toLowerCase();
  const shift = e.shiftKey ? "+shift" : "";
  return `ctrl${shift}+${k}`;
}

/**
 * Conecta el mapa de atajos -> ids de comando. App lo llama una vez con
 * sus handlers; los tests pueden llamar runCommand directamente.
 */
export function handleShortcutEvent(
  e: KeyboardEvent,
  bindings: Record<string, string>,
  isMac: boolean,
): boolean {
  const key = keyOf(e, isMac);
  if (!key) return false;
  const id = bindings[key];
  if (!id) return false;
  const cmd = commands.get(id);
  if (!cmd) return false;
  e.preventDefault();
  void cmd.run();
  return true;
}
