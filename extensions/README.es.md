# Mini Code · Extensiones de tema (wiki)

Las extensiones de Mini Code son **paquetes de temas declarativos**: una
carpeta con un `extension.json` y uno o más archivos de tema en JSON.
**No se ejecuta código de terceros** — un tema son solo datos (colores,
estilos de sintaxis, iconos, fondo) que el host valida y registra
(`src/extensions/host.ts`).

- Instalar: **Ajustes → Extensiones → Instalar…** (elige la carpeta del tema)
  o copia la carpeta a mano en la carpeta de extensiones:
  - dev: `<proyecto>/extensions` (esta misma carpeta).
  - app instalada: `<userData>/extensions`.
- Ver un tema instalado: selector de tema en **Ajustes → Editor**.
- Si algo falla, no rompe el editor: los avisos y errores salen en
  **Ajustes → Extensiones** y por consola (`[extensions] …`).

## Estructura de una extensión

```
extensions/<mi-tema>/
  extension.json          # manifiesto (qué temas aporta)
  themes/mi-tema.json     # archivo(s) de tema
  icons/*.svg             # opcional: iconos de archivos/carpetas
  assets/*                # opcional: imagen de fondo (máx. 5 MB)
```

---

## `extension.json` (manifiesto)

```json
{
  "id": "mi-tema",
  "name": "Mi Tema",
  "version": "1.0.0",
  "description": "Un tema oscuro cálido (opcional).",
  "contributes": {
    "themes": [
      { "id": "mi-tema-oscuro", "label": "Mi Tema Oscuro", "uiTheme": "vs-dark", "path": "themes/mi-tema.json" }
    ]
  }
}
```

### Propiedades del manifiesto

| Propiedad     | Requerida | Qué es y para qué sirve |
|---------------|-----------|--------------------------|
| `id`          | Sí | Identificador de la **extensión** (no del tema). Minúsculas, números y guiones, 2–64 caracteres (`^[a-z0-9][a-z0-9-]{1,63}$`). Se usa como nombre de la carpeta al instalar y para agrupar diagnósticos. Dos carpetas con el mismo `id`: la segunda se omite. |
| `name`        | Sí | Nombre visible en Ajustes → Extensiones. Texto no vacío. |
| `version`     | Sí | Versión en formato semver estricto `X.Y.Z` (p. ej. `1.0.0`, sin sufijos). Solo informativa. |
| `description` | No | Texto libre. Solo informativa. |
| `contributes` | Sí | Objeto con la única clave admitida: `themes`. Cualquier otra clave (`commands`, …) es **error**; `contributes` ausente o que no sea objeto también es error. Claves desconocidas de nivel superior (p. ej. el antiguo `engines`) se **ignoran** sin error. |

### Cada entrada de `contributes.themes[]`

| Propiedad | Requerida | Qué es y para qué sirve |
|-----------|-----------|--------------------------|
| `id`      | Sí | Identificador del **tema**. Es el que aparece en el selector de Ajustes y el que se guarda en la configuración. No vacío y único dentro de la extensión (duplicado = error). Si choca con un tema ya registrado (otro pack o built-in), ese tema se omite con error. |
| `label`   | Sí | Nombre visible en el selector de temas. Texto no vacío. |
| `uiTheme` | Sí | Base de Monaco: `"vs-dark"` (tema oscuro) o `"vs"` (tema claro). Es la base por defecto; si el archivo de tema declara su propio `base`, manda el del archivo. |
| `path`    | Sí | Ruta **relativa** al archivo del tema dentro de la extensión (p. ej. `"themes/mi-tema.json"`). Sin `..`, sin rutas absolutas ni `C:`. Por compatibilidad también se acepta la clave antigua `file`. |

`contributes.themes` debe ser una lista **no vacía**; una extensión sin temas
válidos no se carga (error `sin temas válidos, la extensión no se carga`).

---

## Archivo de tema (`themes/*.json`)

