// Compat: la resolución de símbolos externos vive en electron/external/*.
// Este archivo se mantiene para no romper requires existentes.
module.exports = require("./external/resolve.cjs");
