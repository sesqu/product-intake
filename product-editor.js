(() => {
  let cfg = null;
  let KEYS = null;

  const $ = id => document.getElementById(id);

  function setup(options) {
    cfg = options;
    KEYS = options.keys;
  }

  function requireConfig() {
    if (!cfg) throw new Error('Product editor module is not configured');
    return cfg;
  }

  function safe(value='') {
    return requireConfig().safe(value);
  }

  function getProducts() {
    return requireConfig().getProducts();
  }

  function apiBase() {
    return requireConfig().apiBase();
  }

  function cloudGetProduct(lpn) {
    return requireConfig().cloudGetProduct(lpn);
  }

  function cloudSaveProduct(product) {
    return requireConfig().cloudSaveProduct(product);
  }

  function syncProductsFromCloud(quiet = false) {
    return requireConfig().syncProductsFromCloud(quiet);
  }

  function ensureVerifiedRealProductsLocal() {
    return requireConfig().ensureVerifiedRealProductsLocal();
  }

  function seedRealCatalogProducts(force = false) {
    return requireConfig().seedRealCatalogProducts(force);
  }

  function openModal(title, html) {
    return requireConfig().openModal(title, html);
  }

  function setMobileNavActive(name) {
    return requireConfig().setMobileNavActive(name);
  }

  function addHistory(action, details) {
    return requireConfig().addHistory(action, details);
  }

  function toast(message) {
    return requireConfig().toast(message);
  }

  function compressImage(file) {
    return requireConfig().compressImage(file);
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
      '<div class="pi-muted pi-small">Master produktów • '+products.length</div>'+
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



  window.ProductIntakeProductEditor = {
    setup,
    showProducts,
    openProductEditor
  };
})();
