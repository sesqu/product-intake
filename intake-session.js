(() => {
  let cfg = null;
  let photoData = [];

  const $ = id => document.getElementById(id);
  const fieldIds = [
    'lpn','ean','asin','productName','brand','model','category','parameters',
    'confirm','condition','serial','contents','flaws','loc','shipping','weight'
  ];

  function setup(options) {
    cfg = options;
  }

  function requireConfig() {
    if (!cfg) throw new Error('Intake session module is not configured');
    return cfg;
  }

  function catalog() {
    return requireConfig().catalogLookup;
  }

  function getProducts() {
    const {keys} = requireConfig();
    return window.ProductStorage.getProducts(localStorage, keys.products);
  }

  function readDraft() {
    const out = {};

    for (const id of fieldIds) {
      const element = $(id);
      if (!element) continue;
      out[id] = element.type === 'checkbox' ? element.checked : element.value;
    }

    out.photos = photoData;
    out.identified = typeof identified !== 'undefined' ? identified : false;
    out.step = typeof step !== 'undefined' ? step : 0;
    out.savedAt = new Date().toISOString();

    const catalogState = catalog().getState();
    out.categoryMeta = catalogState.categoryMeta;
    out.gpsrData = catalogState.gpsrData;
    out.confidence = catalogState.confidence;
    out.identification = catalogState.identification || null;
    out.conflictResolutions = catalogState.conflictResolutions || {};

    return out;
  }

  function writeDraft(draft) {
    if (!draft) return;

    catalog().applyCategoryMeta(draft.categoryMeta || null, false);

    for (const id of fieldIds) {
      const element = $(id);
      if (!element || draft[id] == null) continue;
      if (element.type === 'checkbox') element.checked = Boolean(draft[id]);
      else element.value = draft[id];
    }

    photoData = Array.isArray(draft.photos) ? draft.photos : [];

    if (typeof identified !== 'undefined') identified = Boolean(draft.identified);
    if (typeof step !== 'undefined' && Number.isInteger(draft.step)) {
      step = Math.max(0, Math.min(4, draft.step));
    }

    catalog().applyGpsr(draft.gpsrData || null);
    catalog().applyConfidence(draft.confidence);
    catalog().applyIdentificationState(
      draft.identification || null,
      draft.conflictResolutions || {}
    );
    catalog().updateEanRequirementUi();
    drawPhotos();

    if (typeof render === 'function') render();
    else updateQualityPanel();
  }

  function saveDraft() {
    const {keys} = requireConfig();
    try {
      localStorage.setItem(keys.draft, JSON.stringify(readDraft()));
    } catch {}
  }

  function loadDraft() {
    const {keys, toast} = requireConfig();

    try {
      const raw = localStorage.getItem(keys.draft);
      if (raw) {
        writeDraft(JSON.parse(raw));
        return;
      }

      const products = JSON.parse(localStorage.getItem(keys.products) || '[]');
      const latest = Array.isArray(products) ? products[0] : null;
      const skipRecoveryId = localStorage.getItem('productIntake.skipRecoveryId');
      const isRecent = latest?.savedAt &&
        (Date.now() - new Date(latest.savedAt).getTime() < 30 * 60 * 1000);

      if (latest && isRecent && latest.id !== skipRecoveryId) {
        const recovered = {...latest, step:4, identified:true};
        writeDraft(recovered);
        localStorage.setItem(keys.draft, JSON.stringify(recovered));
        setTimeout(() => toast('Przywrócono ostatnio zapisany produkt.'), 150);
      }
    } catch {}
  }

  function addHistory(action, details='') {
    const {keys} = requireConfig();
    let rows = [];

    try {
      const parsed = JSON.parse(localStorage.getItem(keys.history) || '[]');
      rows = Array.isArray(parsed) ? parsed : [];
    } catch {}

    rows.unshift({
      time:new Date().toISOString(),
      action,
      details
    });

    localStorage.setItem(keys.history, JSON.stringify(rows.slice(0,200)));
  }

  async function compressImage(file) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      const url = URL.createObjectURL(file);

      image.onload = () => {
        const max = 1000;
        let width = image.width;
        let height = image.height;

        if (Math.max(width,height) > max) {
          const scale = max / Math.max(width,height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(image,0,0,width,height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg',0.72));
      };

      image.onerror = error => {
        URL.revokeObjectURL(url);
        reject(error);
      };

      image.src = url;
    });
  }

  function setupPhotos() {
    const {toast} = requireConfig();

    document.querySelectorAll('.photo').forEach((box, index) => {
      box.style.cursor = 'pointer';
      box.dataset.idx = index;

      box.onclick = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.setAttribute('capture','environment');

        input.onchange = async () => {
          const file = input.files?.[0];
          if (!file) return;

          try {
            photoData[index] = await compressImage(file);
            drawPhotos();
            updateQualityPanel();
            saveDraft();
            addHistory('Dodano zdjęcie', $('lpn')?.value || 'wersja robocza');
          } catch {
            toast('Nie udało się dodać zdjęcia.');
          }
        };

        input.click();
      };
    });

    drawPhotos();
  }

  function drawPhotos() {
    document.querySelectorAll('.photo').forEach((box, index) => {
      const data = photoData[index];

      if (data) {
        box.innerHTML =
          '<img alt="Zdjęcie produktu" style="width:100%;height:100%;object-fit:cover;border-radius:9px">';
        box.querySelector('img').src = data;
      } else {
        box.innerHTML = '+<br>Dodaj zdjęcie';
      }
    });
  }

  function updateQualityPanel() {
    const identifiedOk = typeof identified !== 'undefined' && identified;
    const photoOk = photoData.filter(Boolean).length > 0;
    const eanState = catalog().updateEanRequirementUi();

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
      const element = $(id);
      if (!element) continue;
      element.textContent = ok ? 'OK' : 'brak';
      element.className = ok ? 'ok' : 'bad';
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
    if ($('sumStatus')) {
      $('sumStatus').textContent = pctValue === 100 ? 'Kompletne' : 'Wymaga uzupełnienia';
    }

    return pctValue;
  }

  function validateForReady() {
    const required = [
      ['LPN / SKU', $('lpn')?.value.trim()],
      ['identyfikacja produktu', typeof identified !== 'undefined' && identified],
      ['potwierdzenie testera', $('confirm')?.checked],
      ['stan', $('condition')?.value],
      ['zawartość zestawu', $('contents')?.value.trim()],
      ['co najmniej jedno zdjęcie', photoData.filter(Boolean).length > 0],
      ['lokalizacja', $('loc')?.value.trim()],
      ['dostawa / gabaryt', $('shipping')?.value]
    ];

    if (catalog().eanRequirementState().required) {
      required.push(['EAN / GTIN wymagany przez Allegro', $('ean')?.value.trim()]);
    }

    return required.filter(([,ok]) => !ok).map(([name]) => name);
  }

  async function saveReadyProduct() {
    const {
      keys,
      cloudSaveProduct,
      syncProductsFromCloud,
      toast
    } = requireConfig();

    const missing = validateForReady();
    if (missing.length) {
      toast(
        'Brakuje: ' +
        missing.slice(0,3).join(', ') +
        (missing.length > 3 ? '…' : '')
      );
      return false;
    }

    const draft = readDraft();
    let result = window.ProductStorage.saveProduct(
      localStorage,
      keys.products,
      draft,
      500
    );

    let cloudOk = false;

    try {
      const cloudResult = await cloudSaveProduct(result.record);
      cloudOk = true;
      result.record = cloudResult.record || result.record;
      await syncProductsFromCloud(true);
    } catch (error) {
      console.warn('Cloud product save failed', error);
    }

    addHistory(
      result.updated ? 'Produkt zaktualizowany' : 'Produkt gotowy',
      draft.lpn + (draft.productName ? ' • ' + draft.productName : '')
    );
    saveDraft();

    if (cloudOk) {
      toast(
        result.updated
          ? 'Produkt zaktualizowany i zsynchronizowany.'
          : 'Produkt zapisany i zsynchronizowany.'
      );
    } else {
      toast('Produkt zapisany lokalnie — synchronizacja chwilowo niedostępna.');
    }

    return true;
  }

  function showSaveSuccess() {
    const {
      keys,
      safe,
      openModal,
      showProducts
    } = requireConfig();

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

    const nextButton = $('successNextProduct');
    const productsButton = $('successProducts');

    if (nextButton) {
      nextButton.onclick = () => {
        const products = getProducts();
        if (products[0]?.id) {
          localStorage.setItem('productIntake.skipRecoveryId', products[0].id);
        }
        localStorage.removeItem(keys.draft);
        location.href = location.pathname;
      };
    }

    if (productsButton) productsButton.onclick = showProducts;
  }

  function setupFinalStep() {
    const foot = document.querySelector('.foot');
    if (!foot) return;

    const nextButton = [...foot.querySelectorAll('button')]
      .find(button => button.textContent.includes('Dalej'));

    if (!nextButton) return;

    const baseRender = window.render;
    window.render = function() {
      baseRender?.();
      nextButton.style.display =
        (typeof step !== 'undefined' && step === 4) ? 'none' : '';
    };

    window.render();
  }

  function next() {
    const {toast} = requireConfig();
    const confirmed = Boolean(document.querySelector('#confirm:checked'));

    if (
      typeof step !== 'undefined' &&
      step === 0 &&
      typeof identified !== 'undefined' &&
      !identified
    ) {
      toast('Najpierw sprawdź produkt');
      return;
    }

    if (typeof step !== 'undefined' && step === 1 && !confirmed) {
      toast('Tester musi potwierdzić identyfikację');
      return;
    }

    if (typeof step !== 'undefined' && step < 4) {
      step++;
      if (typeof render === 'function') render();
      saveDraft();
    }
  }

  function prev() {
    if (typeof step !== 'undefined' && step > 0) {
      step--;
      if (typeof render === 'function') render();
      saveDraft();
    }
  }

  async function finish() {
    const ok = await saveReadyProduct();
    if (!ok) return;
    showSaveSuccess();
  }

  function bindAutosave() {
    document.addEventListener('input', event => {
      if (!event.target.matches('input,select,textarea')) return;
      updateQualityPanel();
      saveDraft();
    });

    document.addEventListener('change', event => {
      if (!event.target.matches('input,select,textarea')) return;
      if (event.target.id === 'condition') catalog().updateEanRequirementUi();
      updateQualityPanel();
      saveDraft();
    });

    window.addEventListener('pagehide', saveDraft);
    window.addEventListener('beforeunload', saveDraft);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') saveDraft();
    });
  }

  function start() {
    window.quality = updateQualityPanel;
    window.next = next;
    window.prev = prev;
    window.finish = finish;

    setupPhotos();
    setupFinalStep();
    bindAutosave();
    loadDraft();
  }

  window.ProductIntakeSession = {
    setup,
    start,
    getProducts,
    saveDraft,
    addHistory,
    compressImage,
    updateQualityPanel
  };
})();