```json
{
  "$schema": "minicode-theme#1",
  "name": "Mi Tema Oscuro",
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

### Propiedades del archivo de tema

| Propiedad    | Requerida | Qué es y para qué sirve |
|--------------|-----------|--------------------------|
| `$schema`    | No | Solo documentación para quien edita el JSON. El validador la ignora. |
| `name`       | No | Nombre descriptivo interno. El que se muestra en el selector es el `label` del manifiesto. Se ignora al cargar. |
| `base`       | No | Base de Monaco: `"vs-dark"` u `"vs"`. Si se omite, se usa el `uiTheme` del manifiesto. **Ojo**: si es inválido, es error **fatal** (el tema se salta). También se acepta el alias `uiTheme` a nivel de archivo. Manda `base` si hay ambos. |
| `extends`    | No | Id de otro tema del que **heredar** (p. ej. `"mini-code-dark"`). El hijo mezcla lo del padre y lo suyo gana (ver *Herencia*). Si el padre no existe o hay un ciclo, la cadena se corta sin romper nada y el tema se aplica igual. Si no es texto no vacío, error **fatal**. |
| `colors`     | No | Mapa de colores de Monaco/terminal (ver *Catálogo `colors`*). Claves desconocidas o valores mal formados → **aviso**, esa entrada se ignora. |
| `tokenColors`| No | Lista de estilos de sintaxis (ver *`tokenColors`*). Debe ser lista; si no, **aviso** y se ignora entera. |
| `ui`         | No | Mapa de claves semánticas → variables CSS de la app (ver *Catálogo `ui`*). Claves desconocidas o valores mal formados → **aviso**. |
| `icons`      | No | Set de iconos SVG (ver *`icons`*). Si falta o es inválido, se usan los iconos built-in. |
| `background` | No | Imagen de fondo (ver *`background`*). Si falta o es inválida, simplemente no hay fondo. Alias antiguo `wallpaper` (avisa una vez y se lee igual). |

> Claves de nivel superior no reconocidas (como `$schema` o `name`) se
> ignoran sin avisar: el formato puede crecer sin romper temas viejos.

### Formato de color

Todos los colores aceptan `#rgb`, `#rrggbb` o `#rrggbbaa` (mayúsculas o
minúsculas, se normalizan a minúsculas; `#rgb` se expande). El alfa (`#rrggbbaa`)
deja ver el fondo a través de las superficies — útil con `background`.

Excepción: `tokenColors[].settings.foreground/background` solo aceptan colores
**opacos** (`#rgb` o `#rrggbb`, sin alfa) y se guardan sin `#` para Monaco.

### Rutas de assets

Toda ruta (`path`, `icons.*`, `background.file`) debe ser **relativa dentro de
la extensión**: sin `..`, sin `/` inicial, sin `C:`. El proceso main además
enjaula la lectura a la carpeta de extensiones y limita los binarios a
**5 MB** (`png, jpg, jpeg, gif, webp, svg`).

---

## Catálogo `colors`

Solo estas claves tienen efecto; el resto genera un aviso y se ignora.
No hace falta definirlas todas: lo que falte se rellena con los valores del
tema oscuro built-in.

### Editor (`editor.*`)

| Clave | Qué pinta |
|-------|-----------|
| `editor.background` | Fondo del editor. Acepta alfa. |
| `editor.foreground` | Color de texto por defecto del código. |
| `editorLineNumber.foreground` | Números de línea. |
| `editorLineNumber.activeForeground` | Número de la línea actual. |
| `editorCursor.foreground` | Cursor. |
| `editor.selectionBackground` | Fondo de la selección. |
| `editor.selectionHighlightBackground` | Otras ocurrencias de la selección. |
| `editor.lineHighlightBackground` | Fondo de la línea actual. |
| `editorGutter.background` | Medianil (zona de números de línea). |
| `editorIndentGuide.background` | Guías de indentación. |
| `editorIndentGuide.activeBackground` | Guía del bloque actual. |
| `editorBracketMatch.background` / `.border` | Resaltado del paréntesis/corchete pareja. |
| `editorWidget.background` / `.border` | Widgets (sugerencias, hover). |
| `editorSuggestWidget.selectedBackground` | Elemento seleccionado en autocompletado. |
| `editorHoverWidget.background` / `.border` | Ventana de documentación al pasar el cursor. |

### Terminal (`terminal.*`)

Van al panel de terminal (xterm). Si una clave falta, se deriva de `ui`
(`background`←`panel`, `foreground`←`text`, cursor←`accent`,
selección←`border`) y en última instancia de los defaults built-in.

