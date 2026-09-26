(() => {
  let cfg = null;
  let latestCategoryMeta = null;
  let latestGpsr = null;
  let latestConfidence = null;

  const $ = id => document.getElementById(id);

  function setup(options) {
    cfg = options;
    window.lookup = lookup;
  }

  function requireConfig() {
    if (!cfg) throw new Error('Catalog lookup module is not configured');
    return cfg;
  }

  function safe(value='') {
    return requireConfig().safe(value);
  }

  function getState() {
    return {
      categoryMeta: latestCategoryMeta,
      gpsrData: latestGpsr,
      confidence: latestConfidence
    };
  }

  function selectedConditionId() {
    const option = $('condition')?.selectedOptions?.[0];
    return option?.dataset?.allegroId || '';
  }

  function eanRequirementState() {
    const gtin = latestCategoryMeta?.gtin;
    if (!gtin) return {required:false,pending:false,reason:'not-applicable'};
    if (gtin.requiredForProduct) return {required:true,pending:false,reason:'category'};

    const withValues = gtin.requiredIf?.parametersWithValue || [];
    if (!withValues.length) return {required:false,pending:false,reason:'optional'};

    const conditionId = String(latestCategoryMeta?.condition?.id || '');
    const selectedId = selectedConditionId();
    const conditionRules = withValues.filter(rule => String(rule.id || '') === conditionId);

    if (!conditionRules.length) return {required:false,pending:false,reason:'optional'};
    if (!selectedId) return {required:false,pending:true,reason:'condition'};

    const required = conditionRules.some(rule =>
      Array.isArray(rule.oneOfValueIds) &&
      rule.oneOfValueIds.map(String).includes(String(selectedId))
    );

    return {required,pending:false,reason:required ? 'condition' : 'optional'};
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
      select.innerHTML = '<option value="">Wybierz</option>' + values.map(value =>
        '<option value="'+safe(value.value)+'" data-allegro-id="'+safe(value.id)+'">'+safe(value.value)+'</option>'
      ).join('');

      if (oldValue && [...select.options].some(option => option.value === oldValue)) {
        select.value = oldValue;
      }
    }

    updateEanRequirementUi();
  }

  function formatGpsrAddress(address) {
    if (!address) return '';
    return [
      address.street,
      [address.postalCode,address.city].filter(Boolean).join(' '),
      address.countryCode
    ].filter(Boolean).join(', ');
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

    status.textContent = latestGpsr.status ||
      (latestGpsr.available ? 'Dane GPSR pobrane z Allegro' : 'Brak danych GPSR w katalogu Allegro');

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
    const number = Number(value);
    latestConfidence = Number.isFinite(number)
      ? Math.max(0,Math.min(100,Math.round(number)))
      : null;

    if ($('confidencePct')) {
      $('confidencePct').textContent = latestConfidence == null ? '—' : latestConfidence + '%';
    }
    if ($('confidenceBar')) {
      $('confidenceBar').style.width = (latestConfidence == null ? 0 : latestConfidence) + '%';
    }
    if ($('sumIdentification')) {
      $('sumIdentification').textContent =
        latestConfidence == null ? '—' : latestConfidence + '% • Allegro';
    }
  }

  function normalizeRemote(data) {
    if (!data) return null;
    return data.best || data.product || null;
  }

  function renderRemote(data) {
    const {toast,saveDraft,addHistory,setIdentified,quality} = requireConfig();
    const best = normalizeRemote(data);

    if (!best) {
      toast('Nie znaleziono jednoznacznego produktu.');
      return false;
    }

    setIdentified(true);

    const confidence = Number(data.confidence ?? 0);
    const conflicts = Array.isArray(data.hardConflicts) ? data.hardConflicts : [];

    const sourceCards = Object.entries(data.sources || {}).map(([key,value]) =>
      '<div class="source">'+
        '<b>'+safe(key[0].toUpperCase()+key.slice(1))+'</b>'+
        '<small>'+safe(value?.status || (value ? 'znaleziono' : 'brak'))+'</small>'+
        '<div style="margin-top:8px">'+safe(value?.name || '—')+'</div>'+
      '</div>'
    ).join('');

    const checks = Array.isArray(data.checks)
      ? data.checks.map(check =>
          '<div class="check">'+
            '<span>'+safe(check.label)+'</span>'+
            '<span>'+safe(check.value || '—')+'</span>'+
            '<span class="'+(check.status==='ok'?'ok':check.status==='warn'?'warn':'bad')+'">'+
              safe(check.text || check.status)+
            '</span>'+
          '</div>'
        ).join('')
      : '';

    $('lookup').style.display = 'block';
    $('lookup').innerHTML =
      '<div class="lookupTop">'+
        '<div><b>Wynik identyfikacji</b><div class="muted">Dane z podłączonych źródeł API.</div></div>'+
        '<div><span class="score">'+confidence+'%</span> <span class="badge '+(conflicts.length?'':'ok')+'">'+
          (conflicts.length?'konflikt':'wynik')+
        '</span></div>'+
      '</div>'+
      '<div class="sources">'+sourceCards+'</div>'+
      '<div style="margin-top:12px">'+checks+'</div>'+
      (conflicts.length
        ? '<div class="note" style="border-color:rgba(234,119,123,.3);color:#f0b2b4">Blokada: '+safe(conflicts.join(', '))+'</div>'
        : '');

    if ($('productName')) $('productName').value = best.name || '';
    if ($('brand')) $('brand').value = best.brand || '';
    if ($('model')) $('model').value = best.model || '';
    if ($('category')) $('category').value = data.categoryMeta?.categoryName || best.category || '';
    if ($('parameters') && best.parameters) {
      $('parameters').value = Array.isArray(best.parameters)
        ? best.parameters.map(parameter => (parameter.name || parameter.key)+': '+(parameter.value ?? '')).join('\n')
        : String(best.parameters);
    }
    if (best.asin && !$('asin').value) $('asin').value = best.asin;
    if (best.ean && !$('ean').value) $('ean').value = best.ean;

    applyCategoryMeta(data.categoryMeta || null);
    applyGpsr(data.gpsr || null);
    applyConfidence(confidence);
    quality();
    saveDraft();
    addHistory('Identyfikacja API', ($('lpn').value || '') + ' • ' + (best.name || ''));
    return true;
  }

  async function lookup() {
    const {keys,defaultApiBase,toast} = requireConfig();
    const base = (localStorage.getItem(keys.apiBase) || defaultApiBase).replace(/\/$/,'');

    if (!$('ean').value.trim() && !$('asin').value.trim()) {
      toast('Podaj EAN lub ASIN');
      return;
    }

    toast('Sprawdzam produkt…');
    const button = [...document.querySelectorAll('button')]
      .find(item => item.textContent.trim() === 'Sprawdź produkt');
    const oldText = button?.textContent;

    if (button) {
      button.disabled = true;
      button.textContent = 'Sprawdzam…';
    }

    try {
      const query = new URLSearchParams();
      if ($('ean').value.trim()) query.set('ean',$('ean').value.trim());
      if ($('asin').value.trim()) query.set('asin',$('asin').value.trim());

      const response = await fetch(base + '/api/search?' + query.toString());
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Błąd API');
      renderRemote(data);
    } catch (error) {
      toast('Błąd integracji: ' + (error.message || 'brak połączenia'));
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = oldText || 'Sprawdź produkt';
      }
    }
  }

  window.ProductIntakeCatalogLookup = {
    setup,
    getState,
    eanRequirementState,
    updateEanRequirementUi,
    applyCategoryMeta,
    applyGpsr,
    applyConfidence,
    renderRemote,
    lookup
  };
})();
