(() => {
  const VERIFIED_REAL_TEST_PRODUCTS = [
    {
      lpn:'REAL-EAN-195949544026',
      ean:'195949544026',
      productName:'Słuchawki bezprzewodowe nauszne Apple AirPods Max Bluetooth USB-C Midnight',
      brand:'Apple',
      model:'AirPods Max',
      category:'Bezprzewodowe',
      confidence:100,
      source:'Allegro API',
      status:'catalog-test',
      testRecord:true,
      identified:true,
      confirm:false,
      contents:'TEST katalogowy — bez fizycznej weryfikacji sztuki',
      loc:'TEST-LIVE',
      photos:[]
    },
    {
      lpn:'REAL-EAN-4548736132580',
      ean:'4548736132580',
      productName:'Słuchawki bezprzewodowe wokółuszne Sony WH-1000XM5 ANC',
      brand:'Sony',
      model:'WH-1000XM5',
      category:'Bezprzewodowe',
      confidence:100,
      source:'Allegro API',
      status:'catalog-test',
      testRecord:true,
      identified:true,
      confirm:false,
      contents:'TEST katalogowy — bez fizycznej weryfikacji sztuki',
      loc:'TEST-LIVE',
      photos:[]
    },
    {
      lpn:'REAL-EAN-6925281994258',
      ean:'6925281994258',
      productName:'Głośnik przenośny JBL Flip 6 czarny 30 W',
      brand:'JBL',
      model:'Flip 6',
      category:'Głośniki przenośne',
      confidence:100,
      source:'Allegro API',
      status:'catalog-test',
      testRecord:true,
      identified:true,
      confirm:false,
      contents:'TEST katalogowy — bez fizycznej weryfikacji sztuki',
      loc:'TEST-LIVE',
      photos:[]
    }
  ];

  let cfg = null;
  let realSeedPromise = null;

  function setup(options) {
    cfg = options;
  }

  function requireConfig() {
    if (!cfg) throw new Error('Cloud products module is not configured');
    return cfg;
  }

  function randomWorkspaceKey() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return btoa(String.fromCharCode(...bytes))
      .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  }

  function getWorkspaceKey() {
    const {keys} = requireConfig();
    let key = localStorage.getItem(keys.workspaceKey) || '';
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(key)) {
      key = randomWorkspaceKey();
      localStorage.setItem(keys.workspaceKey, key);
    }
    return key;
  }

  function apiBase() {
    const {keys, defaultApiBase} = requireConfig();
    return (localStorage.getItem(keys.apiBase) || defaultApiBase).replace(/\/$/,'');
  }

  function cloudHeaders(extra = {}) {
    return {
      'content-type':'application/json',
      'x-workspace-key': getWorkspaceKey(),
      ...extra
    };
  }

  function ensureVerifiedRealProductsLocal() {
    const {keys} = requireConfig();
    let products = [];
    try { products = JSON.parse(localStorage.getItem(keys.products) || '[]'); } catch {}
    products = Array.isArray(products) ? products : [];
    products = products.filter(p => !String(p?.lpn || '').startsWith('TEST-SEED-'));

    const byLpn = new Map(products.map(p => [String(p?.lpn || '').trim().toLowerCase(), p]));
    const now = new Date().toISOString();

    for (const fixture of VERIFIED_REAL_TEST_PRODUCTS) {
      const key = fixture.lpn.toLowerCase();
      if (!byLpn.has(key)) {
        byLpn.set(key, {
          ...fixture,
          id: crypto.randomUUID ? crypto.randomUUID() : ('real-' + fixture.ean),
          savedAt: now
        });
      }
    }

    const merged = [...byLpn.values()]
      .sort((a,b) => String(b.savedAt || '').localeCompare(String(a.savedAt || '')))
      .slice(0,500);

    localStorage.setItem(keys.products, JSON.stringify(merged));
    return merged;
  }

  async function cloudGetProducts() {
    const response = await fetch(apiBase() + '/api/products', {
      method:'GET',
      headers:{'x-workspace-key':getWorkspaceKey()}
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Nie udało się pobrać produktów');
    return Array.isArray(data.products) ? data.products : [];
  }

  async function cloudGetProduct(lpn) {
    const response = await fetch(apiBase() + '/api/products?lpn=' + encodeURIComponent(lpn), {
      method:'GET',
      headers:{'x-workspace-key':getWorkspaceKey()}
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Nie udało się pobrać szczegółów produktu');
    return data.product || null;
  }

  async function cloudSaveProduct(product) {
    const response = await fetch(apiBase() + '/api/products', {
      method:'POST',
      headers:cloudHeaders(),
      body:JSON.stringify({product})
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Nie udało się zapisać produktu');
    return data;
  }

  async function syncProductsFromCloud(quiet = false) {
    const {keys, toast} = requireConfig();

    try {
      const cloud = await cloudGetProducts();
      ensureVerifiedRealProductsLocal();

      let local = [];
      try { local = JSON.parse(localStorage.getItem(keys.products) || '[]'); } catch {}
      local = Array.isArray(local) ? local : [];

      const byLpn = new Map();
      for (const product of [...local, ...cloud]) {
        const rawLpn = String(product?.lpn || '').trim();
        if (!rawLpn || rawLpn.startsWith('TEST-SEED-')) continue;

        const key = rawLpn.toLowerCase();
        const previous = byLpn.get(key);

        if (!previous) {
          byLpn.set(key, product);
        } else if (String(product.savedAt || '') >= String(previous.savedAt || '')) {
          byLpn.set(key, {...previous, ...product});
        } else {
          byLpn.set(key, {...product, ...previous});
        }
      }

      const products = [...byLpn.values()]
        .sort((a,b) => String(b.savedAt || '').localeCompare(String(a.savedAt || '')))
        .slice(0,500);

      localStorage.setItem(keys.products, JSON.stringify(products));
      if (!quiet) toast('Synchronizacja zakończona • ' + products.length + ' produktów');
      return products;
    } catch (error) {
      if (!quiet) toast('Błąd synchronizacji: ' + (error.message || 'brak połączenia'));
      throw error;
    }
  }

  async function migrateLocalProductsToCloud() {
    const {keys} = requireConfig();
    const key = getWorkspaceKey();
    const markerKey = 'productIntake.cloudMigrated.' + key.slice(0,12);
    if (localStorage.getItem(markerKey) === 'done') return;

    let local = [];
    try { local = JSON.parse(localStorage.getItem(keys.products) || '[]'); } catch {}
    local = Array.isArray(local) ? local : [];

    for (const product of local) {
      try { await cloudSaveProduct(product); } catch {}
    }

    localStorage.setItem(markerKey, 'done');
  }

  async function pushVerifiedRealProductsToCloud() {
    const {getProducts} = requireConfig();

    for (const fixture of VERIFIED_REAL_TEST_PRODUCTS) {
      try {
        const local = getProducts().find(p => String(p?.lpn || '') === fixture.lpn) || fixture;
        await cloudSaveProduct(local);
      } catch (error) {
        console.warn('Verified fixture cloud save failed', fixture.ean, error);
      }
    }
  }

  async function initializeCloudProducts() {
    try {
      await migrateLocalProductsToCloud();
      await syncProductsFromCloud(true);
    } catch (error) {
      console.warn('Cloud sync unavailable', error);
    }
  }

  async function seedRealCatalogProducts(force = false) {
    if (realSeedPromise) return realSeedPromise;

    realSeedPromise = (async () => {
      const {keys, getProducts, addHistory, toast} = requireConfig();
      const key = getWorkspaceKey();
      const flag = 'productIntake.realCatalogSeed.v4.' + key.slice(0,12);
      if (!force && localStorage.getItem(flag) === 'done') return getProducts();

      const eans = ['195949544026','4548736132580','6925281994258'];
      const seeded = [];

      for (const ean of eans) {
        try {
          const search = await fetch(apiBase() + '/api/search?ean=' + encodeURIComponent(ean));
          const data = await search.json().catch(() => ({}));
          if (!search.ok || !data.best?.name) {
            throw new Error(data.error || 'Brak produktu dla EAN ' + ean);
          }

          const best = data.best;
          const record = {
            lpn:'REAL-EAN-' + ean,
            ean,
            asin:best.asin || '',
            productName:best.name || '',
            brand:best.brand || '',
            model:best.model || '',
            category:data.categoryMeta?.categoryName || best.category || '',
            catalogImage:best.image || '',
            description:best.description || '',
            parameterItems:Array.isArray(best.parameters)
              ? best.parameters.map(p => ({name:p.name || p.key || '', value:String(p.value ?? '')}))
              : [],
            parameters:Array.isArray(best.parameters)
              ? best.parameters.map(p => (p.name || p.key || '') + ': ' + (p.value ?? '')).join('\n')
              : '',
            condition:'',
            contents:'TEST katalogowy — bez fizycznej weryfikacji sztuki',
            flaws:'',
            loc:'TEST-LIVE',
            shipping:'',
            weight:'',
            confirm:false,
            identified:true,
            confidence:Number(data.confidence ?? 0),
            categoryMeta:data.categoryMeta || null,
            gpsrData:data.gpsr || null,
            sourceSnapshot:{
              allegro:{
                fetchedAt:new Date().toISOString(),
                ean,
                name:best.name || '',
                brand:best.brand || '',
                model:best.model || '',
                category:data.categoryMeta?.categoryName || best.category || '',
                categoryId:best.categoryId || data.categoryMeta?.categoryId || '',
                image:best.image || '',
                description:best.description || '',
                parameters:Array.isArray(best.parameters) ? best.parameters : [],
                gpsr:data.gpsr || null,
                categoryMeta:data.categoryMeta || null,
                confidence:Number(data.confidence ?? 0)
              }
            },
            photos:[],
            status:'catalog-test',
            source:'Allegro API',
            testRecord:true
          };

          const localResult = window.ProductStorage.saveProduct(
            localStorage,
            keys.products,
            record,
            500
          );

          seeded.push(localResult.record || record);

          try {
            await cloudSaveProduct(localResult.record || record);
          } catch (cloudError) {
            console.warn('Cloud seed save failed for', ean, cloudError);
          }
        } catch (error) {
          console.warn('Real catalog seed failed for', ean, error);
        }
      }

      const cleaned = getProducts().filter(p => !String(p?.lpn || '').startsWith('TEST-SEED-'));
      localStorage.setItem(keys.products, JSON.stringify(cleaned.slice(0,500)));

      if (seeded.length === 3) {
        localStorage.setItem(flag,'done');
        addHistory('Dodano realne produkty testowe', seeded.map(p => p.ean || p.lpn).join(', '));
        toast('Gotowe • 3 realne produkty z Allegro są na liście.');
      } else {
        toast('Dodano ' + seeded.length + '/3 realnych produktów.');
      }

      return cleaned;
    })();

    try {
      return await realSeedPromise;
    } finally {
      realSeedPromise = null;
    }
  }

  window.ProductIntakeCloudProducts = {
    setup,
    getWorkspaceKey,
    apiBase,
    cloudHeaders,
    ensureVerifiedRealProductsLocal,
    cloudGetProducts,
    cloudGetProduct,
    cloudSaveProduct,
    syncProductsFromCloud,
    migrateLocalProductsToCloud,
    pushVerifiedRealProductsToCloud,
    initializeCloudProducts,
    seedRealCatalogProducts
  };
})();
