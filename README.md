# Mini Code

Lightweight code editor focused on Java, built with Electron + React + Monaco Editor.

## Features

- Syntax highlighting, line numbers, indentation and folding (Monaco, with only
  Java, YAML, XML and Markdown bundled).
- **Java IntelliSense** via `java-language-server` (included in the repo):
  autocompletion with signature + javadoc, hover, signature help, quick fixes
  (e.g. auto-import) and diagnostics with per-file badges.
- **Go to definition** (`Ctrl+Click`): inside the project via LSP; to JDK or
  dependency classes by opening the real source (`src.zip`, `-sources.jar`) or
  decompiling the bytecode with FernFlower in read-only virtual tabs.
- Folder explorer (create/rename/move/delete with undo,
  drag and drop, context menu).
- Tabs, Save / Save As with native dialogs, unsaved-changes warning, recent
  files and welcome screen.

## Requirements

- Node.js 18+
- `pnpm` 12+ (`npm install -g pnpm` if you don't have it installed)
- An installed JDK (for IntelliSense; Maven/Gradle optional to resolve
  project dependencies)

## Installation

```bash
pnpm install
```

## Development (hot reload)

```bash
pnpm electron:dev
```

This starts Vite at `http://localhost:5173` and opens the Electron window pointing at that server.

## Production build

```bash
pnpm electron:build
```

Generates the installers in `release/` using `electron-builder`.
The installer bundles the Java server and FernFlower jars as
`extraResources` (unpacked, so `java` can read them).

## Type checking

```bash
pnpm typecheck
```

Runs `tsc --noEmit` on the renderer.

## Java server (included)

IntelliSense uses a fork of `java-language-server` (georgewfraser) in
`lsp-servers/java-language-server`. Modified for this editor.

```bash
cd lsp-servers/java-language-server
mvn -DskipTests package
```

(Requires a JDK and a one-time download of dependencies to `~/.m2`.)

## Keyboard shortcuts

| Action                        | Windows/Linux      | macOS   |
| ------------------------------ | ------------------- | ------- |
| New folder...                | `Ctrl+N`            | `⌘N`    |
| Open file                   | `Ctrl+O`            | `⌘O`    |
| Open folder                   | `Ctrl+Shift+O`      | `⌘⇧O`   |
| Save                         | `Ctrl+S`            | `⌘S`    |
| Save as                    | `Ctrl+Shift+S`      | `⌘⇧S`   |
| Close tab                  | `Ctrl+W`            | `⌘W`    |
| Show/hide explorer      | `Ctrl+Shift+E`      | `⌘⇧E`   |
| Undo (explorer)           | `Ctrl+Z`            | `⌘Z`    |
| Go to definition                 | `Ctrl+Click`        | `⌘+Click` |

## License

MIT — see [LICENSE](LICENSE). The bundled Java server derives from
[java-language-server](https://github.com/georgewfraser/java-language-server)
(George Fraser, MIT, see `lsp-servers/java-language-server/LICENSE.md`).
