// Theme + tokenizer.
// Adding a language = adding its `setMonarchTokensProvider` here and its
// contribution in EditorPane, without touching the component.
// Editor color themes live as data in extensions/themes/themeService
// (built-in mini-code-dark/light + extension contributions); this module
// only wires them into Monaco.
import { ensureThemeDefined, FALLBACK_THEME_ID } from "../extensions/themes/themeService";
import { ensureBuiltinThemes } from "../extensions/builtin";

let themeDefined = false;

// Java tokenizer extended from Monaco's base Monarch.
export const javaLanguage = {
  defaultToken: "",
  tokenPostfix: ".java",
  keywords: [
    "abstract", "continue", "for", "new", "switch",
    "assert", "default", "goto", "package", "synchronized",
    "boolean", "do", "if", "private", "this",
    "break", "double", "implements", "protected", "throw",
    "byte", "else", "import", "public", "throws",
    "case", "enum", "instanceof", "return", "transient",
    "catch", "extends", "int", "short", "try",
    "char", "final", "interface", "static", "void",
    "class", "finally", "long", "strictfp", "volatile",
    "const", "float", "native", "super", "while",
    "true", "false", "yield", "record", "sealed",
    "non-sealed", "permits",
  ],
  operators: [
    "=", ">", "<", "!", "~", "?", ":", "==", "<=", ">=", "!=",
    "&&", "||", "++", "--", "+", "-", "*", "/", "&", "|", "^", "%",
    "<<", ">>", ">>>", "+=", "-=", "*=", "/=", "&=", "|=", "^=",
    "%=", "<<=", ">>=", ">>>=",
  ],
  symbols: /[=><!~?:&|+\-*\/\^%]+/,
  escapes: /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,
  digits: /\d+(_+\d+)*/,
  octaldigits: /[0-7]+(_+[0-7]+)*/,
  binarydigits: /[0-1]+(_+[0-1]+)*/,
  hexdigits: /[[0-9a-fA-F]+(_+[0-9a-fA-F]+)*/,
  tokenizer: {
    root: [
      ["non-sealed", "keyword.non-sealed"],
      [/\b(import|package)\b/, "keyword", "@importLine"],
      [
        /[a-zA-Z_$][\w$]*(?=\s*\()/,
        { cases: { "@keywords": { token: "keyword.$0" }, "@default": "method" } },
      ],
      [/[A-Z][\w$]*/, "type"],
      [
        /[a-zA-Z_$][\w$]*/,
        { cases: { "@keywords": { token: "keyword.$0" }, "@default": "variable" } },
      ],
      { include: "@whitespace" },
      [/[{}()\[\]]/, "@brackets"],
      [/[<>](?!@symbols)/, "@brackets"],
      [/@symbols/, { cases: { "@operators": "delimiter", "@default": "" } }],
      [/@\s*[a-zA-Z_\$][\w\$]*/, "annotation"],
      [/(@digits)[eE]([\-+]?(@digits))?[fFdD]?/, "number.float"],
      [/(@digits)\.(@digits)([eE][\-+]?(@digits))?[fFdD]?/, "number.float"],
      [/0[xX](@hexdigits)[Ll]?/, "number.hex"],
      [/0(@octaldigits)[Ll]?/, "number.octal"],
      [/0[bB](@binarydigits)[Ll]?/, "number.binary"],
      [/(@digits)[fFdD]/, "number.float"],
      [/(@digits)[lL]?/, "number"],
      [/[;,.]/, "delimiter"],
      [/"([^"\\]|\\.)*$/, "string.invalid"],
      [/"""/, "string", "@multistring"],
      [/"/, "string", "@string"],
      [/'[^\\']'/, "string"],
      [/(')(@escapes)(')/, ["string", "string.escape", "string"]],
      [/'/, "string.invalid"],
    ],
    importLine: [
      [/;/, "delimiter", "@pop"],
      [/[a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*)*/, "namespace"],
      [/\*/, "namespace"],
      { include: "@whitespace" },
      [/\./, "delimiter"],
    ],
    whitespace: [
      [/[ \t\r\n]+/, ""],
      [/\/\*\*(?!\/)/, "comment.doc", "@javadoc"],
      [/\/\*/, "comment", "@comment"],
      [/\/\/.*$/, "comment"],
    ],
    comment: [
      [/[^\/*]+/, "comment"],
      [/\*\//, "comment", "@pop"],
      [/[\/*]/, "comment"],
    ],
    javadoc: [
      [/[^\/*]+/, "comment.doc"],
      [/\/\*/, "comment.doc.invalid"],
      [/\*\//, "comment.doc", "@pop"],
      [/[\/*]/, "comment.doc"],
    ],
    string: [
      [/[^\\"]+/, "string"],
      [/@escapes/, "string.escape"],
      [/\\./, "string.escape.invalid"],
      [/"/, "string", "@pop"],
    ],
    multistring: [
      [/[^\\"]+/, "string"],
      [/@escapes/, "string.escape"],
      [/\\./, "string.escape.invalid"],
      [/"""/, "string", "@pop"],
      [/./, "string"],
    ],
  },
} as unknown as Record<string, unknown>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function ensureMiniCodeTheme(monaco: any): void {
  if (themeDefined) return;
  monaco.languages.setMonarchTokensProvider("java", javaLanguage);
  // Groovy (build.gradle) has no Monaco basic-language in this version:
  // minimal Monarch based on Java keywords + Gradle configs + single/double strings.
  try {
    monaco.languages.register({ id: "groovy" });
  } catch {
    // already registered
  }
  monaco.languages.setMonarchTokensProvider("groovy", {
    defaultToken: "",
    tokenPostfix: ".groovy",
    keywords: [
      "def", "as", "in", "assert", "trait", "extends", "implements",
      "package", "import", "class", "interface", "enum",
      "if", "else", "for", "while", "do", "switch", "case", "default",
      "break", "continue", "return", "try", "catch", "finally", "throw",
      "new", "this", "super", "true", "false", "null",
      "static", "final", "public", "protected", "private", "abstract",
      "synchronized", "default",
    ],
    tokenizer: {
      root: [
        [/\/\/.*$/, "comment"],
        [/\/\*/, "comment", "@comment"],
        [/"([^"\\]|\\.)*"/, "string"],
        [/'([^'\\]|\\.)*'/, "string"],
        [/\b(implementation|api|compileOnly|runtimeOnly|testImplementation|testApi|plugins|dependencies|repositories|mavenCentral|google|gradlePluginPortal)\b/, "keyword"],
        [/[A-Z][\w$]*/, "type"],
        [/[a-zA-Z_$][\w$]*(?=\s*\()/, "method"],
        [/[a-zA-Z_$][\w$]*/, { cases: { "@keywords": "keyword", "@default": "variable" } }],
        [/[{}()\[\]]/, "@brackets"],
        [/[;,.]/, "delimiter"],
        [/\d+(\.\d+)?/, "number"],
      ],
      comment: [
        [/[^\/*]+/, "comment"],
        [/\*\//, "comment", "@pop"],
        [/[\/*]/, "comment"],
      ],
    },
  });
  // Color themes are data (extensions/themes/themeService): the built-in
  // themes are registered like any other, then defined once in Monaco.
  ensureBuiltinThemes();
  ensureThemeDefined(monaco, FALLBACK_THEME_ID);
  themeDefined = true;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyEditorTheme(monaco: any, themeId: string): string {
  ensureBuiltinThemes();
  const name = ensureThemeDefined(monaco, themeId);
  try {
    monaco.editor.setTheme(name);
  } catch {
    // unknown theme after all: keep the current one
  }
  return name;
}
