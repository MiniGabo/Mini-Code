const path = require("path");
const fs = require("fs/promises");

// Build outputs and build caches are ignored.
const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "release",
  ".idea",
  ".vscode",
  "target",
  "build",
  "out",
  "bin",
  ".gradle",
  ".settings",
]);

async function buildFileTree(dirPath) {
  const stats = await fs.stat(dirPath);
  const name = path.basename(dirPath);

  if (!stats.isDirectory()) {
    return { name, path: dirPath, type: "file" };
  }

  if (IGNORED_DIRS.has(name)) {
    return { name, path: dirPath, type: "folder", children: [] };
  }

  const entries = await fs.readdir(dirPath, { withFileTypes: true });

  const children = await Promise.all(
    entries
      .filter((entry) => !IGNORED_DIRS.has(entry.name) && !entry.name.startsWith("."))
      .map(async (entry) => {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          return buildFileTree(fullPath);
        }
        return { name: entry.name, path: fullPath, type: "file" };
      })
  );

  // Folders first, then files, both alphabetically
  children.sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return { name, path: dirPath, type: "folder", children };
}

module.exports = { buildFileTree };
