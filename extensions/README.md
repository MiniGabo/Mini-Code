# Mini Code · Theme extensions

Mini Code extensions are **declarative theme packs**: a folder with an
`extension.json` manifest plus JSON theme files. **No third-party code
runs** — a theme is just data (colors, syntax styles, icons, background).

- 📖 Full wiki: [`README.en.md`](README.en.md) (English) · [`README.es.md`](README.es.md) (Español)
- 🧪 Reference pack: [`hello-world/`](hello-world/) (working warm theme with icons and background)

## Quick start

1. Copy the minimal template below into a folder (or Settings → Extensions → Install…).
2. Pick the theme in Settings → Editor.

`extension.json`:

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

`themes/dark.json`:

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

## Where themes live

- dev: `<project>/extensions` (this folder).
- installed app: `<userData>/extensions`.

Everything else — every manifest property, every `colors`/`ui` key and what
it paints, scopes, inheritance, icons, backgrounds, install/uninstall
behavior — is documented property by property in the wikis above.
