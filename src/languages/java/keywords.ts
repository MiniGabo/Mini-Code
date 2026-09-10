// Palabras reservadas de Java: nunca son navegables (evita subrayar
// `if`, `for`, `new`... al mantener Ctrl sobre ellas).
const JAVA_KEYWORDS = new Set(
  ("abstract continue for new switch assert default goto package synchronized " +
    "boolean do if private this break double implements protected throw " +
    "byte else import public throws case enum instanceof return transient " +
    "catch extends int short try char final interface static void class " +
    "finally long strictfp volatile const float native super while true " +
    "false yield record sealed non-sealed permits")
    .split(" ")
);

export { JAVA_KEYWORDS };
