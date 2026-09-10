// Utilidad compartida.
function escapeRegExp(s: any) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export { escapeRegExp };
