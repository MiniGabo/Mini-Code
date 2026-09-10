# Mini Code

Editor de código ligero enfocado en Java, construido con Electron + React + Monaco Editor.

## Características

- Resaltado de sintaxis, números de línea, indentación y folding (Monaco, solo
  Java, YAML, XML y Markdown empaquetados).
- **IntelliSense Java** vía `java-language-server` (incluido en el repo):
  autocompletado con firma + javadoc, hover, ayuda de signatures, quick fixes
  (p. ej. auto-import) y diagnósticos con badges por archivo.
- **Ir a definición** (`Ctrl+Click`): dentro del proyecto vía LSP; a clases del
  JDK o dependencias abriendo la fuente real (`src.zip`, `-sources.jar`) o
  descompilando el bytecode con FernFlower en pestañas virtuales de solo lectura.
- Explorador de carpetas (crear/renombrar/mover/eliminar con deshacer,
  arrastrar y soltar, menú contextual).
- Pestañas, Guardar / Guardar como con diálogos nativos, aviso de cambios sin
  guardar, archivos recientes y pantalla de bienvenida.

## Requisitos

- Node.js 18+
- `pnpm` 12+ (`npm install -g pnpm` si no lo tienes instalado)
- Un JDK instalado (para el IntelliSense; Maven/Gradle opcionales para resolver
  dependencias del proyecto)

## Instalación

```bash
pnpm install
```

## Desarrollo (hot reload)

```bash
pnpm electron:dev
```

Esto levanta Vite en `http://localhost:5173` y abre la ventana de Electron apuntando a ese servidor.

## Build de producción

```bash
pnpm electron:build
```

Genera los instaladores en `release/` usando `electron-builder`.
El instalador incluye los jars del servidor Java y FernFlower como
`extraResources` (desempaquetados, para que `java` pueda leerlos).

## Chequeo de tipos

```bash
pnpm typecheck
```

Corre `tsc --noEmit` sobre el renderer.

## Servidor Java (incluido)

El IntelliSense usa un fork de `java-language-server` (georgewfraser) en
`lsp-servers/java-language-server`. Modificado para este editor.

```bash
cd lsp-servers/java-language-server
mvn -DskipTests package
```

(Requiere JDK y una sola descarga de dependencias a `~/.m2`.)

## Atajos de teclado

| Acción                        | Windows/Linux      | macOS   |
| ------------------------------ | ------------------- | ------- |
| Nueva carpeta...                | `Ctrl+N`            | `⌘N`    |
| Abrir archivo                   | `Ctrl+O`            | `⌘O`    |
| Abrir carpeta                   | `Ctrl+Shift+O`      | `⌘⇧O`   |
| Guardar                         | `Ctrl+S`            | `⌘S`    |
| Guardar como                    | `Ctrl+Shift+S`      | `⌘⇧S`   |
| Cerrar pestaña                  | `Ctrl+W`            | `⌘W`    |
| Mostrar/ocultar explorador      | `Ctrl+Shift+E`      | `⌘⇧E`   |
| Deshacer (explorador)           | `Ctrl+Z`            | `⌘Z`    |
| Ir a definición                 | `Ctrl+Click`        | `⌘+Click` |

## Licencia

MIT — ver [LICENSE](LICENSE). El servidor Java incluido deriva de
[java-language-server](https://github.com/georgewfraser/java-language-server)
(George Fraser, MIT, ver `lsp-servers/java-language-server/LICENSE.md`).
