// Punto único anti-duplicados para TODO el tráfico LSP saliente.
// Solo colapsa lo concurrente idéntico; no cachea nada.

const lspInflight = new Map<string, Promise<any>>();

export function dedupedLspRequest(method: string, params: any): Promise<any> {
  const orig = window.electronAPI?.lspRequest as
    | ((method: string, params: any) => Promise<any>)
    | undefined;
  if (!orig) return Promise.reject(new Error("Sin puente LSP. Que raro"));
  let key: string | null = null;
  try {
    key = method + "|" + JSON.stringify(params ?? null);
  } catch {
    return orig(method, params);
  }
  const id = key;
  const prev = lspInflight.get(id);
  if (prev) return prev;
  const p = orig(method, params).finally(() => {
    if (lspInflight.get(id) === p) lspInflight.delete(id);
  });
  lspInflight.set(id, p);
  return p;
}
