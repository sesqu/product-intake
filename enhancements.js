(() => {
  const DEFAULT_API_BASE = 'https://product-intake.sesquu.workers.dev';
  const KEYS = {
    draft: 'productIntake.draft.v2',
    products: 'productIntake.products.v2',
    history: 'productIntake.history.v2',
    apiBase: 'productIntake.apiBase',
    workspaceKey: 'productIntake.workspaceKey.v1'
  };
  const $ = id => document.getElementById(id);
  const safe = (v='') => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let photoData = [];
  let latestCategoryMeta = null;
  let latestGpsr = null;
  let latestConfidence = null;

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

  function ensureVerifiedRealProductsLocal() {
    let products = [];
    try { products = JSON.parse(localStorage.getItem(KEYS.products) || '[]'); } catch {}
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

    localStorage.setItem(KEYS.products, JSON.stringify(merged));
    return merged;
  }

  const APP_BUILD = 21;
  const APP_VERSION_LABEL = 'v21';
  let pwaRegistration = null;
  let updateInProgress = false;

  function ensureUpdateUi() {
    if ($('piUpdateButton')) return;

    const style = document.createElement('style');
    style.id = 'piUpdateStyles';
    style.textContent = `
      #piUpdateButton{
        position:fixed;
        top:calc(env(safe-area-inset-top,0px) + 8px);
        right:10px;
        z-index:2500;
        display:none;
        align-items:center;
        gap:7px;
        border:1px solid rgba(127,156,255,.45);
        background:rgba(26,36,56,.96);
        color:#eef3ff;
        padding:9px 11px;
        border-radius:11px;
        box-shadow:0 12px 34px rgba(0,0,0,.35);
        backdrop-filter:blur(14px);
        font-size:12px;
        font-weight:750;
        cursor:pointer
      }
      #piUpdateButton::before{
        content:'';
        width:8px;height:8px;border-radius:999px;
        background:#7f9cff;
        box-shadow:0 0 0 4px rgba(127,156,255,.12)
      }
      #piVersionBadge{
        position:fixed;
        right:12px;
        bottom:calc(84px + env(safe-area-inset-bottom,0px));
        z-index:850;
        color:#626d7b;
        font-size:10px;
        line-height:1;
        pointer-events:none;
        user-select:none
      }
      @media(min-width:1151px){
        #piVersionBadge{bottom:12px}
      }
    `;
    document.head.appendChild(style);

    const button = document.createElement('button');
    button.id = 'piUpdateButton';
    button.type = 'button';
    button.textContent = 'Aktualizacja dostępna';
    button.onclick = applyAvailableUpdate;
    document.body.appendChild(button);

    const badge = document.createElement('div');
    badge.id = 'piVersionBadge';
    badge.textContent = APP_VERSION_LABEL;
    document.body.appendChild(badge);
  }

  function showUpdateAvailable(remoteVersion) {
    ensureUpdateUi();
    const button = $('piUpdateButton');
    if (!button) return;
    button.dataset.version = String(remoteVersion || '');
    button.textContent = 'Aktualizacja dostępna';
    button.style.display = 'inline-flex';
  }

  async function fetchRemoteVersion() {
    try {
      const r = await fetch('./version.json?ts=' + Date.now(), {
        cache:'no-store',
        headers:{'cache-control':'no-cache'}
      });
      if (!r.ok) return null;
      const data = await r.json();
      const version = Number(data?.version);
      return Number.isFinite(version) ? version : null;
    } catch {
      return null;
    }
  }

  async function checkForAppUpdate() {
    const remoteVersion = await fetchRemoteVersion();
    if (remoteVersion != null && remoteVersion > APP_BUILD) {
      showUpdateAvailable(remoteVersion);
      try { await pwaRegistration?.update?.(); } catch {}
      return true;
    }
    return false;
  }

  async function applyAvailableUpdate() {
    if (updateInProgress) return;
    updateInProgress = true;
    ensureUpdateUi();

    const button = $('piUpdateButton');
    if (button) {
      button.disabled = true;
      button.textContent = 'Aktualizuję…';
      button.style.display = 'inline-flex';
    }

    try {
      if ('serviceWorker' in navigator) {
        const reg = pwaRegistration || await navigator.serviceWorker.getRegistration();
        if (reg) {
          try { await reg.update(); } catch {}
          if (reg.waiting) reg.waiting.postMessage({type:'SKIP_WAITING'});
        }
      }

      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(
          keys
            .filter(k => k.startsWith('product-intake-'))
            .map(k => caches.delete(k))
        );
      }

      const url = new URL(location.href);
      url.searchParams.set('app_update', String(Date.now()));
      location.replace(url.toString());
    } catch (e) {
      updateInProgress = false;
      if (button) {
        button.disabled = false;
        button.textContent = 'Spróbuj ponownie';
      }
    }
  }

  function setupPwaUpdates() {
    ensureUpdateUi();

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (updateInProgress) location.reload();
      });

      window.addEventListener('load', async () => {
        try {
          pwaRegistration = await navigator.serviceWorker.register('./sw.js', {updateViaCache:'none'});
          await pwaRegistration.update();
        } catch {}
        checkForAppUpdate();
      });
    } else {
      window.addEventListener('load', checkForAppUpdate);
    }

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') checkForAppUpdate();
    });
    window.addEventListener('pageshow', () => checkForAppUpdate());
    setInterval(checkForAppUpdate, 3 * 60 * 1000);
  }

  setupPwaUpdates();

  function randomWorkspaceKey() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return btoa(String.fromCharCode(...bytes))
      .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  }

  function getWorkspaceKey() {
    let key = localStorage.getItem(KEYS.workspaceKey) || '';
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(key)) {
      key = randomWorkspaceKey();
      localStorage.setItem(KEYS.workspaceKey, key);
    }
    return key;
  }

  function apiBase() {
    return (localStorage.getItem(KEYS.apiBase) || DEFAULT_API_BASE).replace(/\/$/,'');
  }

  function cloudHeaders(extra = {}) {
    return {
      'content-type':'application/json',
      'x-workspace-key': getWorkspaceKey(),
      ...extra
    };
  }

  async function cloudGetProducts() {
    const r = await fetch(apiBase() + '/api/products', {
      method:'GET',
      headers: { 'x-workspace-key': getWorkspaceKey() }
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Nie udało się pobrać produktów');
    return Array.isArray(j.products) ? j.products : [];
  }

  async function cloudGetProduct(lpn) {
    const r = await fetch(apiBase() + '/api/products?lpn=' + encodeURIComponent(lpn), {
      method:'GET',
      headers: { 'x-workspace-key': getWorkspaceKey() }
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Nie udało się pobrać szczegółów produktu');
    return j.product || null;
  }

  async function cloudSaveProduct(product) {
    const r = await fetch(apiBase() + '/api/products', {
      method:'POST',
      headers: cloudHeaders(),
      body: JSON.stringify({ product })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Nie udało się zapisać produktu');
    return j;
  }

  async function syncProductsFromCloud(quiet = false) {
    try {
      const cloud = await cloudGetProducts();

      ensureVerifiedRealProductsLocal();
      let local = [];
      try { local = JSON.parse(localStorage.getItem(KEYS.products) || '[]'); } catch {}
      local = Array.isArray(local) ? local : [];

      const byLpn = new Map();
      for (const p of [...local, ...cloud]) {
        const rawLpn = String(p?.lpn || '').trim();
        if (!rawLpn || rawLpn.startsWith('TEST-SEED-')) continue;
        const key = rawLpn.toLowerCase();
        const prev = byLpn.get(key);
        if (!prev) {
          byLpn.set(key, p);
        } else if (String(p.savedAt || '') >= String(prev.savedAt || '')) {
          byLpn.set(key, {...prev, ...p});
        } else {
          byLpn.set(key, {...p, ...prev});
        }
      }

      const products = [...byLpn.values()]
        .sort((a,b) => String(b.savedAt || '').localeCompare(String(a.savedAt || '')))
        .slice(0,500);

      localStorage.setItem(KEYS.products, JSON.stringify(products));
      if (!quiet) toast('Synchronizacja zakończona • ' + products.length + ' produktów');
      return products;
    } catch (e) {
      if (!quiet) toast('Błąd synchronizacji: ' + (e.message || 'brak połączenia'));
      throw e;
    }
  }

  async function migrateLocalProductsToCloud() {
    const key = getWorkspaceKey();
    const markerKey = 'productIntake.cloudMigrated.' + key.slice(0,12);
    if (localStorage.getItem(markerKey) === 'done') return;

    let local = [];
    try { local = JSON.parse(localStorage.getItem(KEYS.products) || '[]'); } catch {}
    local = Array.isArray(local) ? local : [];

    for (const product of local) {
      try { await cloudSaveProduct(product); } catch {}
    }

    localStorage.setItem(markerKey, 'done');
  }

  async function pushVerifiedRealProductsToCloud() {
    for (const product of VERIFIED_REAL_TEST_PRODUCTS) {
      try {
        const local = getProducts().find(p => String(p?.lpn || '') === product.lpn) || product;
        await cloudSaveProduct(local);
      } catch (e) {
        console.warn('Verified fixture cloud save failed', product.ean, e);
      }
    }
  }

  async function initializeCloudProducts() {
    try {
      await migrateLocalProductsToCloud();
      await syncProductsFromCloud(true);
    } catch (e) {
      console.warn('Cloud sync unavailable', e);
    }
  }

  let realSeedPromise = null;

  async function seedRealCatalogProducts(force = false) {
    if (realSeedPromise) return realSeedPromise;

    realSeedPromise = (async () => {
      const key = getWorkspaceKey();
      const flag = 'productIntake.realCatalogSeed.v4.' + key.slice(0,12);
      if (!force && localStorage.getItem(flag) === 'done') return getProducts();

      const eans = [
        '195949544026',
        '4548736132580',
        '6925281994258'
      ];
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
            lpn: 'REAL-EAN-' + ean,
            ean,
            asin: best.asin || '',
            productName: best.name || '',
            brand: best.brand || '',
            model: best.model || '',
            category: data.categoryMeta?.categoryName || best.category || '',
            catalogImage: best.image || '',
            description: best.description || '',
            parameterItems: Array.isArray(best.parameters)
              ? best.parameters.map(p => ({name:p.name || p.key || '', value:String(p.value ?? '')}))
              : [],
            parameters: Array.isArray(best.parameters)
              ? best.parameters.map(p => (p.name || p.key || '') + ': ' + (p.value ?? '')).join('\n')
              : '',
            condition: '',
            contents: 'TEST katalogowy — bez fizycznej weryfikacji sztuki',
            flaws: '',
            loc: 'TEST-LIVE',
            shipping: '',
            weight: '',
            confirm: false,
            identified: true,
            confidence: Number(data.confidence ?? 0),
            categoryMeta: data.categoryMeta || null,
            gpsrData: data.gpsr || null,
            sourceSnapshot: {
              allegro: {
                fetchedAt: new Date().toISOString(),
                ean,
                name: best.name || '',
                brand: best.brand || '',
                model: best.model || '',
                category: data.categoryMeta?.categoryName || best.category || '',
                categoryId: best.categoryId || data.categoryMeta?.categoryId || '',
                image: best.image || '',
                description: best.description || '',
                parameters: Array.isArray(best.parameters) ? best.parameters : [],
                gpsr: data.gpsr || null,
                categoryMeta: data.categoryMeta || null,
                confidence: Number(data.confidence ?? 0)
              }
            },
            photos: [],
            status: 'catalog-test',
            source: 'Allegro API',
            testRecord: true
          };

          let localResult;
          if (window.ProductStorage) {
            localResult = window.ProductStorage.saveProduct(localStorage, KEYS.products, record, 500);
          } else {
            const local = getProducts().filter(p => String(p?.lpn || '').toLowerCase() !== record.lpn.toLowerCase());
            local.unshift({...record, savedAt:new Date().toISOString()});
            localStorage.setItem(KEYS.products, JSON.stringify(local.slice(0,500)));
            localResult = {record:local[0]};
          }

          seeded.push(localResult.record || record);

          try {
            await cloudSaveProduct(localResult.record || record);
          } catch (cloudError) {
            console.warn('Cloud seed save failed for', ean, cloudError);
          }
        } catch (e) {
          console.warn('Real catalog seed failed for', ean, e);
        }
      }

      let cleaned = getProducts().filter(p => !String(p?.lpn || '').startsWith('TEST-SEED-'));
      localStorage.setItem(KEYS.products, JSON.stringify(cleaned.slice(0,500)));

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

  function ensureIds() {
    const sections = [...document.querySelectorAll('.section')];
    const v = sections[1];
    if (v) {
      const inputs = v.querySelectorAll('input');
      const ta = v.querySelector('textarea');
      if (inputs[0]) inputs[0].id = 'productName';
      if (inputs[1]) inputs[1].id = 'brand';
      if (inputs[2]) inputs[2].id = 'model';
      if (inputs[3]) inputs[3].id = 'category';
      if (ta) ta.id = 'parameters';
    }
    const physical = sections[2];
    if (physical) {
      const inputs = physical.querySelectorAll('input');
      const tas = physical.querySelectorAll('textarea');
      if (inputs[0]) inputs[0].id = 'serial';
      if (tas[1]) tas[1].id = 'flaws';
    }
    const warehouse = sections[3];
    if (warehouse) {
      const inputs = warehouse.querySelectorAll('input');
      if (inputs[1]) inputs[1].id = 'weight';
    }
  }

  const fieldIds = ['lpn','ean','asin','productName','brand','model','category','parameters','confirm','condition','serial','contents','flaws','loc','shipping','weight'];

  function readDraft() {
    const out = {};
    for (const id of fieldIds) {
      const el = $(id);
      if (!el) continue;
      out[id] = el.type === 'checkbox' ? el.checked : el.value;
    }
    out.photos = photoData;
    out.identified = typeof identified !== 'undefined' ? identified : false;
    out.step = typeof step !== 'undefined' ? step : 0;
    out.savedAt = new Date().toISOString();
    out.categoryMeta = latestCategoryMeta;
    out.gpsrData = latestGpsr;
    out.confidence = latestConfidence;
    return out;
  }
  function writeDraft(d) {
    if (!d) return;

    latestCategoryMeta = d.categoryMeta || null;
    latestGpsr = d.gpsrData || null;
    latestConfidence = Number.isFinite(Number(d.confidence)) ? Number(d.confidence) : null;

    applyCategoryMeta(latestCategoryMeta, false);

    for (const id of fieldIds) {
      const el = $(id);
      if (!el || d[id] == null) continue;
      if (el.type === 'checkbox') el.checked = !!d[id];
      else el.value = d[id];
    }

    photoData = Array.isArray(d.photos) ? d.photos : [];
    if (typeof identified !== 'undefined') identified = !!d.identified;
    if (typeof step !== 'undefined' && Number.isInteger(d.step)) {
      step = Math.max(0, Math.min(4, d.step));
    }

    applyGpsr(latestGpsr);
    applyConfidence(latestConfidence);
    updateEanRequirementUi();
    drawPhotos();

    if (typeof render === 'function') render();
    else if (typeof quality === 'function') quality();
  }
  function saveDraft() {
    try { localStorage.setItem(KEYS.draft, JSON.stringify(readDraft())); } catch {}
  }
  function loadDraft() {
    try {
      const raw = localStorage.getItem(KEYS.draft);
      if (raw) {
        writeDraft(JSON.parse(raw));
        return;
      }

      const products = JSON.parse(localStorage.getItem(KEYS.products) || '[]');
      const latest = products[0];
      const skipRecoveryId = localStorage.getItem('productIntake.skipRecoveryId');
      const isRecent = latest?.savedAt && (Date.now() - new Date(latest.savedAt).getTime() < 30 * 60 * 1000);

      if (latest && isRecent && latest.id !== skipRecoveryId) {
        const recovered = {...latest, step:4, identified:true};
        writeDraft(recovered);
        localStorage.setItem(KEYS.draft, JSON.stringify(recovered));
        setTimeout(() => toast('Przywrócono ostatnio zapisany produkt.'), 150);
      }
    } catch {}
  }

  function addHistory(action, details='') {
    const rows = JSON.parse(localStorage.getItem(KEYS.history) || '[]');
    rows.unshift({time:new Date().toISOString(), action, details});
    localStorage.setItem(KEYS.history, JSON.stringify(rows.slice(0,200)));
  }

  async function compressImage(file) {
    return new Promise((resolve,reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const max = 1000;
        let w = img.width, h = img.height;
        if (Math.max(w,h) > max) {
          const k = max / Math.max(w,h);
          w = Math.round(w*k); h = Math.round(h*k);
        }
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img,0,0,w,h);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg',0.72));
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  function setupPhotos() {
    document.querySelectorAll('.photo').forEach((box, idx) => {
      box.style.cursor = 'pointer';
      box.dataset.idx = idx;
      box.onclick = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.setAttribute('capture','environment');
        input.onchange = async () => {
          const f = input.files && input.files[0];
          if (!f) return;
          try {
            photoData[idx] = await compressImage(f);
            drawPhotos();
            if (typeof quality === 'function') quality();
            saveDraft();
            addHistory('Dodano zdjęcie', $('lpn')?.value || 'wersja robocza');
          } catch { toast('Nie udało się dodać zdjęcia.'); }
        };
        input.click();
      };
    });
    drawPhotos();
  }
  function drawPhotos() {
    document.querySelectorAll('.photo').forEach((box, idx) => {
      const d = photoData[idx];
      if (d) {
        box.innerHTML = '<img alt="Zdjęcie produktu" style="width:100%;height:100%;object-fit:cover;border-radius:9px">';
        box.querySelector('img').src = d;
      } else box.innerHTML = '+<br>Dodaj zdjęcie';
    });
  }

  function selectedConditionId() {
    const option = $('condition')?.selectedOptions?.[0];
    return option?.dataset?.allegroId || '';
  }

  function eanRequirementState() {
    const gtin = latestCategoryMeta?.gtin;
    if (!gtin) return { required:false, pending:false, reason:'not-applicable' };
    if (gtin.requiredForProduct) return { required:true, pending:false, reason:'category' };

    const withValues = gtin.requiredIf?.parametersWithValue || [];
    if (!withValues.length) return { required:false, pending:false, reason:'optional' };

    const conditionId = String(latestCategoryMeta?.condition?.id || '');
    const selectedId = selectedConditionId();

    const conditionRules = withValues.filter(rule => String(rule.id || '') === conditionId);
    if (!conditionRules.length) return { required:false, pending:false, reason:'optional' };
    if (!selectedId) return { required:false, pending:true, reason:'condition' };

    const required = conditionRules.some(rule =>
      Array.isArray(rule.oneOfValueIds) && rule.oneOfValueIds.map(String).includes(String(selectedId))
    );
    return { required, pending:false, reason: required ? 'condition' : 'optional' };
  }

  function updateEanRequirementUi() {
    const state = eanRequirementState();
    const label = $('eanLabel');
    const hint = $('eanRequirement');
    const status = $('rEan');
    const hasEan = Boolean($('ean')?.value.trim());

    if (label) label.textContent = 'EAN / GTIN' + (state.required ? ' *' : '');

    if (hint) {
      if (!latestCategoryMeta) {
        hint.textContent = 'Wymagalność sprawdzimy po identyfikacji kategorii Allegro.';
      } else if (!latestCategoryMeta.gtin) {
        hint.textContent = 'Allegro nie wymaga GTIN dla tego produktu w tej kategorii.';
      } else if (state.pending) {
        hint.textContent = 'Wymagalność EAN zależy od wybranego stanu produktu.';
      } else if (state.required) {
        hint.textContent = 'EAN / GTIN jest wymagany przez Allegro dla tej konfiguracji produktu.';
      } else {
        hint.textContent = 'EAN / GTIN nie jest wymagany przez Allegro dla tej konfiguracji produktu.';
      }
    }

    if (status) {
      if (state.pending) {
        status.textContent = 'zależnie od stanu';
        status.className = 'muted';
      } else if (!state.required) {
        status.textContent = 'opcjonalny';
        status.className = 'muted';
      } else {
        status.textContent = hasEan ? 'OK' : 'brak';
        status.className = hasEan ? 'ok' : 'bad';
      }
    }

    return state;
  }

  function applyCategoryMeta(meta, preserveValue = true) {
    latestCategoryMeta = meta || null;

    if ($('category') && latestCategoryMeta?.categoryName) {
      const current = $('category').value.trim();
      if (!current || /^\d+$/.test(current)) $('category').value = latestCategoryMeta.categoryName;
      $('category').dataset.allegroCategoryId = latestCategoryMeta.categoryId || '';
    }

    const select = $('condition');
    const values = latestCategoryMeta?.condition?.values || [];
    if (select && values.length) {
      const oldValue = preserveValue ? select.value : '';
      select.innerHTML = '<option value="">Wybierz</option>' + values.map(v =>
        '<option value="'+safe(v.value)+'" data-allegro-id="'+safe(v.id)+'">'+safe(v.value)+'</option>'
      ).join('');

      if (oldValue && [...select.options].some(o => o.value === oldValue)) {
        select.value = oldValue;
      }
    }

    updateEanRequirementUi();
  }

  function formatGpsrAddress(address) {
    if (!address) return '';
    return [address.street, [address.postalCode,address.city].filter(Boolean).join(' '), address.countryCode]
      .filter(Boolean).join(', ');
  }

  function applyGpsr(gpsr) {
    latestGpsr = gpsr || null;
    const status = $('gpsrStatus');
    const details = $('gpsrDetails');
    if (!status || !details) return;

    if (!latestGpsr) {
      status.textContent = 'Brak identyfikacji produktu.';
      details.style.display = 'none';
      details.value = '';
      return;
    }

    status.textContent = latestGpsr.status || (latestGpsr.available ? 'Dane GPSR pobrane z Allegro' : 'Brak danych GPSR w katalogu Allegro');

    const lines = [];
    for (const producer of latestGpsr.producers || []) {
      const name = producer.tradeName || producer.name || 'Producent';
      const address = formatGpsrAddress(producer.address);
      const contact = producer.contact || {};
      lines.push('Producent: ' + name);
      if (address) lines.push('Adres: ' + address);
      if (contact.email) lines.push('E-mail: ' + contact.email);
      if (contact.phoneNumber) lines.push('Telefon: ' + contact.phoneNumber);
    }

    const safety = latestGpsr.safetyInformation;
    if (safety?.type) lines.push('Informacje bezpieczeństwa: ' + safety.type);
    if (Array.isArray(safety?.attachments) && safety.attachments.length) {
      lines.push('Załączniki bezpieczeństwa: ' + safety.attachments.length);
    }

    details.value = lines.join('\n');
    details.style.display = lines.length ? 'block' : 'none';
  }

  function applyConfidence(value) {
    const n = Number(value);
    latestConfidence = Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null;

    if ($('confidencePct')) $('confidencePct').textContent = latestConfidence == null ? '—' : latestConfidence + '%';
    if ($('confidenceBar')) $('confidenceBar').style.width = (latestConfidence == null ? 0 : latestConfidence) + '%';
    if ($('sumIdentification')) $('sumIdentification').textContent =
      latestConfidence == null ? '—' : latestConfidence + '% • Allegro';
  }

  function updateQualityPanel() {
    const identifiedOk = typeof identified !== 'undefined' && identified;
    const photoOk = photoData.filter(Boolean).length > 0;
    const eanState = updateEanRequirementUi();

    const rows = [
      ['r1', Boolean($('lpn')?.value.trim())],
      ['r2', identifiedOk],
      ['r3', Boolean($('confirm')?.checked)],
      ['r4', Boolean($('condition')?.value)],
      ['r5', Boolean($('contents')?.value.trim())],
      ['rPhoto', photoOk],
      ['r6', Boolean($('loc')?.value.trim())],
      ['r7', Boolean($('shipping')?.value)]
    ];

    for (const [id, ok] of rows) {
      const el = $(id);
      if (!el) continue;
      el.textContent = ok ? 'OK' : 'brak';
      el.className = ok ? 'ok' : 'bad';
    }

    const requiredChecks = rows.map(([,ok]) => ok);
    if (eanState.required) requiredChecks.push(Boolean($('ean')?.value.trim()));

    const pctValue = requiredChecks.length
      ? Math.round(requiredChecks.filter(Boolean).length / requiredChecks.length * 100)
      : 0;

    if ($('pct')) $('pct').textContent = pctValue + '%';
    if ($('pbar')) $('pbar').style.width = pctValue + '%';
    if ($('lpnTag')) $('lpnTag').textContent = $('lpn')?.value || '—';
    if ($('sumLpn')) $('sumLpn').textContent = $('lpn')?.value || '—';
    if ($('sumStatus')) $('sumStatus').textContent = pctValue === 100 ? 'Kompletne' : 'Wymaga uzupełnienia';

    return pctValue;
  }

  window.quality = updateQualityPanel;

  function validateForReady() {
    const req = [
      ['LPN / SKU', $('lpn')?.value.trim()],
      ['identyfikacja produktu', typeof identified !== 'undefined' && identified],
      ['potwierdzenie testera', $('confirm')?.checked],
      ['stan', $('condition')?.value],
      ['zawartość zestawu', $('contents')?.value.trim()],
      ['co najmniej jedno zdjęcie', photoData.filter(Boolean).length > 0],
      ['lokalizacja', $('loc')?.value.trim()],
      ['dostawa / gabaryt', $('shipping')?.value]
    ];

    if (eanRequirementState().required) {
      req.push(['EAN / GTIN wymagany przez Allegro', $('ean')?.value.trim()]);
    }

    return req.filter(([,ok]) => !ok).map(([name]) => name);
  }

  function getProducts() {
    if (window.ProductStorage) return window.ProductStorage.getProducts(localStorage, KEYS.products);
    return JSON.parse(localStorage.getItem(KEYS.products) || '[]');
  }
  async function saveReadyProduct() {
    const missing = validateForReady();
    if (missing.length) {
      toast('Brakuje: ' + missing.slice(0,3).join(', ') + (missing.length > 3 ? '…' : ''));
      return false;
    }

    const d = readDraft();
    let result;

    if (window.ProductStorage) {
      result = window.ProductStorage.saveProduct(localStorage, KEYS.products, d, 500);
    } else {
      const products = getProducts();
      const lpnKey = String(d.lpn || '').trim().toLowerCase();
      const existingIndex = products.findIndex(p => String(p.lpn || '').trim().toLowerCase() === lpnKey);
      const existing = existingIndex >= 0 ? products[existingIndex] : null;
      const record = {
        ...(existing || {}),
        ...d,
        id: existing?.id || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
        savedAt: new Date().toISOString(),
        status:'ready'
      };
      if (existingIndex >= 0) products.splice(existingIndex, 1);
      products.unshift(record);
      localStorage.setItem(KEYS.products, JSON.stringify(products.slice(0,500)));
      result = {record, created: existingIndex < 0, updated: existingIndex >= 0};
    }

    let cloudOk = false;
    try {
      const cloudResult = await cloudSaveProduct(result.record);
      cloudOk = true;
      result.record = cloudResult.record || result.record;
      await syncProductsFromCloud(true);
    } catch (e) {
      console.warn('Cloud product save failed', e);
    }

    addHistory(
      result.updated ? 'Produkt zaktualizowany' : 'Produkt gotowy',
      d.lpn + (d.productName ? ' • ' + d.productName : '')
    );
    saveDraft();

    if (cloudOk) {
      toast(result.updated ? 'Produkt zaktualizowany i zsynchronizowany.' : 'Produkt zapisany i zsynchronizowany.');
    } else {
      toast('Produkt zapisany lokalnie — synchronizacja chwilowo niedostępna.');
    }
    return true;
  }

  function makeModal() {
    let m = $('piModal');
    if (m) return m;
    m = document.createElement('div');
    m.id = 'piModal';
    m.style.cssText = 'position:fixed;inset:0;z-index:1000;background:rgba(4,6,9,.72);backdrop-filter:blur(8px);display:none;padding:18px;overflow:auto';
    m.innerHTML = '<div id="piModalCard" style="max-width:1120px;margin:2vh auto;background:#11161c;border:1px solid #2a323c;border-radius:16px;box-shadow:0 24px 80px rgba(0,0,0,.45);overflow:hidden"><div class="pi-modal-header" style="display:flex;justify-content:space-between;align-items:center;padding:16px 18px;border-bottom:1px solid #252c35;position:sticky;top:0;background:#11161c;z-index:20"><b id="piModalTitle"></b><button id="piModalClose" class="btn">Zamknij</button></div><div id="piModalBody" style="padding:18px"></div></div>';
    document.body.appendChild(m);
    $('piModalClose').onclick = closePiModal;
    m.addEventListener('click', e => { if (e.target === m) closePiModal(); });
    return m;
  }
  function closePiModal() {
    const m = $('piModal');
    if (m) m.style.display = 'none';
    $('piModalCard')?.classList.remove('pi-editor-card');
    document.body.classList.remove('pi-editor-open');
  }
  function openModal(title, html) {
    document.body.classList.remove('pi-editor-open');
    const m = makeModal();
    $('piModalCard')?.classList.remove('pi-editor-card');
    $('piModalTitle').textContent = title;
    $('piModalBody').innerHTML = html;
    m.style.display = 'block';
  }

  let editorProduct = null;
  let editorPhotos = [];

  function ensureProductEditorStyles() {
    if ($('piProductStyles')) return;
    const s = document.createElement('style');
    s.id = 'piProductStyles';
    s.textContent = `
      .pi-products-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px}
      body.pi-editor-open #mobileNav{display:none!important}
      .pi-modal-header{min-height:58px}
      .pi-modal-header #piModalTitle{font-size:18px;line-height:1.1}
      .pi-modal-header #piModalClose{padding:9px 12px}
      .pi-products-toolbar{display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:14px}
      .pi-products-toolbar .btn{flex:0 0 auto}
      .pi-product-card{border:1px solid #29313b;border-radius:14px;background:#151b22;padding:14px;cursor:pointer;transition:.16s transform,.16s border-color}
      .pi-product-card:hover{transform:translateY(-1px);border-color:#465363}
      .pi-product-row{display:flex;gap:12px;align-items:center}
      .pi-product-thumb{width:72px;height:72px;border-radius:12px;background:#0c1015;border:1px solid #252d37;object-fit:contain;flex:0 0 auto}
      .pi-product-thumb-empty{display:flex;align-items:center;justify-content:center;color:#66717f;font-size:11px;text-align:center}
      .pi-muted{color:#919baa}
      .pi-small{font-size:12px}
      .pi-chip{display:inline-flex;align-items:center;padding:5px 8px;border:1px solid #303944;border-radius:999px;font-size:11px;color:#b8c0ca;margin:3px 4px 0 0}
      .pi-editor-hero{display:grid;grid-template-columns:128px minmax(0,1fr);gap:18px;align-items:center;margin-bottom:16px}
      .pi-editor-image{width:128px;height:128px;border-radius:16px;object-fit:contain;background:#0c1015;border:1px solid #29313b}
      .pi-editor-image-empty{display:flex;align-items:center;justify-content:center;color:#687381;text-align:center;font-size:12px}
      .pi-tabs{display:flex;gap:7px;overflow:auto;padding:4px 0 12px;position:sticky;top:57px;background:#11161c;z-index:12}
      .pi-tab{white-space:nowrap;border:1px solid #2a323c;background:#161d25;color:#aeb7c2;border-radius:9px;padding:9px 11px;cursor:pointer}
      .pi-tab.active{background:#243142;color:#fff;border-color:#52657b}
      .pi-panel{display:none}
      .pi-panel.active{display:block}
      .pi-section{border:1px solid #29313b;border-radius:14px;padding:14px;background:#131920;margin-bottom:12px}
      .pi-section h3{font-size:14px;margin:0 0 12px}
      .pi-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
      .pi-grid-3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
      .pi-field label{display:block;color:#919baa;font-size:11px;margin:0 0 6px}
      .pi-field input,.pi-field textarea,.pi-field select{width:100%;box-sizing:border-box}
      .pi-field textarea{min-height:100px;resize:vertical}
      .pi-param-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.25fr) auto;gap:8px;align-items:center;margin-bottom:8px}
      .pi-source-box{border:1px solid #29313b;border-radius:12px;padding:12px;background:#0f141a;margin-bottom:10px}
      .pi-photo-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:10px}
      .pi-photo-wrap{position:relative;border:1px solid #29313b;border-radius:12px;overflow:hidden;background:#0c1015;min-height:110px}
      .pi-photo-wrap img{width:100%;height:130px;object-fit:contain;display:block}
      .pi-photo-remove{position:absolute;top:6px;right:6px}
      .pi-savebar{display:flex;justify-content:space-between;gap:10px;align-items:center;position:sticky;bottom:-18px;background:rgba(17,22,28,.96);backdrop-filter:blur(12px);border-top:1px solid #29313b;margin:18px -18px -18px;padding:12px 18px;z-index:15}
      @media(max-width:700px){
        #piModal{
          padding:0!important;
          background:#0b0d10!important;
          min-height:100dvh;
        }
        #piModalCard{
          margin:0!important;
          min-height:100dvh;
          border-radius:0!important;
          border:0!important;
          box-shadow:none!important;
          padding-bottom:calc(82px + env(safe-area-inset-bottom,0px));
        }
        .pi-modal-header{
          min-height:calc(54px + env(safe-area-inset-top,0px))!important;
          padding:calc(8px + env(safe-area-inset-top,0px)) 14px 8px!important;
          background:rgba(17,22,28,.97)!important;
          backdrop-filter:blur(14px);
        }
        .pi-modal-header #piModalTitle{
          font-size:20px!important;
          letter-spacing:-.02em;
        }
        .pi-modal-header #piModalClose{
          padding:8px 10px!important;
          font-size:12px;
          border-radius:9px;
        }
        #piModalBody{padding:12px!important}
        .pi-products-toolbar{
          margin-bottom:10px;
          gap:8px;
        }
        .pi-products-toolbar .pi-small{
          font-size:11px;
          white-space:nowrap;
          overflow:hidden;
          text-overflow:ellipsis;
        }
        .pi-products-toolbar .btn{
          padding:8px 10px;
          font-size:12px;
        }
        .pi-products-grid{grid-template-columns:1fr;gap:9px}
        .pi-product-card{padding:12px;border-radius:13px}
        .pi-product-row{gap:10px;align-items:flex-start}
        .pi-product-thumb{width:68px;height:68px;border-radius:11px}
        .pi-product-card [style*="font-weight:700"]{font-size:16px!important;line-height:1.22!important;margin-top:2px!important}
        .pi-chip{font-size:10px;padding:4px 7px;margin-top:5px}
        .pi-editor-hero{grid-template-columns:78px minmax(0,1fr);gap:12px;margin-bottom:12px}
        .pi-editor-image{width:78px;height:78px;border-radius:11px}
        .pi-editor-hero h2{font-size:18px!important;line-height:1.18!important;margin-top:3px!important}
        .pi-grid,.pi-grid-3{grid-template-columns:1fr}
        .pi-tabs{
          top:calc(54px + env(safe-area-inset-top,0px));
          margin-left:-12px;
          margin-right:-12px;
          padding:7px 12px 9px;
          gap:6px;
          background:rgba(17,22,28,.98);
          scrollbar-width:none;
        }
        .pi-tabs::-webkit-scrollbar{display:none}
        .pi-tab{padding:8px 9px;font-size:11px;border-radius:8px}
        .pi-section{padding:12px;border-radius:12px;margin-bottom:10px}
        .pi-param-row{grid-template-columns:1fr}
        .pi-param-row button{justify-self:start}
        .pi-savebar{
          margin-left:-12px;
          margin-right:-12px;
          margin-bottom:calc(-12px - env(safe-area-inset-bottom,0px));
          bottom:calc(-12px - env(safe-area-inset-bottom,0px));
          padding:10px 12px calc(10px + env(safe-area-inset-bottom,0px));
        }
      }
    `;
    document.head.appendChild(s);
  }

  function objectText(value) {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map(objectText).filter(Boolean).join(', ');
    if (typeof value === 'object') {
      return Object.entries(value)
        .filter(([,v]) => v != null && v !== '')
        .map(([k,v]) => k + ': ' + objectText(v))
        .join(', ');
    }
    return String(value);
  }

  function normalizeParameterItems(product) {
    if (Array.isArray(product?.parameterItems) && product.parameterItems.length) {
      return product.parameterItems.map(p => ({name:String(p?.name || ''), value:String(p?.value ?? '')}));
    }
    if (Array.isArray(product?.parameters)) {
      return product.parameters.map(p => ({name:String(p?.name || p?.key || ''), value:String(p?.value ?? '')}));
    }
    const text = String(product?.parameters || '');
    return text.split(/\r?\n/).map(line => {
      const idx = line.indexOf(':');
      return idx >= 0
        ? {name:line.slice(0,idx).trim(), value:line.slice(idx+1).trim()}
        : {name:'', value:line.trim()};
    }).filter(p => p.name || p.value);
  }

  function parametersText(items) {
    return items
      .filter(p => p.name || p.value)
      .map(p => (p.name ? p.name + ': ' : '') + p.value)
      .join('\n');
  }

  function initialGpsrMaster(product) {
    if (product?.gpsrMaster) return {...product.gpsrMaster};
    const g = product?.gpsrData || product?.sourceSnapshot?.allegro?.gpsr || {};
    const producer = Array.isArray(g.producers) ? g.producers[0] : null;
    return {
      producerName: producer?.name || producer?.tradeName || '',
      producerAddress: objectText(producer?.address),
      producerContact: objectText(producer?.contact),
      responsibleEntity: '',
      responsibleAddress: '',
      responsibleContact: '',
      safetyInformation: objectText(g.safetyInformation)
    };
  }

  function buildAllegroSnapshot(ean, data) {
    const best = data?.best || {};
    return {
      fetchedAt: new Date().toISOString(),
      ean: ean || best.ean || '',
      name: best.name || '',
      brand: best.brand || '',
      model: best.model || '',
      category: data?.categoryMeta?.categoryName || best.category || '',
      categoryId: best.categoryId || data?.categoryMeta?.categoryId || '',
      image: best.image || '',
      description: best.description || '',
      parameters: Array.isArray(best.parameters) ? best.parameters : [],
      gpsr: data?.gpsr || null,
      categoryMeta: data?.categoryMeta || null,
      confidence: Number(data?.confidence ?? 0)
    };
  }

  async function enrichProductFromAllegro(product, force = false) {
    if (!product?.ean) return product;
    if (!force && product?.sourceSnapshot?.allegro) return product;

    const r = await fetch(apiBase() + '/api/search?ean=' + encodeURIComponent(product.ean));
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.best?.name) throw new Error(data.error || 'Nie udało się odświeżyć danych Allegro');

    const snapshot = buildAllegroSnapshot(product.ean, data);
    const currentParams = normalizeParameterItems(product);
    const sourceParams = snapshot.parameters.map(p => ({name:String(p?.name || p?.key || ''), value:String(p?.value ?? '')}));
    const gpsrData = product.gpsrData || snapshot.gpsr || null;
    const next = {
      ...product,
      productName: product.productName || snapshot.name,
      brand: product.brand || snapshot.brand,
      model: product.model || snapshot.model,
      category: product.category || snapshot.category,
      catalogImage: product.catalogImage || snapshot.image,
      description: product.description || snapshot.description,
      parameterItems: currentParams.length ? currentParams : sourceParams,
      parameters: product.parameters || parametersText(sourceParams),
      categoryMeta: product.categoryMeta || snapshot.categoryMeta || null,
      gpsrData,
      confidence: Number.isFinite(Number(product.confidence)) ? Number(product.confidence) : snapshot.confidence,
      sourceSnapshot: {...(product.sourceSnapshot || {}), allegro:snapshot}
    };
    if (!next.gpsrMaster) next.gpsrMaster = initialGpsrMaster(next);

    let saved = {record:next};
    if (window.ProductStorage) saved = window.ProductStorage.saveProduct(localStorage, KEYS.products, next, 500);
    try { await cloudSaveProduct(saved.record); } catch {}
    return saved.record;
  }

  async function resolveProductDetail(lpn) {
    const local = getProducts().find(p => String(p?.lpn || '') === String(lpn || '')) || null;
    let cloud = null;
    try { cloud = await cloudGetProduct(lpn); } catch {}
    let product = local || cloud;
    if (local && cloud) {
      product = String(cloud.savedAt || '') >= String(local.savedAt || '')
        ? {...local, ...cloud}
        : {...cloud, ...local};
    }
    if (!product) throw new Error('Nie znaleziono produktu');
    if (product.ean && !product?.sourceSnapshot?.allegro) {
      try { product = await enrichProductFromAllegro(product, false); } catch {}
    }
    return product;
  }

  function editorField(label, id, value, type='text', extra='') {
    return '<div class="pi-field"><label for="'+id+'">'+safe(label)+'</label><input id="'+id+'" type="'+type+'" value="'+safe(value || '')+'" '+extra+'></div>';
  }

  function editorTextarea(label, id, value, extra='') {
    return '<div class="pi-field"><label for="'+id+'">'+safe(label)+'</label><textarea id="'+id+'" '+extra+'>'+safe(value || '')+'</textarea></div>';
  }

  function renderParameterRows(items) {
    const wrap = $('peParamRows');
    if (!wrap) return;
    wrap.innerHTML = items.map((p,i) =>
      '<div class="pi-param-row" data-param-index="'+i+'">'+
        '<input class="peParamName" value="'+safe(p.name || '')+'" placeholder="Nazwa parametru">'+
        '<input class="peParamValue" value="'+safe(p.value || '')+'" placeholder="Wartość">'+
        '<button type="button" class="btn peParamRemove">Usuń</button>'+
      '</div>'
    ).join('');
    wrap.querySelectorAll('.peParamRemove').forEach(btn => {
      btn.onclick = () => { btn.closest('.pi-param-row')?.remove(); };
    });
  }

  function collectParameterRows() {
    return [...document.querySelectorAll('#peParamRows .pi-param-row')].map(row => ({
      name: row.querySelector('.peParamName')?.value.trim() || '',
      value: row.querySelector('.peParamValue')?.value.trim() || ''
    })).filter(p => p.name || p.value);
  }

  function renderEditorPhotos() {
    const wrap = $('pePhotoGrid');
    if (!wrap) return;
    wrap.innerHTML = editorPhotos.length
      ? editorPhotos.map((src,i) => '<div class="pi-photo-wrap"><img src="'+safe(src)+'" alt="Zdjęcie produktu"><button type="button" class="btn pi-photo-remove" data-i="'+i+'">×</button></div>').join('')
      : '<div class="pi-muted pi-small">Brak zdjęć fizycznej sztuki.</div>';
    wrap.querySelectorAll('.pi-photo-remove').forEach(btn => {
      btn.onclick = () => {
        editorPhotos.splice(Number(btn.dataset.i),1);
        renderEditorPhotos();
      };
    });
  }

  function editorValue(id) {
    return $(id)?.value?.trim?.() || '';
  }

  function collectEditorProduct() {
    const params = collectParameterRows();
    const gpsrMaster = {
      producerName: editorValue('peGpsrProducerName'),
      producerAddress: editorValue('peGpsrProducerAddress'),
      producerContact: editorValue('peGpsrProducerContact'),
      responsibleEntity: editorValue('peGpsrResponsibleEntity'),
      responsibleAddress: editorValue('peGpsrResponsibleAddress'),
      responsibleContact: editorValue('peGpsrResponsibleContact'),
      safetyInformation: editorValue('peSafetyInformation')
    };
    return {
      ...editorProduct,
      ean: editorValue('peEan'),
      asin: editorValue('peAsin'),
      productName: editorValue('peName'),
      brand: editorValue('peBrand'),
      model: editorValue('peModel'),
      category: editorValue('peCategory'),
      description: editorValue('peDescription'),
      parameterItems: params,
      parameters: parametersText(params),
      condition: editorValue('peCondition'),
      serial: editorValue('peSerial'),
      contents: editorValue('peContents'),
      flaws: editorValue('peFlaws'),
      confirm: Boolean($('peConfirm')?.checked),
      loc: editorValue('peLoc'),
      weight: editorValue('peWeight'),
      shipping: editorValue('peShipping'),
      dimensions: {
        length: editorValue('peDimLength'),
        width: editorValue('peDimWidth'),
        height: editorValue('peDimHeight')
      },
      catalogImage: editorValue('peCatalogImage'),
      gpsrMaster,
      safetyProfile: {
        categoryId: editorProduct?.categoryMeta?.categoryId || editorProduct?.sourceSnapshot?.allegro?.categoryId || '',
        templateStatus: editorProduct?.safetyProfile?.templateStatus || 'not-configured'
      },
      photos:[...editorPhotos],
      editedAt:new Date().toISOString(),
      editSource:'product-editor'
    };
  }

  async function saveEditorProduct() {
    const product = collectEditorProduct();
    if (!product.lpn) {
      toast('Brak LPN produktu.');
      return;
    }
    if (!product.productName) {
      toast('Nazwa produktu nie może być pusta.');
      return;
    }

    const saveBtn = $('peSave');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Zapisuję…'; }

    let result = {record:product, updated:true};
    if (window.ProductStorage) {
      result = window.ProductStorage.saveProduct(localStorage, KEYS.products, product, 500);
    }

    let cloudOk = false;
    try {
      const cloud = await cloudSaveProduct(result.record);
      if (cloud?.record) {
        result.record = {...result.record, ...cloud.record};
        if (window.ProductStorage) window.ProductStorage.saveProduct(localStorage, KEYS.products, result.record, 500);
      }
      cloudOk = true;
    } catch (e) {
      console.warn('Editor cloud save failed', e);
    }

    editorProduct = result.record;
    addHistory('Edytowano produkt', product.lpn + ' • ' + product.productName);
    toast(cloudOk ? 'Produkt zapisany i zsynchronizowany.' : 'Produkt zapisany lokalnie. Synchronizacja nie odpowiedziała.');
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Zapisz zmiany'; }
  }

  function activateEditorTab(name) {
    document.querySelectorAll('.pi-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll('.pi-panel').forEach(p => p.classList.toggle('active', p.dataset.panel === name));
  }

  function renderProductEditor(product) {
    ensureProductEditorStyles();
    document.body.classList.add('pi-editor-open');
    $('piModalCard')?.classList.add('pi-editor-card');
    setMobileNavActive('products');
    editorProduct = product;
    editorPhotos = Array.isArray(product.photos) ? [...product.photos] : [];
    const params = normalizeParameterItems(product);
    const gpsr = initialGpsrMaster(product);
    const source = product?.sourceSnapshot?.allegro || null;
    const condValues = product?.categoryMeta?.condition?.values || product?.sourceSnapshot?.allegro?.categoryMeta?.condition?.values || [];
    const dims = product?.dimensions || {};
    const image = product.catalogImage || source?.image || '';

    const imageHtml = image
      ? '<img class="pi-editor-image" src="'+safe(image)+'" alt="Zdjęcie katalogowe">'
      : '<div class="pi-editor-image pi-editor-image-empty">Brak zdjęcia<br>katalogowego</div>';

    const conditionHtml = condValues.length
      ? '<div class="pi-field"><label for="peCondition">Stan</label><select id="peCondition"><option value="">— wybierz —</option>'+
          condValues.map(v => '<option value="'+safe(v.value)+'" '+(String(product.condition||'')===String(v.value)?'selected':'')+'>'+safe(v.value)+'</option>').join('')+
        '</select></div>'
      : editorField('Stan','peCondition',product.condition || '');

    const sourceHtml = source
      ? '<div class="pi-source-box">'+
          '<div style="display:flex;justify-content:space-between;gap:10px;align-items:center"><b>Allegro</b><span class="pi-chip">'+safe(source.confidence)+'% • wynik v1</span></div>'+
          '<div class="pi-small pi-muted" style="margin-top:8px">Pobrano: '+safe(source.fetchedAt ? new Date(source.fetchedAt).toLocaleString('pl-PL') : '—')+'</div>'+
          '<div style="margin-top:10px"><b>'+safe(source.name || '—')+'</b></div>'+
          '<div class="pi-small pi-muted" style="margin-top:5px">EAN '+safe(source.ean || '—')+' • '+safe(source.brand || '—')+' • '+safe(source.model || '—')+' • '+safe(source.category || '—')+'</div>'+
          '<div class="pi-small" style="margin-top:10px">Snapshot źródłowy jest zachowany osobno. Ręczna edycja mastera go nie nadpisuje.</div>'+
        '</div>'
      : '<div class="pi-source-box"><b>Allegro</b><div class="pi-muted pi-small" style="margin-top:6px">Brak zapisanego snapshotu źródłowego.</div></div>';

    openModal('Produkt • ' + (product.lpn || ''), 
      '<div class="pi-editor-hero">'+imageHtml+'<div><div class="pi-muted pi-small">'+safe(product.lpn || '')+'</div><h2 style="font-size:20px;margin:5px 0 7px">'+safe(product.productName || 'Bez nazwy')+'</h2><div>'+
        '<span class="pi-chip">'+safe(product.status || '—')+'</span>'+
        (product.confidence != null ? '<span class="pi-chip">Identyfikacja '+safe(product.confidence)+'%</span>' : '')+
        (product.source ? '<span class="pi-chip">'+safe(product.source)+'</span>' : '')+
      '</div></div></div>'+
      '<div class="pi-tabs">'+
        '<button class="pi-tab active" data-tab="basic">Podstawowe</button>'+
        '<button class="pi-tab" data-tab="params">Parametry</button>'+
        '<button class="pi-tab" data-tab="condition">Stan i zawartość</button>'+
        '<button class="pi-tab" data-tab="warehouse">Magazyn</button>'+
        '<button class="pi-tab" data-tab="gpsr">GPSR i bezpieczeństwo</button>'+
        '<button class="pi-tab" data-tab="photos">Zdjęcia</button>'+
        '<button class="pi-tab" data-tab="sources">Źródła</button>'+
      '</div>'+

      '<div class="pi-panel active" data-panel="basic">'+
        '<div class="pi-section"><h3>Dane podstawowe</h3><div class="pi-grid">'+
          editorField('LPN / SKU','peLpn',product.lpn || '','text','readonly')+
          editorField('EAN / GTIN','peEan',product.ean || '')+
          editorField('ASIN','peAsin',product.asin || '')+
          editorField('Marka','peBrand',product.brand || '')+
          editorField('Model','peModel',product.model || '')+
          editorField('Kategoria','peCategory',product.category || '')+
        '</div><div style="margin-top:12px">'+
          editorField('Nazwa produktu','peName',product.productName || '')+
        '</div><div style="margin-top:12px">'+
          editorTextarea('Opis produktu','peDescription',product.description || '')+
        '</div></div>'+
      '</div>'+

      '<div class="pi-panel" data-panel="params">'+
        '<div class="pi-section"><div style="display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:12px"><h3 style="margin:0">Parametry mastera</h3><button type="button" id="peAddParam" class="btn">+ Dodaj parametr</button></div>'+
          '<div id="peParamRows"></div>'+
          '<div class="pi-muted pi-small">Te wartości są naszym masterem. Oryginalne parametry Allegro pozostają w zakładce Źródła.</div>'+
        '</div>'+
      '</div>'+

      '<div class="pi-panel" data-panel="condition">'+
        '<div class="pi-section"><h3>Stan fizycznej sztuki</h3><div class="pi-grid">'+
          conditionHtml+
          editorField('Numer seryjny / IMEI','peSerial',product.serial || '')+
        '</div><div style="margin-top:12px">'+editorTextarea('Zawartość / akcesoria','peContents',product.contents || '')+'</div>'+
        '<div style="margin-top:12px">'+editorTextarea('Wady / braki / uwagi','peFlaws',product.flaws || '')+'</div>'+
        '<label style="display:flex;gap:9px;align-items:center;margin-top:12px"><input id="peConfirm" type="checkbox" '+(product.confirm?'checked':'')+'> <span>Tester fizycznie potwierdził zgodność produktu</span></label>'+
        '</div>'+
      '</div>'+

      '<div class="pi-panel" data-panel="warehouse">'+
        '<div class="pi-section"><h3>Magazyn i logistyka</h3><div class="pi-grid">'+
          editorField('Lokalizacja magazynowa','peLoc',product.loc || '')+
          editorField('Waga','peWeight',product.weight || '')+
          editorField('Profil wysyłki / gabaryt','peShipping',product.shipping || '')+
        '</div><div class="pi-grid-3" style="margin-top:12px">'+
          editorField('Długość','peDimLength',dims.length || '')+
          editorField('Szerokość','peDimWidth',dims.width || '')+
          editorField('Wysokość','peDimHeight',dims.height || '')+
        '</div><div class="pi-muted pi-small" style="margin-top:10px">Cenniki wysyłek dodamy jako osobny moduł po ukończeniu edytora produktu.</div></div>'+
      '</div>'+

      '<div class="pi-panel" data-panel="gpsr">'+
        '<div class="pi-section"><h3>GPSR — dane mastera</h3><div class="pi-grid">'+
          editorField('Producent','peGpsrProducerName',gpsr.producerName || '')+
          editorField('Kontakt producenta','peGpsrProducerContact',gpsr.producerContact || '')+
        '</div><div style="margin-top:12px">'+editorTextarea('Adres producenta','peGpsrProducerAddress',gpsr.producerAddress || '')+'</div>'+
        '<div class="pi-grid" style="margin-top:12px">'+
          editorField('Osoba / podmiot odpowiedzialny w UE','peGpsrResponsibleEntity',gpsr.responsibleEntity || '')+
          editorField('Kontakt podmiotu odpowiedzialnego','peGpsrResponsibleContact',gpsr.responsibleContact || '')+
        '</div><div style="margin-top:12px">'+editorTextarea('Adres podmiotu odpowiedzialnego','peGpsrResponsibleAddress',gpsr.responsibleAddress || '')+'</div>'+
        '<div style="margin-top:12px">'+editorTextarea('Informacje / ostrzeżenia bezpieczeństwa','peSafetyInformation',gpsr.safetyInformation || '')+'</div>'+
        '</div>'+
        '<div class="pi-section"><h3>Baza bezpieczeństwa kategorii</h3><div class="pi-muted">Kategoria Allegro: '+safe(product?.categoryMeta?.categoryName || source?.category || product.category || '—')+'</div>'+
          '<div class="pi-small" style="margin-top:8px">Struktura jest przygotowana pod następny etap: własne drzewo kategorii → szablon informacji bezpieczeństwa → zatwierdzenie przez testera. Teraz nic nie jest automatycznie dopisywane.</div>'+
        '</div>'+
      '</div>'+

      '<div class="pi-panel" data-panel="photos">'+
        '<div class="pi-section"><h3>Zdjęcie katalogowe</h3>'+editorField('URL zdjęcia katalogowego','peCatalogImage',image || '')+'</div>'+
        '<div class="pi-section"><div style="display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:12px"><h3 style="margin:0">Zdjęcia fizycznej sztuki</h3><label class="btn" style="cursor:pointer">+ Dodaj zdjęcia<input id="pePhotoInput" type="file" accept="image/*" multiple style="display:none"></label></div><div id="pePhotoGrid" class="pi-photo-grid"></div></div>'+
      '</div>'+

      '<div class="pi-panel" data-panel="sources">'+
        '<div class="pi-section"><h3>Dane źródłowe</h3>'+sourceHtml+
          '<button type="button" id="peRefreshAllegro" class="btn">Odśwież snapshot z Allegro</button>'+
          '<div class="pi-muted pi-small" style="margin-top:8px">Odświeżenie aktualizuje źródło. Nie nadpisuje ręcznie zmienionych wartości mastera.</div>'+
        '</div>'+
      '</div>'+

      '<div class="pi-savebar"><button type="button" id="peBack" class="btn">← Produkty</button><button type="button" id="peSave" class="btn primary">Zapisz zmiany</button></div>'
    );

    renderParameterRows(params);
    renderEditorPhotos();

    document.querySelectorAll('.pi-tab').forEach(btn => btn.onclick = () => activateEditorTab(btn.dataset.tab));
    if ($('peAddParam')) $('peAddParam').onclick = () => {
      const items = collectParameterRows();
      items.push({name:'',value:''});
      renderParameterRows(items);
    };
    if ($('peBack')) $('peBack').onclick = () => showProducts();
    if ($('peSave')) $('peSave').onclick = saveEditorProduct;
    if ($('pePhotoInput')) $('pePhotoInput').onchange = async e => {
      const files = [...(e.target.files || [])];
      for (const file of files) {
        try { editorPhotos.push(await compressImage(file)); } catch {}
      }
      renderEditorPhotos();
      e.target.value = '';
    };
    if ($('peRefreshAllegro')) $('peRefreshAllegro').onclick = async () => {
      const btn = $('peRefreshAllegro');
      btn.disabled = true;
      btn.textContent = 'Pobieram…';
      try {
        const masterBefore = collectEditorProduct();
        const refreshed = await enrichProductFromAllegro(masterBefore, true);
        editorProduct = {...masterBefore, sourceSnapshot:refreshed.sourceSnapshot, gpsrData:refreshed.gpsrData, categoryMeta:refreshed.categoryMeta, confidence:refreshed.confidence};
        toast('Snapshot Allegro odświeżony. Master pozostał bez zmian.');
        renderProductEditor(editorProduct);
        activateEditorTab('sources');
      } catch (e) {
        toast('Nie udało się odświeżyć Allegro: ' + (e.message || 'błąd'));
        btn.disabled = false;
        btn.textContent = 'Odśwież snapshot z Allegro';
      }
    };
  }

  async function openProductEditor(lpn) {
    ensureProductEditorStyles();
    openModal('Produkt', '<div style="padding:30px;text-align:center;color:#919baa">Pobieram pełną kartę produktu…</div>');
    try {
      const product = await resolveProductDetail(lpn);
      renderProductEditor(product);
    } catch (e) {
      openModal('Produkt', '<div style="padding:24px;color:#d5a3a3">Nie udało się otworzyć produktu: '+safe(e.message || 'błąd')+'</div>');
    }
  }

  async function showProducts() {
    setMobileNavActive('products');
    ensureProductEditorStyles();
    ensureVerifiedRealProductsLocal();
    openModal(
      'Produkty',
      '<div style="padding:24px;color:#919baa;text-align:center">Ładuję i synchronizuję produkty…</div>'
    );

    let products = getProducts().filter(p => !String(p?.lpn || '').startsWith('TEST-SEED-'));
    const hasRealSeed = ['195949544026','4548736132580','6925281994258']
      .every(ean => products.some(p => String(p?.ean || '') === ean));

    if (!hasRealSeed) {
      await seedRealCatalogProducts(true);
      products = getProducts().filter(p => !String(p?.lpn || '').startsWith('TEST-SEED-'));
    }

    try {
      products = await syncProductsFromCloud(true);
    } catch {}

    products = products.filter(p => !String(p?.lpn || '').startsWith('TEST-SEED-'));

    const cards = products.length ? products.map(p => {
      const image = p.catalogImage || p?.sourceSnapshot?.allegro?.image || '';
      const img = image
        ? '<img class="pi-product-thumb" src="'+safe(image)+'" alt="">'
        : '<div class="pi-product-thumb pi-product-thumb-empty">Brak<br>zdjęcia</div>';
      return '<div class="pi-product-card" data-product-lpn="'+safe(p.lpn)+'">'+
        '<div class="pi-product-row">'+img+'<div style="min-width:0;flex:1">'+
          '<div class="pi-small pi-muted">'+safe(p.lpn || '')+'</div>'+
          '<div style="font-weight:700;margin:3px 0 6px;line-height:1.3">'+safe(p.productName || 'Bez nazwy')+'</div>'+
          '<div class="pi-small pi-muted">'+safe([p.brand,p.model].filter(Boolean).join(' • ') || '—')+'</div>'+
        '</div></div>'+
        '<div style="margin-top:10px">'+
          (p.ean ? '<span class="pi-chip">EAN '+safe(p.ean)+'</span>' : '')+
          (p.loc ? '<span class="pi-chip">'+safe(p.loc)+'</span>' : '')+
          (p.confidence != null ? '<span class="pi-chip">'+safe(p.confidence)+'%</span>' : '')+
        '</div>'+
        '<div class="pi-small pi-muted" style="display:flex;justify-content:space-between;gap:8px;margin-top:10px"><span>'+safe(p.status || '—')+'</span><span>Otwórz →</span></div>'+
      '</div>';
    }).join('') : '<div style="color:#919baa;padding:20px">Nie zapisano jeszcze żadnego produktu.</div>';

    openModal(
      'Produkty',
      '<div class="pi-products-toolbar">'+
        '<div class="pi-muted pi-small">Master produktów • '+products.length+' • build v18</div>'+
        '<button id="refreshProducts" class="btn">Odśwież</button>'+
      '</div>'+
      '<div class="pi-products-grid">'+cards+'</div>'
    );

    document.querySelectorAll('.pi-product-card').forEach(card => {
      card.onclick = () => openProductEditor(card.dataset.productLpn);
    });

    if ($('refreshProducts')) $('refreshProducts').onclick = async () => {
      $('refreshProducts').disabled = true;
      $('refreshProducts').textContent = 'Synchronizuję…';
      try {
        await seedRealCatalogProducts(true);
        await syncProductsFromCloud(false);
      } finally {
        showProducts();
      }
    };
  }

  function showHistory() {
    setMobileNavActive('more');
    const h = JSON.parse(localStorage.getItem(KEYS.history) || '[]');
    openModal('Historia', h.length ? h.map(x => '<div style="padding:10px 0;border-bottom:1px solid #252c35"><b>'+safe(x.action)+'</b><div style="color:#919baa;font-size:12px;margin-top:3px">'+new Date(x.time).toLocaleString('pl-PL')+' • '+safe(x.details)+'</div></div>').join('') : '<div style="color:#919baa">Brak historii.</div>');
  }
  function showLocations() {
    setMobileNavActive('more');
    const locs = [...new Set(getProducts().map(p=>p.loc).filter(Boolean))].sort();
    openModal('Lokalizacje', locs.length ? locs.map(x => '<span style="display:inline-block;padding:8px 10px;margin:5px;border:1px solid #2a323c;border-radius:9px">'+safe(x)+'</span>').join('') : '<div style="color:#919baa">Lokalizacje pojawią się po zapisaniu produktów.</div>');
  }
  function showIntegrations() {
    setMobileNavActive('integrations');
    const base = localStorage.getItem(KEYS.apiBase) || DEFAULT_API_BASE;
    openModal('Integracje', '<div style="display:grid;gap:14px"><div style="padding:14px;border:1px solid #2a323c;border-radius:12px"><b>Allegro API</b><div style="color:#919baa;font-size:12px;margin-top:4px">Wyszukiwanie katalogu po GTIN/EAN wymaga połączenia konta Allegro przez OAuth.</div><div style="margin-top:10px"><button id="connectAllegro" class="btn primary">Połącz konto Allegro</button> <button id="checkAllegro" class="btn">Sprawdź status</button></div><div id="allegroStatus" style="font-size:12px;color:#919baa;margin-top:8px"></div></div><div style="padding:14px;border:1px solid #2a323c;border-radius:12px"><b>Synchronizacja urządzeń</b><div style="color:#919baa;font-size:12px;margin-top:4px">Ten kod łączy iPhone, iPad i komputer z tą samą bazą produktów. Traktuj go jak hasło — osoba z tym kodem może odczytać produkty.</div><div style="margin-top:10px"><label>Kod synchronizacji</label><input id="workspaceKeyInput" type="password" autocomplete="off" value="'+safe(getWorkspaceKey())+'" style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace"></div><div style="margin-top:10px"><button id="copyWorkspaceKey" class="btn">Kopiuj kod</button> <button id="useWorkspaceKey" class="btn primary">Użyj tego kodu</button> <button id="syncNow" class="btn">Synchronizuj teraz</button></div><div id="syncStatus" style="font-size:12px;color:#919baa;margin-top:8px">Wspólna baza online jest aktywna.</div></div><div style="padding:14px;border:1px solid #2a323c;border-radius:12px"><b>Amazon SP-API</b><div style="color:#919baa;font-size:12px;margin-top:4px">Backend przygotowany do Catalog Items API po EAN/ASIN.</div></div><div><label>Adres naszego backendu API</label><input id="apiBaseInput" placeholder="np. https://api.twojadomena.pl" value="'+safe(base)+'"><div style="color:#919baa;font-size:11px;margin-top:6px">Tu zapisujemy tylko adres API. Client secretów i tokenów nigdy nie przechowujemy w przeglądarce.</div></div><div><button id="saveApiBase" class="btn">Zapisz adres</button> <button id="testApiBase" class="btn">Test połączenia</button></div><div id="apiTestResult" style="font-size:12px;color:#919baa"></div></div>');
    if ($('copyWorkspaceKey')) $('copyWorkspaceKey').onclick = async () => {
      try {
        await navigator.clipboard.writeText(getWorkspaceKey());
        $('syncStatus').textContent = 'Kod skopiowany. Wklej go na drugim urządzeniu.';
      } catch {
        $('workspaceKeyInput').type = 'text';
        $('workspaceKeyInput').select();
        $('syncStatus').textContent = 'Zaznaczyłem kod — skopiuj go ręcznie.';
      }
    };

    if ($('useWorkspaceKey')) $('useWorkspaceKey').onclick = async () => {
      const key = $('workspaceKeyInput').value.trim();
      if (!/^[A-Za-z0-9_-]{32,128}$/.test(key)) {
        $('syncStatus').textContent = 'Nieprawidłowy kod synchronizacji.';
        return;
      }

      $('syncStatus').textContent = 'Łączę z bazą…';
      localStorage.setItem(KEYS.workspaceKey, key);
      localStorage.setItem('productIntake.cloudMigrated.' + key.slice(0,12), 'done');

      try {
        const products = await syncProductsFromCloud(true);
        $('syncStatus').textContent = 'Połączono • ' + products.length + ' produktów w tej bazie.';
      } catch (e) {
        $('syncStatus').textContent = 'Błąd: ' + (e.message || 'nie udało się połączyć');
      }
    };

    if ($('syncNow')) $('syncNow').onclick = async () => {
      $('syncStatus').textContent = 'Synchronizuję…';
      try {
        const products = await syncProductsFromCloud(true);
        $('syncStatus').textContent = 'Gotowe • ' + products.length + ' produktów.';
      } catch (e) {
        $('syncStatus').textContent = 'Błąd: ' + (e.message || 'brak połączenia');
      }
    };

    $('saveApiBase').onclick = () => {
      localStorage.setItem(KEYS.apiBase, $('apiBaseInput').value.trim().replace(/\/$/,''));
      $('apiTestResult').textContent = 'Zapisano.';
    };
    $('testApiBase').onclick = async () => {
      const b = $('apiBaseInput').value.trim().replace(/\/$/,'');
      if (!b) return $('apiTestResult').textContent='Najpierw wpisz adres API.';
      $('apiTestResult').textContent='Sprawdzam…';
      try {
        const r = await fetch(b+'/health');
        const j = await r.json();
        $('apiTestResult').textContent = r.ok ? 'Połączenie działa: '+(j.status||'OK') : 'API zwróciło błąd.';
      } catch { $('apiTestResult').textContent='Brak połączenia z API.'; }
    };
    $('connectAllegro').onclick = async () => {
      const b = ($('apiBaseInput').value.trim() || localStorage.getItem(KEYS.apiBase) || DEFAULT_API_BASE).replace(/\/$/,'');
      if (!b) return $('allegroStatus').textContent='Najpierw zapisz adres backendu.';
      localStorage.setItem(KEYS.apiBase,b);
      $('allegroStatus').textContent='Pobieram link logowania…';
      try {
        const r = await fetch(b+'/api/allegro/auth-url');
        const j = await r.json();
        if (!r.ok || !j.url) throw new Error(j.error || 'Brak URL');
        location.href = j.url;
      } catch (e) {
        $('allegroStatus').textContent='Błąd: '+(e.message||'brak połączenia');
      }
    };
    $('checkAllegro').onclick = async () => {
      const b = ($('apiBaseInput').value.trim() || localStorage.getItem(KEYS.apiBase) || '').replace(/\/$/,'');
      if (!b) return $('allegroStatus').textContent='Najpierw zapisz adres backendu.';
      $('allegroStatus').textContent='Sprawdzam…';
      try {
        const r = await fetch(b+'/api/allegro/status');
        const j = await r.json();
        $('allegroStatus').textContent = j.connected ? 'Allegro połączone.' : (j.configured ? 'Skonfigurowane, ale konto nie jest jeszcze połączone.' : 'Backend nie ma jeszcze konfiguracji Allegro.');
      } catch { $('allegroStatus').textContent='Nie udało się sprawdzić statusu.'; }
    };
  }

  function setMobileNavActive(name) {
    const nav = $('mobileNav');
    if (!nav) return;
    nav.querySelectorAll('button[data-act]').forEach(btn => {
      const active = btn.dataset.act === name;
      btn.classList.toggle('primaryMobile', active);
      btn.setAttribute('aria-current', active ? 'page' : 'false');
    });
  }

  function setupMobileNav() {
    if (document.getElementById('mobileNav')) return;

    const style = document.createElement('style');
    style.textContent = `
      #toast{z-index:2200}
      #mobileNav{display:none}
      @media(max-width:1150px){
        #mobileNav{
          position:fixed;
          left:8px;right:8px;
          bottom:calc(8px + env(safe-area-inset-bottom,0px));
          z-index:1800;
          display:grid;
          grid-template-columns:repeat(4,1fr);
          gap:6px;
          padding:7px;
          background:rgba(13,16,20,.97);
          backdrop-filter:blur(18px);
          -webkit-backdrop-filter:blur(18px);
          border:1px solid #303945;
          border-radius:16px;
          box-shadow:0 18px 48px rgba(0,0,0,.48)
        }
        #mobileNav button{
          min-height:46px;
          border:0;
          background:transparent;
          color:#aeb6c1;
          padding:10px 5px;
          border-radius:11px;
          font-size:12px;
          line-height:1;
          font-weight:720;
          letter-spacing:.01em;
          transition:background .15s,color .15s,transform .15s
        }
        #mobileNav button:active{transform:scale(.98)}
        #mobileNav button.primaryMobile{
          background:#1a2640;
          color:#fff;
          box-shadow:inset 0 0 0 1px rgba(127,156,255,.12)
        }
        body{padding-bottom:calc(88px + env(safe-area-inset-bottom,0px))}
        #piModalCard:not(.pi-editor-card){
          padding-bottom:calc(96px + env(safe-area-inset-bottom,0px))!important
        }
        #toast{
          bottom:calc(96px + env(safe-area-inset-bottom,0px));
          left:14px;right:14px;text-align:center
        }
      }`;
    document.head.appendChild(style);

    const nav = document.createElement('div');
    nav.id = 'mobileNav';
    nav.setAttribute('role','navigation');
    nav.setAttribute('aria-label','Główna nawigacja');
    nav.innerHTML = `
      <button class="primaryMobile" data-act="add" aria-current="page">Dodaj</button>
      <button data-act="products">Produkty</button>
      <button data-act="integrations">Integracje</button>
      <button data-act="more">Więcej</button>`;
    document.body.appendChild(nav);

    nav.querySelector('[data-act="add"]').onclick = () => {
      closePiModal();
      setMobileNavActive('add');
      window.scrollTo({top:0,behavior:'smooth'});
    };
    nav.querySelector('[data-act="products"]').onclick = () => {
      setMobileNavActive('products');
      showProducts();
    };
    nav.querySelector('[data-act="integrations"]').onclick = () => {
      setMobileNavActive('integrations');
      showIntegrations();
    };
    nav.querySelector('[data-act="more"]').onclick = () => {
      setMobileNavActive('more');
      openModal('Więcej',
        '<div style="display:grid;gap:8px">'+
        '<button id="mLocations" class="btn">Lokalizacje</button>'+
        '<button id="mHistory" class="btn">Historia</button>'+
        '<button id="mSettings" class="btn">Ustawienia</button>'+
        '</div>');
      document.getElementById('mLocations').onclick = showLocations;
      document.getElementById('mHistory').onclick = showHistory;
      document.getElementById('mSettings').onclick = () => {
        setMobileNavActive('more');
        openModal('Ustawienia','<div style="color:#919baa">Ustawienia aplikacji będziemy rozwijać w kolejnych iteracjach.</div>');
      };
    };
  }

  function setupNav() {
    const navs = [...document.querySelectorAll('.nav')];
    if (navs[1]) navs[1].onclick = showProducts;
    if (navs[2]) navs[2].onclick = showLocations;
    if (navs[3]) navs[3].onclick = showHistory;
    if (navs[4]) {
      const integrations = navs[4].cloneNode(true);
      integrations.textContent = 'Integracje';
      navs[4].parentNode.insertBefore(integrations, navs[4]);
      integrations.onclick = showIntegrations;
      navs[4].onclick = () => openModal('Ustawienia','<div style="color:#919baa">Ustawienia aplikacji będziemy rozwijać w kolejnych iteracjach.</div>');
    }
  }

  function normalizeRemote(data) {
    if (!data) return null;
    return data.best || data.product || null;
  }
  function renderRemote(data) {
    const best = normalizeRemote(data);
    if (!best) { toast('Nie znaleziono jednoznacznego produktu.'); return false; }
    if (typeof identified !== 'undefined') identified = true;
    const confidence = Number(data.confidence ?? 0);
    const conflicts = Array.isArray(data.hardConflicts) ? data.hardConflicts : [];
    const sourceCards = Object.entries(data.sources || {}).map(([k,v]) => '<div class="source"><b>'+safe(k[0].toUpperCase()+k.slice(1))+'</b><small>'+safe(v?.status || (v ? 'znaleziono' : 'brak'))+'</small><div style="margin-top:8px">'+safe(v?.name || '—')+'</div></div>').join('');
    const checks = Array.isArray(data.checks) ? data.checks.map(c => '<div class="check"><span>'+safe(c.label)+'</span><span>'+safe(c.value||'—')+'</span><span class="'+(c.status==='ok'?'ok':c.status==='warn'?'warn':'bad')+'">'+safe(c.text||c.status)+'</span></div>').join('') : '';
    $('lookup').style.display='block';
    $('lookup').innerHTML = '<div class="lookupTop"><div><b>Wynik identyfikacji</b><div class="muted">Dane z podłączonych źródeł API.</div></div><div><span class="score">'+confidence+'%</span> <span class="badge '+(conflicts.length?'':'ok')+'">'+(conflicts.length?'konflikt':'wynik')+'</span></div></div><div class="sources">'+sourceCards+'</div><div style="margin-top:12px">'+checks+'</div>'+(conflicts.length?'<div class="note" style="border-color:rgba(234,119,123,.3);color:#f0b2b4">Blokada: '+safe(conflicts.join(', '))+'</div>':'');
    if ($('productName')) $('productName').value = best.name || '';
    if ($('brand')) $('brand').value = best.brand || '';
    if ($('model')) $('model').value = best.model || '';
    if ($('category')) $('category').value = data.categoryMeta?.categoryName || best.category || '';
    if ($('parameters') && best.parameters) $('parameters').value = Array.isArray(best.parameters) ? best.parameters.map(p => (p.name||p.key)+': '+(p.value??'')).join('\n') : String(best.parameters);
    if (best.asin && !$('asin').value) $('asin').value = best.asin;
    if (best.ean && !$('ean').value) $('ean').value = best.ean;

    applyCategoryMeta(data.categoryMeta || null);
    applyGpsr(data.gpsr || null);
    applyConfidence(confidence);
    quality();
    saveDraft();
    addHistory('Identyfikacja API', ($('lpn').value||'')+' • '+(best.name||''));
    return true;
  }
  window.lookup = async function() {
    const base = (localStorage.getItem(KEYS.apiBase)||DEFAULT_API_BASE).replace(/\/$/,'');
    if (!$('ean').value.trim() && !$('asin').value.trim()) return toast('Podaj EAN lub ASIN');
    toast('Sprawdzam produkt…');
    const lookupBtn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Sprawdź produkt');
    const oldLookupText = lookupBtn?.textContent;
    if (lookupBtn) {
      lookupBtn.disabled = true;
      lookupBtn.textContent = 'Sprawdzam…';
    }
    try {
      const q = new URLSearchParams();
      if ($('ean').value.trim()) q.set('ean',$('ean').value.trim());
      if ($('asin').value.trim()) q.set('asin',$('asin').value.trim());
      const r = await fetch(base+'/api/search?'+q.toString());
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Błąd API');
      renderRemote(j);
    } catch (e) {
      toast('Błąd integracji: '+(e.message||'brak połączenia'));
    } finally {
      if (lookupBtn) {
        lookupBtn.disabled = false;
        lookupBtn.textContent = oldLookupText || 'Sprawdź produkt';
      }
    }
  };

  function showSaveSuccess() {
    const lpnValue = $('lpn')?.value.trim() || '—';
    const nameValue = $('productName')?.value.trim() || 'Produkt';
    openModal(
      'Produkt zapisany',
      '<div style="display:grid;gap:16px">'+
        '<div style="padding:16px;border:1px solid #2a323c;border-radius:12px;background:#10161c">'+
          '<div style="font-size:13px;color:#919baa">Gotowy produkt</div>'+
          '<div style="font-size:20px;font-weight:750;margin-top:5px">'+safe(nameValue)+'</div>'+
          '<div style="font-size:13px;color:#919baa;margin-top:5px">LPN: '+safe(lpnValue)+'</div>'+
        '</div>'+
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'+
          '<button id="successNextProduct" class="btn primary">Dodaj kolejny produkt</button>'+
          '<button id="successProducts" class="btn">Przejdź do produktów</button>'+
        '</div>'+
      '</div>'
    );

    const nextBtn = $('successNextProduct');
    const productsBtn = $('successProducts');

    if (nextBtn) nextBtn.onclick = () => {
      const products = getProducts();
      if (products[0]?.id) localStorage.setItem('productIntake.skipRecoveryId', products[0].id);
      localStorage.removeItem(KEYS.draft);
      location.href = location.pathname;
    };
    if (productsBtn) productsBtn.onclick = showProducts;
  }

  window.finish = async function() {
    const ok = await saveReadyProduct();
    if (!ok) return;
    showSaveSuccess();
  };

  function setupFinalStep() {
    const foot = document.querySelector('.foot');
    if (!foot) return;
    const nextButton = [...foot.querySelectorAll('button')].find(b => b.textContent.includes('Dalej'));
    if (!nextButton) return;

    const baseRender = window.render;
    window.render = function() {
      if (typeof baseRender === 'function') baseRender();
      nextButton.style.display = (typeof step !== 'undefined' && step === 4) ? 'none' : '';
    };

    window.render();
  }

  window.next = function() {
    const confirmed = !!document.querySelector('#confirm:checked');
    if (typeof step !== 'undefined' && step === 0 && typeof identified !== 'undefined' && !identified) {
      return toast('Najpierw sprawdź produkt');
    }
    if (typeof step !== 'undefined' && step === 1 && !confirmed) {
      return toast('Tester musi potwierdzić identyfikację');
    }
    if (typeof step !== 'undefined' && step < 4) {
      step++;
      if (typeof render === 'function') render();
      saveDraft();
    }
  };

  const basePrev = window.prev;
  window.prev = function() {
    basePrev?.();
    saveDraft();
  };

  function bindAutosave() {
    document.addEventListener('input', e => {
      if (e.target.matches('input,select,textarea')) {
        if (typeof quality === 'function') quality();
        saveDraft();
      }
    });
    document.addEventListener('change', e => {
      if (e.target.matches('input,select,textarea')) {
        if (e.target.id === 'condition') updateEanRequirementUi();
        if (typeof quality === 'function') quality();
        saveDraft();
      }
    });

    window.addEventListener('pagehide', saveDraft);
    window.addEventListener('beforeunload', saveDraft);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') saveDraft();
    });
  }
  async function handleAllegroCallback() {
    const params = new URLSearchParams(location.search);
    const allegro = params.get('allegro');
    const reason = params.get('reason');

    if (allegro === 'connected') {
      addHistory('Połączono Allegro','OAuth');
      toast('Konto Allegro połączone.');
      history.replaceState({},'',location.pathname);
      return;
    }

    if (allegro === 'error') {
      toast('Allegro: błąd autoryzacji' + (reason ? ' ('+reason+')' : ''));
      history.replaceState({},'',location.pathname);
    }
  }

    async function boot() {
    ensureIds();
    setupPhotos();
    setupNav();
    setupMobileNav();
    setupFinalStep();
    bindAutosave();
    loadDraft();
    ensureVerifiedRealProductsLocal();
    await initializeCloudProducts();
    await pushVerifiedRealProductsToCloud();
    await seedRealCatalogProducts();
    addHistory('Otwarto aplikację','Product Intake');
    handleAllegroCallback();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();