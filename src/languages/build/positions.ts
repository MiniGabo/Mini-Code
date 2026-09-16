// Offset -> Monaco 1-based line/column + range helpers for build files.

/** Maven repository declared in the build file (pom <repositories> / gradle repositories {}). */
export interface RepoDef {
  id?: string;
  url: string;
}

export interface BuildRange {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

export function offsetToPos(text: string, offset: number): { line: number; col: number } {
  const safe = Math.max(0, Math.min(offset, text.length));
  let line = 1;
  let col = 1;
  for (let i = 0; i < safe; i++) {
    if (text[i] === "\n") {
      line++;
      col = 1;
    } else {
      col++;
    }
  }
  return { line, col };
}

export function rangeFromOffsets(text: string, start: number, end: number): BuildRange {
  const s = offsetToPos(text, start);
  const e = offsetToPos(text, Math.max(start + 1, end));
  return {
    startLineNumber: s.line,
    startColumn: s.col,
    endLineNumber: e.line,
    endColumn: e.col,
  };
}

/** Range of a single line (for file-wide errors like malformed XML). */
export function lineRange(text: string, lineNumber: number): BuildRange {
  const lines = text.split("\n");
  const idx = Math.max(1, Math.min(lineNumber, lines.length)) - 1;
  const len = lines[idx]?.length ?? 0;
  return {
    startLineNumber: idx + 1,
    startColumn: 1,
    endLineNumber: idx + 1,
    endColumn: Math.max(2, len + 1),
  };
}
