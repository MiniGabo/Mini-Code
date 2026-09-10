import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import monacoEditorPluginModule from "vite-plugin-monaco-editor";

// ESM/CJS compatibility for the plugin
const monacoEditorPlugin = monacoEditorPluginModule.default ?? monacoEditorPluginModule;

// https://vitejs.dev/config/
export default defineConfig({
  base: "./",
  plugins: [
    react(),
    // Strict restriction: only Java, YAML, XML and Markdown.
    // This prevents Monaco from bundling the remaining default languages.
    monacoEditorPlugin({
      languageWorkers: ["editorWorkerService"], // no ts/json/css/html workers
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
