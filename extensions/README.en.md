# Mini Code · Theme extensions (wiki)

Mini Code extensions are **declarative theme packs**: a folder with an
`extension.json` plus one or more JSON theme files. **No third-party code
runs** — a theme is just data (colors, syntax styles, icons, background)
that the host validates and registers (`src/extensions/host.ts`).

- Install: **Settings → Extensions → Install…** (pick the theme's folder)
  or copy the folder manually into the extensions folder:
  - dev: `<project>/extensions` (this very folder).
  - installed app: `<userData>/extensions`.
- Using an installed theme: theme picker in **Settings → Editor**.
- If something fails, it never breaks the editor: warnings and errors show
  up in **Settings → Extensions** and in the console (`[extensions] …`).

## Layout of an extension

```
extensions/<my-theme>/
  extension.json          # manifest (which themes it contributes)
  themes/my-theme.json    # theme file(s)
  icons/*.svg             # optional: file/folder icons
  assets/*                # optional: background image (max 5 MB)
```

---

## `extension.json` (manifest)

```json
{
  "id": "my-theme",
  "name": "My Theme",
  "version": "1.0.0",
  "description": "A warm dark theme (optional).",
  "contributes": {
    "themes": [
      { "id": "my-theme-dark", "label": "My Theme Dark", "uiTheme": "vs-dark", "path": "themes/my-theme.json" }
    ]
  }
}
```

### Manifest properties

| Property      | Required | What it is and what it is for |
|---------------|----------|-------------------------------|
| `id`          | Yes | The **extension** id (not the theme's). Lowercase, numbers and dashes, 2–64 characters (`^[a-z0-9][a-z0-9-]{1,63}$`). Used as the install folder name and to group diagnostics. Two folders with the same `id`: the second one is skipped. |
| `name`        | Yes | Display name in Settings → Extensions. Non-empty text. |
| `version`     | Yes | Strict `X.Y.Z` semver version (e.g. `1.0.0`, no suffixes). Informational only. |
| `description` | No | Free text. Informational only. |
| `contributes` | Yes | Object with the single allowed key: `themes`. Any other key (`commands`, …) is an **error**; a missing or non-object `contributes` is also an error. Unknown top-level keys (e.g. the old `engines`) are silently **ignored**. |

### Each `contributes.themes[]` entry

| Property | Required | What it is and what it is for |
|----------|----------|-------------------------------|
| `id`     | Yes | The **theme** id. It is what shows up in the Settings picker and what gets saved in the configuration. Non-empty and unique within the extension (duplicate = error). If it collides with an already registered theme (another pack or a built-in), that theme is skipped with an error. |
| `label`  | Yes | Display name in the theme picker. Non-empty text. |
| `uiTheme`| Yes | Monaco base: `"vs-dark"` (dark theme) or `"vs"` (light theme). It is the default base; if the theme file declares its own `base`, the file wins. |
| `path`   | Yes | **Relative** path to the theme file inside the extension (e.g. `"themes/my-theme.json"`). No `..`, no absolute paths, no `C:`. The legacy `file` key is also accepted for compatibility. |

`contributes.themes` must be a **non-empty** list; an extension with no
valid themes is not loaded (`sin temas válidos, la extensión no se carga`
error).

---

## Theme file (`themes/*.json`)

```json
{
  "$schema": "minicode-theme#1",
  "name": "My Theme Dark",
  "base": "vs-dark",
  "extends": "mini-code-dark",
  "colors": {
    "editor.background": "#1a1b1c",
    "editor.foreground": "#d4d4d4",
    "terminal.background": "#191a1b"
  },
  "tokenColors": [
    { "scope": ["comment", "comment.doc"], "settings": { "foreground": "#6a7075", "fontStyle": "italic" } },
    { "scope": "keyword", "settings": { "foreground": "#eda05a", "fontStyle": "bold" } }
  ],
  "ui": {
    "bg": "#131313",
    "panel": "#191a1b",
    "border": "#232526",
    "text": "#a7acaf",
    "accent": "#eda05a"
  },
  "icons": {
    "files": { ".java": "icons/java.svg", "pom.xml": "icons/java.svg" },
    "folders": { "src": "icons/folder.svg" },
    "defaultFile": "icons/file.svg",
    "defaultFolder": "icons/folder.svg"
  },
  "background": {
    "file": "assets/bg.svg",
    "opacity": 0.25,
    "fit": "cover",
    "where": ["editor"]
  }
}
```

### Theme file properties

| Property     | Required | What it is and what it is for |
|--------------|----------|-------------------------------|
| `$schema`    | No | Documentation only for whoever edits the JSON. The validator ignores it. |
| `name`       | No | Internal descriptive name. What shows in the picker is the manifest's `label`. Ignored on load. |
| `base`       | No | Monaco base: `"vs-dark"` or `"vs"`. When omitted, the manifest's `uiTheme` is used. **Beware**: an invalid value is a **fatal** error (the theme is skipped). The `uiTheme` alias is also accepted at file level. `base` wins when both are present. |
| `extends`    | No | Id of another theme to **inherit** from (e.g. `"mini-code-dark"`). The child merges the parent's values and its own win (see *Inheritance*). A missing parent or a cycle is harmless: the chain stops and the theme still applies. A non-string/empty value is a **fatal** error. |
| `colors`     | No | Monaco/terminal color map (see *`colors` catalog*). Unknown keys or malformed values → **warning**, that entry is ignored. |
| `tokenColors`| No | Syntax style list (see *`tokenColors`*). Must be a list; otherwise a **warning** and the whole block is ignored. |
| `ui`         | No | Semantic-key map → app CSS variables (see *`ui` catalog*). Unknown keys or malformed values → **warning**. |
| `icons`      | No | SVG icon set (see *`icons`*). When missing or invalid, the built-in icons are used. |
| `background` | No | Background image (see *`background`*). When missing or invalid, there is simply no background. Legacy `wallpaper` alias (warns once and reads the same). |

> Unrecognized top-level keys (like `$schema` or `name`) are ignored
> silently: the format can grow without breaking old themes.

### Color format

Every color accepts `#rgb`, `#rrggbb` or `#rrggbbaa` (upper or lowercase,
normalized to lowercase; `#rgb` is expanded). The alpha channel (`#rrggbbaa`)
lets the background show through surfaces — handy with `background`.

Exception: `tokenColors[].settings.foreground/background` only accept
**opaque** colors (`#rgb` or `#rrggbb`, no alpha) and are stored without `#`
for Monaco.

### Asset paths

Every path (`path`, `icons.*`, `background.file`) must be **relative inside
the extension**: no `..`, no leading `/`, no `C:`. The main process also
jails reads to the extensions folder and caps binaries at **5 MB**
(`png, jpg, jpeg, gif, webp, svg`).

---

## `colors` catalog

Only these keys take effect; anything else produces a warning and is
ignored. You don't need to define them all: whatever is missing is filled
in with the built-in dark theme values.

### Editor (`editor.*`)

| Key | What it paints |
|-----|----------------|
| `editor.background` | Editor background. Accepts alpha. |
| `editor.foreground` | Default code text color. |
| `editorLineNumber.foreground` | Line numbers. |
| `editorLineNumber.activeForeground` | Current line number. |
| `editorCursor.foreground` | Caret. |
| `editor.selectionBackground` | Selection background. |
| `editor.selectionHighlightBackground` | Other occurrences of the selection. |
| `editor.lineHighlightBackground` | Current line background. |
| `editorGutter.background` | Gutter (line-number area). |
| `editorIndentGuide.background` | Indentation guides. |
| `editorIndentGuide.activeBackground` | Current block's guide. |
| `editorBracketMatch.background` / `.border` | Matching bracket highlight. |
| `editorWidget.background` / `.border` | Widgets (suggest, hover). |
| `editorSuggestWidget.selectedBackground` | Selected autocomplete item. |
| `editorHoverWidget.background` / `.border` | Hover documentation popup. |

### Terminal (`terminal.*`)

These go to the terminal panel (xterm). When a key is missing it is derived
from `ui` (`background`←`panel`, `foreground`←`text`, cursor←`accent`,
selection←`border`) and ultimately from the built-in defaults.

| Key | What it paints |
|-----|----------------|
| `terminal.background` / `terminal.foreground` | Terminal background and text. |
| `terminalCursor.foreground` | Terminal cursor. |
| `terminal.selectionBackground` | Terminal selection. |
| `terminal.ansiBlack/Red/Green/Yellow/Blue/Magenta/Cyan/White` | Normal ANSI palette. |
| `terminal.ansiBrightBlack/…/BrightWhite` | Bright ANSI palette. |

---

## `ui` catalog (app chrome)

Each key feeds a CSS variable (`--mc-*`) that paints the interface outside
the editor (bars, explorer, tabs, settings…). Omitted keys use the defaults,
so a minimal 2–3 key theme already looks coherent.

| Key | Variable | Where it shows |
|-----|----------|----------------|
| `bg` | `--mc-bg` | General background, title bar, active tab, panels. |
| `panel` | `--mc-panel` | Explorer, tab bar, dialogs, default terminal background. |
| `border` | `--mc-border` | Borders, dividers, default terminal selection. |
| `text` | `--mc-text` | Primary UI text, default terminal text. |
| `textMuted` | `--mc-text-muted` | Secondary text, placeholders, scrollbar hover. |
| `accent` | `--mc-accent` | Accents: icons, links, kbd, default terminal cursor. |
| `accentStrong` | `--mc-accent-strong` | Strong accent (logo, active states). |
| `error` | `--mc-error` | Errors, badges, rows with errors. |
| `scrollbar` | `--mc-scrollbar` | Scrollbar. |
| `rowHover` | `--mc-row-hover` | Explorer row on hover, `kbd` background. |
| `rowActive` | `--mc-row-active` | Active explorer row/tab. |

---

## `tokenColors` (syntax)

Each entry: `{ "scope": …, "settings": { foreground?, background?, fontStyle? } }`.

- **`scope`**: string or list of strings. Comma-separated lists are accepted
  (`"comment, comment.doc"`). Each scope must match
  `/^[A-Za-z0-9_][A-Za-z0-9._-]*$/` (letters, digits, `_`, `.`, `-`); invalid
  ones produce a warning and are skipped. With no valid scope left, the entry
  is ignored. Typical scopes: `comment`, `keyword`, `type`, `method`,
  `variable`, `namespace`, `identifier`, `annotation`, `delimiter`, `number`,
  `string`, `string.escape`, `tag`, `metatag`, `strong`, `emphasis`, plus
  suffixed variants (`comment.java`, `string.escape`, …).
- **`settings`**: required object. `foreground`/`background` are opaque hex;
  `fontStyle` accepts `bold`, `italic`, `underline`, `strikethrough` in any
  order and case (`"Italic BOLD"` → `"bold italic"`); unknown words produce a
  warning and are ignored. An entry with no valid style at all is ignored
  with a warning.

**Merging**: one rule per token; when several entries touch the same token,
**later ones win per field**. So you can paint `string` broadly and refine
`string.escape` afterwards.

## Inheritance (`extends`)

Resolving a theme walks its `extends` chain and merges parent-first:
`colors` and `ui` are overwritten per key, `tokenColors` merge per token
(child wins), `icons` merge per key (child's `defaultFile`/`defaultFolder`
when present), the child's `background` wins when defined, and the final
`base` is always the theme's own (a light theme extending a dark one stays
light). Missing parents and cycles don't break anything: the chain stops and
the theme applies with whatever it has plus the defaults.

## `icons`

Only **`.svg`** files (relative paths). They are sanitized on load
(`<script>`, `on*` handlers and `javascript:` hrefs are stripped) and
rendered via `<img>`, so they can never execute code. Without `icons`, the
built-in icons are used.

| Property | What it does |
|----------|--------------|
| `files` | Name→icon map. **Case-insensitive** matching, in order: 1st exact filename (`"pom.xml"`), 2nd dotted extension (`".java"`). No match → `defaultFile` → built-in icon. |
| `folders` | Folder-name→icon map. Exact match only (case-insensitive). No match → `defaultFolder` → built-in icon. |
| `defaultFile` / `defaultFolder` | Fallback icon for files/folders with no match. |

Detail: extension matching uses the last `.` in the name (position > 0),
so a file like `.gitignore` only matches by exact name.

## `background`

| Property | Value | What it does |
|----------|-------|--------------|
| `file` | relative path | Image: `png, jpg, jpeg, gif, webp, svg` (max 5 MB). |
| `opacity` | number `0`–`1` (only when set; without `background` there is no backdrop) | Layer opacity. Above `0.5` warns (may hurt readability). Surfaces are opaque unless you use alpha in `colors`, so the backdrop shows where the theme allows it. |
| `fit` | `"cover"` (default) \| `"contain"` \| `"center"` \| `"tile"` | Like `background-size`: cover, fit, center or tile. Legacy `position` alias. |
| `where` | non-empty list of `"editor"` (default) \| `"sidebar"` \| `"welcome"` | Regions where it shows. Duplicates are removed. |

Any invalid field → **warning and no background** (the rest of the theme loads).

---

## Errors vs warnings

- **Error (fatal for that theme)**: non-object JSON, invalid `base`/`uiTheme`,
  empty `extends`, invalid manifest, unreadable file, or duplicate theme.
  The theme is skipped; sibling themes in the same extension still load.
- **Warning**: one bad entry (a color, a scope, an icon, the background).
  That entry is ignored and the theme loads with the rest.
- Where to see them: **Settings → Extensions** (diagnostics list) and console.

A requested theme that doesn't exist (e.g. you uninstalled the active pack)
falls back to the built-in `mini-code-dark` without breaking anything.

## Install & manage (what the editor does)

- **Install…**: folder picker → the folder must contain `extension.json`
  with a valid `id` → it is copied to `<id>/` in the root. If the `id`
  already exists, uninstall first (update = uninstall + install). A
  half-copied install cleans itself up.
- **Uninstall**: deletes the `id` folder (only direct children of the root;
  built-ins aren't on disk and can't be removed) and reloads.
- **Reload**: unloads everything and scans again (handy when you edited
  files manually in the folder).
- **Open folder**: reveals the extensions root in the OS file explorer.

At startup, the scan only picks up folders with a readable `extension.json`;
anything else shows up as a diagnostic and is skipped.

## Built-in themes

Always available, with `source: "builtin"`:

| Theme | `base` | Description |
|-------|--------|-------------|
| `mini-code-dark` | `vs-dark` | Default dark theme and safety net (fallback). |
| `mini-code-light` | `vs` | Light theme. Proves the light base works. |

Ideal `extends` parents so you don't start from zero.

---

## Full example (`extensions/hello-world`)

The reference pack: a warm theme extending `mini-code-dark`, with terminal,
`ui`, background and its own icons.

**`extension.json`**

```json
{
  "id": "hello-world",
  "name": "Hello World",
  "version": "1.0.0",
  "description": "Extensión de ejemplo del sistema de extensiones v2: un tema completo.",
  "contributes": {
    "themes": [
      { "id": "hello-warm", "label": "Hello Warm", "uiTheme": "vs-dark", "path": "themes/hello-warm.json" }
    ]
  }
}
```

**`themes/hello-warm.json`**

```json
{
  "$schema": "minicode-theme#1",
  "name": "Hello Warm",
  "extends": "mini-code-dark",
  "colors": {
    "editor.background": "#201a14b3",
    "editor.foreground": "#e8dcc8",
    "editorLineNumber.foreground": "#6b5d4d",
    "editorLineNumber.activeForeground": "#e2725b",
    "editor.selectionBackground": "#4a3a28",
    "editorCursor.foreground": "#e2725b",
    "editor.lineHighlightBackground": "#262017",
    "terminal.background": "#221a13",
    "terminal.foreground": "#d6c7ae",
    "terminalCursor.foreground": "#e2725b",
    "terminal.selectionBackground": "#4a3a28"
  },
  "tokenColors": [
    { "scope": "comment", "settings": { "foreground": "#8a7a63", "fontStyle": "italic" } },
    { "scope": "keyword", "settings": { "foreground": "#e2725b", "fontStyle": "bold" } },
    { "scope": "type", "settings": { "foreground": "#e8a87c" } },
    { "scope": "method", "settings": { "foreground": "#e5c07b" } },
    { "scope": "variable", "settings": { "foreground": "#d9c2a3" } },
    { "scope": "namespace", "settings": { "foreground": "#c9a87c" } },
    { "scope": "identifier", "settings": { "foreground": "#e8dcc8" } },
    { "scope": "annotation", "settings": { "foreground": "#d9a05b" } },
    { "scope": "delimiter", "settings": { "foreground": "#a89a86" } },
    { "scope": "number", "settings": { "foreground": "#e08a3c" } },
    { "scope": "string", "settings": { "foreground": "#a8bf7a" } },
    { "scope": "string.escape", "settings": { "foreground": "#e08a3c" } },
    { "scope": "tag", "settings": { "foreground": "#d98c5f" } },
    { "scope": "metatag", "settings": { "foreground": "#e2725b" } },
    { "scope": "strong", "settings": { "fontStyle": "bold" } },
    { "scope": "emphasis", "settings": { "fontStyle": "italic" } }
  ],
  "ui": {
    "bg": "#171310",
    "panel": "#221a13",
    "border": "#3a2d1f",
    "text": "#d6c7ae",
    "textMuted": "#8a7a63",
    "accent": "#e2725b",
    "accentStrong": "#e2725b"
  },
  "background": {
    "file": "assets/icon.png",
    "opacity": 0.25,
    "fit": "cover",
    "where": ["editor"]
  },
  "icons": {
    "files": {
      ".java": "icons/java.svg",
      ".md": "icons/md.svg",
      ".markdown": "icons/md.svg",
      "pom.xml": "icons/java.svg"
    },
    "folders": {
      "src": "icons/folder.svg"
    },
    "defaultFile": "icons/file.svg",
    "defaultFolder": "icons/folder.svg"
  }
}
```

Note it declares no `base`: it inherits `vs-dark` from the manifest's
`uiTheme`, and by extending `mini-code-dark` it only overrides what it cares
about (about 7 `colors` keys, 16 rules, 7 `ui` keys) instead of defining all
~40 keys from scratch.

## Minimal template

A valid theme can be this short (defaults plus `extends` fill in the rest):

**`extension.json`**

```json
{
  "id": "my-first-theme",
  "name": "My First Theme",
  "version": "1.0.0",
  "contributes": {
    "themes": [
      { "id": "my-first-dark", "label": "My First Dark", "uiTheme": "vs-dark", "path": "themes/dark.json" }
    ]
  }
}
```

**`themes/dark.json`**

```json
{
  "extends": "mini-code-dark",
  "colors": { "editor.background": "#101418" },
  "tokenColors": [
    { "scope": "comment", "settings": { "foreground": "#5b6b7b", "fontStyle": "italic" } }
  ],
  "ui": { "accent": "#7dcfff" }
}
```

Copy the folder into the extensions root (or use Install…), pick
“My First Dark” in Settings → Editor, done.
