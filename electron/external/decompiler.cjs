const fsp = require("fs/promises");
const path = require("path");
const os = require("os");
const { zipEntriesFast } = require("./zip.cjs");
const { fernflowerJar, javaBinary, toolNextToJava } = require("./javaTools.cjs");
const { execFileAsync } = require("./proc.cjs");
const FF_HEADER = (originLabel) =>
  `// Class decompiled with FernFlower (IntelliJ IDEA) — read-only.\n` +
  `// Source: ${originLabel} (bytecode, no sources attached)\n`;
async function extractClassFile(jarPath, entry, destFile) {
  await fsp.mkdir(path.dirname(destFile), { recursive: true });
  try {
    const { buf, parsed } = await zipEntriesFast(jarPath);
    const e = parsed.find((x) => x.name === entry);
    if (!e || e.hasDescriptor) throw new Error("entrada no directa");
    const lh = e.offset;
    if (buf.readUInt32LE(lh) !== 0x04034b50) throw new Error("cabecera local mala");
    const dataStart = lh + 30 + buf.readUInt16LE(lh + 26) + buf.readUInt16LE(lh + 28);
    const raw = buf.subarray(dataStart, dataStart + e.compSize);
    const data = e.method === 0 ? raw : require("zlib").inflateRawSync(raw);
    await fsp.writeFile(destFile, data);
    return;
  } catch {
    // respaldo con la herramienta jar
  }
  const work = await fsp.mkdtemp(path.join(os.tmpdir(), "mini-code-xf-"));
  try {
    await execFileAsync(toolNextToJava("jar"), ["xf", jarPath, entry], { timeoutMs: 60000, cwd: work });
    await fsp.copyFile(path.join(work, ...entry.split("/")), destFile);
  } finally {
    await fsp.rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

// Descompila un .class y devuelve el .java resultante (con caché en disco).
async function decompileClassFile(app, classFile, cacheTag) {
  const dir = path.join(os.tmpdir(), "mini-code-decompiled", cacheTag);
  const simple = path.basename(classFile, ".class").split("$")[0];
  const outFile = path.join(dir, "out", simple + ".java");
  try {
    const st = await fsp.stat(outFile);
    if (st.isFile() && st.size > 0) return await fsp.readFile(outFile, "utf8");
  } catch {
    // caché fría: descompilar
  }
  const ff = fernflowerJar(app);
  try {
    await fsp.stat(ff);
  } catch {
    throw new Error("Falta el descompilador, que raro.)");
  }
  const outDir = path.join(dir, "out");
  await fsp.mkdir(outDir, { recursive: true });
  // FernFlower exige que el destino exista; descompila un solo .class
  // (las internas ausentes solo generan avisos, la externa sale igual).
  await execFileAsync(javaBinary(), ["-jar", ff, classFile, outDir], { timeoutMs: 180000 });
  return await fsp.readFile(outFile, "utf8");
}

module.exports = { FF_HEADER, extractClassFile, decompileClassFile };
