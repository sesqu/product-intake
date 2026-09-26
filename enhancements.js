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
  const CatalogLookup = window.ProductIntakeCatalogLookup;

  window.ProductIntakePWA?.setup({build:29,label:'v29'});


  const CloudProducts = window.ProductIntakeCloudProducts;
  CloudProducts?.setup({
    keys:KEYS,
    defaultApiBase:DEFAULT_API_BASE,
    getProducts,
    addHistory,
    toast
  });

  function getWorkspaceKey() {
    return CloudProducts.getWorkspaceKey();
  }
  function apiBase() {
    return CloudProducts.apiBase();
  }
  function cloudGetProduct(lpn) {
    return CloudProducts.cloudGetProduct(lpn);
  }
  function cloudSaveProduct(product) {
    return CloudProducts.cloudSaveProduct(product);
  }
  function syncProductsFromCloud(quiet = false) {
    return CloudProducts.syncProductsFromCloud(quiet);
  }
  function ensureVerifiedRealProductsLocal() {
    return CloudProducts.ensureVerifiedRealProductsLocal();
  }
  function pushVerifiedRealProductsToCloud() {
    return CloudProducts.pushVerifiedRealProductsToCloud();
  }
  function initializeCloudProducts() {
    return CloudProducts.initializeCloudProducts();
  }
  function seedRealCatalogProducts(force = false) {
    return CloudProducts.seedRealCatalogProducts(force);
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
    const catalogState = CatalogLookup.getState();
    out.categoryMeta = catalogState.categoryMeta;
    out.gpsrData = catalogState.gpsrData;
    out.confidence = catalogState.confidence;
    return out;
  }
  function writeDraft(d) {
    if (!d) return;

    CatalogLookup.applyCategoryMeta(d.categoryMeta || null, false);

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

    CatalogLookup.applyGpsr(d.gpsrData || null);
    CatalogLookup.applyConfidence(d.confidence);
    CatalogLookup.updateEanRequirementUi();
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

  function updateQualityPanel() {
    const identifiedOk = typeof identified !== 'undefined' && identified;
    const photoOk = photoData.filter(Boolean).length > 0;
    const eanState = CatalogLookup.updateEanRequirementUi();

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

    if (CatalogLookup.eanRequirementState().required) {
      req.push(['EAN / GTIN wymagany przez Allegro', $('ean')?.value.trim()]);
    }

    return req.filter(([,ok]) => !ok).map(([name]) => name);
  }

  function getProducts() {
    return window.ProductStorage.getProducts(localStorage, KEYS.products);
  }
  async function saveReadyProduct() {
    const missing = validateForReady();
    if (missing.length) {
      toast('Brakuje: ' + missing.slice(0,3).join(', ') + (missing.length > 3 ? '…' : ''));
      return false;
    }

    const d = readDraft();
    let result = window.ProductStorage.saveProduct(localStorage, KEYS.products, d, 500);

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

  const Modal = window.ProductIntakeModal;

  function closePiModal() {
    return Modal.close();
  }

  function openModal(title, html) {
    return Modal.open(title, html);
  }

  const ProductEditor = window.ProductIntakeProductEditor;

  function setupProductEditor() {
    ProductEditor?.setup({
      keys:KEYS,
      safe,
      getProducts,
      apiBase,
      cloudGetProduct,
      cloudSaveProduct,
      syncProductsFromCloud,
      ensureVerifiedRealProductsLocal,
      seedRealCatalogProducts,
      openModal,
      setMobileNavActive,
      addHistory,
      toast,
      compressImage
    });
  }

  function showProducts() {
    return ProductEditor.showProducts();
  }

  function openProductEditor(lpn) {
    return ProductEditor.openProductEditor(lpn);
  }

  const SecondaryViews = window.ProductIntakeSecondaryViews;

  function setupSecondaryViews() {
    SecondaryViews?.setup({
      keys:KEYS,
      defaultApiBase:DEFAULT_API_BASE,
      getProducts,
      getWorkspaceKey,
      syncProductsFromCloud,
      openModal,
      setActive:setMobileNavActive
    });
  }

  function showHistory() {
    return SecondaryViews.showHistory();
  }
  function showLocations() {
    return SecondaryViews.showLocations();
  }
  function showIntegrations() {
    return SecondaryViews.showIntegrations();
  }

  function setMobileNavActive(name) {
    window.ProductIntakeNavigation?.setActive(name);
  }

  function setupNavigation() {
    window.ProductIntakeNavigation?.setup({
      closeModal: closePiModal,
      showProducts,
      showIntegrations,
      showLocations,
      showHistory,
      openModal
    });
  }

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

  window.prev = function() {
    if (typeof step !== 'undefined' && step > 0) {
      step--;
      if (typeof render === 'function') render();
      saveDraft();
    }
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
        if (e.target.id === 'condition') CatalogLookup.updateEanRequirementUi();
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
    setupCatalogLookup();
    setupProductEditor();
    setupSecondaryViews();
    setupNavigation();
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