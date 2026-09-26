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

  window.ProductIntakePWA?.setup({build:28,label:'v28'});


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