| Clave | Qué pinta |
|-------|-----------|
| `terminal.background` / `terminal.foreground` | Fondo y texto del terminal. |
| `terminalCursor.foreground` | Cursor del terminal. |
| `terminal.selectionBackground` | Selección en el terminal. |
| `terminal.ansiBlack/Red/Green/Yellow/Blue/Magenta/Cyan/White` | Paleta ANSI normal. |
| `terminal.ansiBrightBlack/…/BrightWhite` | Paleta ANSI brillante. |

---

## Catálogo `ui` (chrome de la app)

Cada clave alimenta una variable CSS (`--mc-*`) que pinta la interfaz fuera
del editor (barras, explorador, pestañas, ajustes…). Si omites claves, se usan
los defaults; por eso un tema mínimo de 2–3 claves ya se ve coherente.

| Clave | Variable | Dónde se nota |
|-------|----------|---------------|
| `bg` | `--mc-bg` | Fondo general, barra de título, pestaña activa, paneles. |
| `panel` | `--mc-panel` | Explorador, barra de pestañas, diálogos, terminal (fondo por defecto). |
| `border` | `--mc-border` | Bordes, divisores, selección del terminal por defecto. |
| `text` | `--mc-text` | Texto principal de la UI, texto del terminal por defecto. |
| `textMuted` | `--mc-text-muted` | Texto secundario, placeholders, hover del scrollbar. |
| `accent` | `--mc-accent` | Acentos: iconos, enlaces, kbd, cursor del terminal por defecto. |
| `accentStrong` | `--mc-accent-strong` | Acento fuerte (logo, estados activos). |
| `error` | `--mc-error` | Errores, insignias, filas con error. |
| `scrollbar` | `--mc-scrollbar` | Barra de desplazamiento. |
| `rowHover` | `--mc-row-hover` | Fila del explorador al pasar el cursor, fondo de `kbd`. |
| `rowActive` | `--mc-row-active` | Fila/pestaña activa en el explorador. |

---

## `tokenColors` (sintaxis)

Cada entrada: `{ "scope": …, "settings": { foreground?, background?, fontStyle? } }`.

- **`scope`**: texto o lista de textos. Acepta listas separadas por comas
  (`"comment, comment.doc"`). Cada scope debe cumplir
  `/^[A-Za-z0-9_][A-Za-z0-9._-]*$/` (letras, dígitos, `_`, `.`, `-`); los
  inválidos generan aviso y se saltan. Si no queda ningún scope válido, la
  entrada se ignora. Scopes típicos: `comment`, `keyword`, `type`, `method`,
  `variable`, `namespace`, `identifier`, `annotation`, `delimiter`, `number`,
  `string`, `string.escape`, `tag`, `metatag`, `strong`, `emphasis`, más
  variantes con sufijo (`comment.java`, `string.escape`, …).
- **`settings`**: objeto requerido. `foreground`/`background` son hex opacos;
  `fontStyle` admite `bold`, `italic`, `underline`, `strikethrough` en
  cualquier orden y mayúsculas (`"Italic BOLD"` → `"bold italic"`); palabras
  desconocidas generan aviso y se ignoran. Una entrada sin ningún estilo
  válido se ignora con aviso.

**Fusión**: una regla por token; si varias entradas tocan el mismo token,
**las posteriores ganan por campo**. Así puedes pintar `string` en general y
refinar `string.escape` después.

## Herencia (`extends`)

Al resolver un tema se recorre su cadena `extends` y se mezcla de padre a
hijo: `colors` y `ui` se sobrescriben por clave, `tokenColors` se fusiona por
token (gana el hijo), `icons` se mezcla por clave (con `defaultFile`/`defaultFolder`
del hijo si los trae), `background` lo gana el hijo si lo define, y el `base`
final es siempre el del propio tema (un tema claro que extiende uno oscuro
sigue siendo claro). Padres ausentes y ciclos no rompen: la cadena se corta y
el tema se aplica con lo que tenga más los defaults.

## `icons`

Solo archivos **`.svg`** (rutas relativas). Se sanean al cargar (se eliminan
`<script>`, manejadores `on*` y `javascript:`) y se muestran vía `<img>`, así
que nunca pueden ejecutar código. Sin `icons`, se usan los iconos built-in.

