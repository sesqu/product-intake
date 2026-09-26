(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ProductStorage = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function parseProducts(storage, key) {
    try {
      const raw = storage.getItem(key);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function normalizeLpn(value) {
    return String(value || '').trim().toLowerCase();
  }

  function makeId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'p-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
  }

  function saveProduct(storage, key, draft, limit = 500) {
    const products = parseProducts(storage, key);
    const lpnKey = normalizeLpn(draft?.lpn);
    const existingIndex = lpnKey
      ? products.findIndex(p => normalizeLpn(p?.lpn) === lpnKey)
      : -1;

    const existing = existingIndex >= 0 ? products[existingIndex] : null;
    const record = {
      ...(existing || {}),
      ...(draft || {}),
      id: existing?.id || makeId(),
      savedAt: new Date().toISOString(),
      status: 'ready'
    };

    if (existingIndex >= 0) products.splice(existingIndex, 1);
    products.unshift(record);

    const finalProducts = products.slice(0, limit);
    storage.setItem(key, JSON.stringify(finalProducts));

    return {
      record,
      products: finalProducts,
      created: existingIndex < 0,
      updated: existingIndex >= 0
    };
  }

  return {
    getProducts: parseProducts,
    saveProduct,
    normalizeLpn
  };
});
