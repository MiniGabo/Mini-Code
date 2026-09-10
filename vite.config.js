import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import monacoEditorPluginModule from "vite-plugin-monaco-editor";

// Compatibilidad ESM/CJS del plugin
const monacoEditorPlugin = monacoEditorPluginModule.default ?? monacoEditorPluginModule;

// https://vitejs.dev/config/
export default defineConfig({
  base: "./",
  plugins: [
    react(),
    // Restricción estricta: solo Java, YAML, XML y Markdown.
    // Esto evita que Monaco incluya el resto de lenguajes por defecto.
    monacoEditorPlugin({
      languageWorkers: ["editorWorkerService"], // sin workers de ts/json/css/html
      customLanguages: [],
      languages: ["java", "yaml", "xml", "markdown"],
      publicPath: "monacoeditorwork",
    }),
  ],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
