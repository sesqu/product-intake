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

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(()=>{}));
  }

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
        if (!prev || String(p.savedAt || '') >= String(prev.savedAt || '')) byLpn.set(key, p);
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
      const selects = warehouse.querySelectorAll('select');
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
    m.innerHTML = '<div style="max-width:980px;margin:4vh auto;background:#11161c;border:1px solid #2a323c;border-radius:16px;box-shadow:0 24px 80px rgba(0,0,0,.45)"><div style="display:flex;justify-content:space-between;align-items:center;padding:16px 18px;border-bottom:1px solid #252c35"><b id="piModalTitle"></b><button id="piModalClose" class="btn">Zamknij</button></div><div id="piModalBody" style="padding:18px"></div></div>';
    document.body.appendChild(m);
    $('piModalClose').onclick = () => m.style.display='none';
    m.addEventListener('click', e => { if (e.target === m) m.style.display='none'; });
    return m;
  }
  function openModal(title, html) {
    const m = makeModal();
    $('piModalTitle').textContent = title;
    $('piModalBody').innerHTML = html;
    m.style.display = 'block';
  }

  async function showProducts() {
    ensureVerifiedRealProductsLocal();
    openModal(
      'Produkty gotowe',
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

    const rows = products.length ? products.map(p => '<tr><td>'+safe(p.lpn)+'</td><td>'+safe(p.productName||'—')+'</td><td>'+safe(p.ean||p.asin||'—')+'</td><td>'+safe(p.loc||'—')+'</td><td>'+new Date(p.savedAt).toLocaleString('pl-PL')+'</td></tr>').join('') : '<tr><td colspan="5" style="color:#919baa;padding:20px">Nie zapisano jeszcze żadnego produktu.</td></tr>';

    openModal(
      'Produkty gotowe',
      '<div style="display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:12px">'+
        '<div style="color:#919baa;font-size:12px">Źródło: lokalnie + wspólna baza online • '+products.length+' produktów • build v16</div>'+
        '<button id="refreshProducts" class="btn">Odśwież</button>'+
      '</div>'+
      '<div style="overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="text-align:left;color:#919baa"><th style="padding:9px">LPN</th><th>Nazwa</th><th>EAN / ASIN</th><th>Lokalizacja</th><th>Zapisano</th></tr></thead><tbody>'+rows+'</tbody></table></div>'
    );

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
    const h = JSON.parse(localStorage.getItem(KEYS.history) || '[]');
    openModal('Historia', h.length ? h.map(x => '<div style="padding:10px 0;border-bottom:1px solid #252c35"><b>'+safe(x.action)+'</b><div style="color:#919baa;font-size:12px;margin-top:3px">'+new Date(x.time).toLocaleString('pl-PL')+' • '+safe(x.details)+'</div></div>').join('') : '<div style="color:#919baa">Brak historii.</div>');
  }
  function showLocations() {
    const locs = [...new Set(getProducts().map(p=>p.loc).filter(Boolean))].sort();
    openModal('Lokalizacje', locs.length ? locs.map(x => '<span style="display:inline-block;padding:8px 10px;margin:5px;border:1px solid #2a323c;border-radius:9px">'+safe(x)+'</span>').join('') : '<div style="color:#919baa">Lokalizacje pojawią się po zapisaniu produktów.</div>');
  }
  function showIntegrations() {
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

  function setupMobileNav() {
    if (document.getElementById('mobileNav')) return;

    const style = document.createElement('style');
    style.textContent = `
      #toast{z-index:1200}
            #mobileNav{display:none}
      @media(max-width:1150px){
        #mobileNav{
          position:fixed;left:10px;right:10px;bottom:10px;z-index:999;
          display:grid;grid-template-columns:repeat(4,1fr);gap:6px;
          padding:7px;background:rgba(13,16,20,.94);
          backdrop-filter:blur(14px);border:1px solid #28303a;border-radius:14px;
          box-shadow:0 16px 45px rgba(0,0,0,.35)
        }
        #mobileNav button{
          border:0;background:transparent;color:#aeb6c1;padding:9px 5px;
          border-radius:9px;font-size:11px;font-weight:650
        }
        #mobileNav button.primaryMobile{background:#172033;color:#fff}
        body{padding-bottom:76px}
        #toast{bottom:82px;left:14px;right:14px;text-align:center}
      }`;
    document.head.appendChild(style);

    const nav = document.createElement('div');
    nav.id = 'mobileNav';
    nav.innerHTML = `
      <button class="primaryMobile" data-act="add">Dodaj</button>
      <button data-act="products">Produkty</button>
      <button data-act="integrations">Integracje</button>
      <button data-act="more">Więcej</button>`;
    document.body.appendChild(nav);

    nav.querySelector('[data-act="add"]').onclick = () => {
      window.scrollTo({top:0,behavior:'smooth'});
    };
    nav.querySelector('[data-act="products"]').onclick = showProducts;
    nav.querySelector('[data-act="integrations"]').onclick = showIntegrations;
    nav.querySelector('[data-act="more"]').onclick = () => {
      openModal('Więcej',
        '<div style="display:grid;gap:8px">'+
        '<button id="mLocations" class="btn">Lokalizacje</button>'+
        '<button id="mHistory" class="btn">Historia</button>'+
        '<button id="mSettings" class="btn">Ustawienia</button>'+
        '</div>');
      document.getElementById('mLocations').onclick = showLocations;
      document.getElementById('mHistory').onclick = showHistory;
      document.getElementById('mSettings').onclick = () => openModal('Ustawienia','<div style="color:#919baa">Ustawienia aplikacji będziemy rozwijać w kolejnych iteracjach.</div>');
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

  const demoLookup = window.lookup;
  window.lookup = async function() {
    const base = (localStorage.getItem(KEYS.apiBase)||DEFAULT_API_BASE).replace(/\/$/,'');
    if (!base) return demoLookup();
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
    }
  };

  const originalNext = window.next;
  window.next = function() {
    const result = originalNext?.();
    saveDraft();
    return result;
  };

  const originalPrev = window.prev;
  window.prev = function() {
    const result = originalPrev?.();
    saveDraft();
    return result;
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

  function seedVisibleTestProducts() {
    const flag = 'productIntake.visibleSeed.v1';
    if (localStorage.getItem(flag) === 'done') return;

    const fixtures = [
      {
        lpn:'TEST-SEED-001',
        productName:'Test zapisu 1',
        ean:'5900000000011',
        loc:'TEST-A1',
        shipping:'Kurier standard',
        condition:'Nowy',
        contents:'Produkt testowy',
        identified:true,
        confirm:true,
        status:'ready',
        photos:[]
      },
      {
        lpn:'TEST-SEED-002',
        productName:'Test zapisu 2',
        ean:'5900000000028',
        loc:'TEST-A2',
        shipping:'Paczkomat A',
        condition:'Nowy',
        contents:'Produkt testowy',
        identified:true,
        confirm:true,
        status:'ready',
        photos:[]
      },
      {
        lpn:'TEST-SEED-003',
        productName:'Test zapisu 3',
        ean:'5900000000035',
        loc:'TEST-A3',
        shipping:'Paczkomat B',
        condition:'Nowy',
        contents:'Produkt testowy',
        identified:true,
        confirm:true,
        status:'ready',
        photos:[]
      }
    ];

    try {
      for (const product of fixtures) {
        if (window.ProductStorage) {
          window.ProductStorage.saveProduct(localStorage, KEYS.products, product, 500);
        } else {
          const products = getProducts();
          const key = String(product.lpn).toLowerCase();
          const i = products.findIndex(p => String(p.lpn || '').toLowerCase() === key);
          const record = {
            ...(i >= 0 ? products[i] : {}),
            ...product,
            id: i >= 0 ? products[i].id : (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()),
            savedAt:new Date().toISOString()
          };
          if (i >= 0) products.splice(i,1);
          products.unshift(record);
          localStorage.setItem(KEYS.products, JSON.stringify(products.slice(0,500)));
        }
      }

      localStorage.setItem(flag,'done');
      addHistory('Dodano produkty testowe','TEST-SEED-001, TEST-SEED-002, TEST-SEED-003');
      setTimeout(() => toast('Dodano 3 produkty testowe do listy Produkty.'), 300);
    } catch (e) {
      console.error('Seed products failed', e);
    }
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