| Propiedad | Qué hace |
|-----------|----------|
| `files` | Mapa nombre→icono. Coincidencia **insensible a mayúsculas**, en orden: 1º nombre exacto (`"pom.xml"`), 2º extensión con punto (`".java"`). Si nada coincide → `defaultFile` → icono built-in. |
| `folders` | Mapa nombre de carpeta→icono. Solo coincidencia exacta (insensible a mayúsculas). Si nada coincide → `defaultFolder` → icono built-in. |
| `defaultFile` / `defaultFolder` | Icono de reserva para archivos/carpetas sin coincidencia. |

Detalle: la regla de extensión usa el último `.` del nombre (posición > 0),
así que un archivo como `.gitignore` solo coincide por nombre exacto.

## `background`

| Propiedad | Valor | Qué hace |
|-----------|-------|----------|
| `file` | ruta relativa | Imagen: `png, jpg, jpeg, gif, webp, svg` (máx. 5 MB). |
| `opacity` | número `0`–`1` (defecto: solo si lo pones; sin `background` no hay fondo) | Opacidad de la capa. Por encima de `0.5` avisa (puede dañar la legibilidad). Las superficies son opacas salvo que uses alfa en `colors`, así que el fondo se ve donde el tema lo permite. |
| `fit` | `"cover"` (defecto) \| `"contain"` \| `"center"` \| `"tile"` | Como `background-size`: cubrir, encajar, centrar o mosaico. Alias antiguo `position`. |
| `where` | lista no vacía de `"editor"` (defecto) \| `"sidebar"` \| `"welcome"` | Regiones donde se muestra. Se eliminan duplicados. |

Cualquier campo inválido → **aviso y sin fondo** (el resto del tema carga).

---

## Errores vs avisos

- **Error (fatal para ese tema)**: JSON que no es objeto, `base`/`uiTheme`
  inválidos, `extends` vacío, manifiesto inválido, archivo ilegible o tema
  duplicado. El tema se salta; los hermanos de la misma extensión cargan igual.
- **Aviso**: una entrada suelta mal (un color, un scope, un icono, el fondo).
  Se ignora esa entrada y el tema carga con lo demás.
- Dónde verlos: **Ajustes → Extensiones** (lista de diagnósticos) y consola.

Un tema pedido que no existe (p. ej. desinstalaste el pack activo) cae al
built-in `mini-code-dark` sin romper nada.

## Instalación y gestión (lo que hace el editor)

- **Instalar…**: diálogo de carpeta → la carpeta debe traer `extension.json`
  con `id` válido → se copia a `<id>/` en la raíz. Si el `id` ya existe, pide
  desinstalar primero (actualizar = desinstalar + instalar). Una copia a
  medias se limpia sola.
- **Desinstalar**: borra la carpeta del `id` (solo hijos directos de la raíz;
  los built-in no están en disco y no se pueden quitar) y recarga.
- **Recargar**: descarga todo y vuelve a escanear (útil si editaste archivos
  a mano en la carpeta).
- **Abrir carpeta**: abre la raíz de extensiones en el explorador del SO.

Al arrancar, el escaneo solo tiene en cuenta carpetas con `extension.json`
legible; el resto aparece como diagnóstico y se salta.

## Temas built-in

Siempre disponibles, con `source: "builtin"`:

| Tema | `base` | Descripción |
|------|--------|-------------|
| `mini-code-dark` | `vs-dark` | Tema oscuro por defecto y red de seguridad (fallback). |
| `mini-code-light` | `vs` | Tema claro. Prueba que la base clara funciona. |

Ideales como padre de `extends` para no empezar de cero.

---

## Ejemplo completo (`extensions/hello-world`)

El pack de referencia: un tema cálido que extiende `mini-code-dark`, con
terminal, `ui`, fondo e iconos propios.

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

Fíjate en que no declara `base`: hereda `vs-dark` del `uiTheme` del
manifiesto, y al extender `mini-code-dark` solo sobrescribe lo que le
interesa (unas 7 claves de `colors`, 16 reglas, 7 de `ui`) en vez de definir
las ~40 claves desde cero.

## Plantilla mínima

Un tema válido puede ser así de corto (el resto lo ponen los defaults y, si
us
...[truncated 615 chars]