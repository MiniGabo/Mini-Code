const fsp = require("fs/promises");
const path = require("path");
const os = require("os");
const { execFileAsync } = require("./proc.cjs");
const { toolNextToJava } = require("./javaTools.cjs");
function entryCandidates(fqn, ext) {
  const parts = fqn.split(".");
  const out = [];
  for (let len = parts.length; len >= 1; len--) {
    out.push(parts.slice(0, len).join("/") + ext);
    if (out.length >= 3) break;
  }
  return out;
}

const zipListCache = new Map(); // zipPathLower -> string[]
function findEOCD(buf) {
  const start = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= start; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  return -1;
}

function parseZipCentral(buf) {
  const eocd = findEOCD(buf);
  if (eocd === -1) return null;
  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) return null; // Zip64
  if (cdOffset + cdSize > buf.length) return null;
  const entries = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) return null;
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    if (flags & 0x01) return null; // encrypted: not supported
    if (method !== 0 && method !== 8) return null;
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const headerOffset = buf.readUInt32LE(p + 42);
    if (headerOffset === 0xffffffff) return null;
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    entries.push({ name, method, compSize, offset: headerOffset, hasDescriptor: !!(flags & 0x08) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function zipEntriesFast(zipPath) {
  const st = await fsp.stat(zipPath);
  if (st.size > 256 * 1024 * 1024) throw new Error("jar gigante");
  const buf = await fsp.readFile(zipPath);
  const parsed = parseZipCentral(buf);
  if (!parsed) throw new Error("zip no estándar");
  return { buf, parsed };
}

// Only the central directory (2 small reads): very fast even
// with huge jars. For listings and existence checks.
async function readCentralNames(zipPath) {
  const fh = await fsp.open(zipPath, "r");
  try {
    const { size } = await fh.stat();
    const tailLen = Math.min(size, 70000);
    const tail = Buffer.allocUnsafe(tailLen);
    await fh.read(tail, 0, tailLen, size - tailLen);
    let eocdRel = -1;
    for (let i = tailLen - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50) {
        eocdRel = i;
        break;
      }
    }
    if (eocdRel === -1) throw new Error("sin EOCD");
    const count = tail.readUInt16LE(eocdRel + 10);
    const cdSize = tail.readUInt32LE(eocdRel + 12);
    const cdOffset = tail.readUInt32LE(eocdRel + 16);
    if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      throw new Error("zip64");
    }
    const cd = Buffer.allocUnsafe(cdSize);
    await fh.read(cd, 0, cdSize, cdOffset);
    const names = [];
    let p = 0;
    for (let i = 0; i < count; i++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error("cd corrupto");
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      names.push(cd.toString("utf8", p + 46, p + 46 + nameLen));
      p += 46 + nameLen + extraLen + commentLen;
    }
    return names;
  } finally {
    await fh.close().catch(() => {});
  }
}

async function listZip(zipPath) {
  const key = zipPath.toLowerCase();
  if (zipListCache.has(key)) return zipListCache.get(key);
  let entries = null;
  try {
    entries = await readCentralNames(zipPath);
  } catch {
    try {
      entries = (await zipEntriesFast(zipPath)).parsed.map((e) => e.name);
    } catch {
      const { stdout } = await execFileAsync(toolNextToJava("jar"), ["tf", zipPath], { timeoutMs: 60000 });
      entries = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    }
  }
  zipListCache.set(key, entries);
  return entries;
}

async function readZipEntry(zipPath, entry) {
  try {
    const { buf, parsed } = await zipEntriesFast(zipPath);
    const e = parsed.find((x) => x.name === entry);
    if (!e || e.hasDescriptor) throw new Error("entrada no directa");
    const lh = e.offset;
    if (buf.readUInt32LE(lh) !== 0x04034b50) throw new Error("cabecera local mala");
    const dataStart = lh + 30 + buf.readUInt16LE(lh + 26) + buf.readUInt16LE(lh + 28);
    const raw = buf.subarray(dataStart, dataStart + e.compSize);
    if (e.method === 0) return raw.toString("utf8");
    return require("zlib").inflateRawSync(raw).toString("utf8");
  } catch {
    // fallback using the jar tool
  }
  const work = await fsp.mkdtemp(path.join(os.tmpdir(), "mini-code-zip-"));
  try {
    await execFileAsync(toolNextToJava("jar"), ["xf", zipPath, entry], { timeoutMs: 30000, cwd: work });
    return await fsp.readFile(path.join(work, ...entry.split("/")), "utf8");
  } finally {
    await fsp.rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { entryCandidates, listZip, readZipEntry, zipEntriesFast };
