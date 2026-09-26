(() => {
  let cfg = null;
  let latestCategoryMeta = null;
  let latestGpsr = null;
  let latestConfidence = null;
  let latestIdentification = null;
  let latestConflictResolutions = {};

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
      confidence: latestConfidence,
      identification: latestIdentification,
      conflictResolutions: {...latestConflictResolutions}
    };
  }

  function applyIdentificationState(identification, resolutions = {}) {
    latestIdentification = identification && typeof identification === 'object'
      ? identification
      : null;
    latestConflictResolutions =
      resolutions && typeof resolutions === 'object'
        ? {...resolutions}
        : {};
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

  function parameterValue(product, names) {
    const wanted = names.map(value => String(value).toLowerCase());
    for (const parameter of product?.parameters || []) {
      const name = String(parameter?.name || '').toLowerCase();
      if (!wanted.some(item => name === item || name.includes(item))) continue;
      const value = String(parameter?.value ?? '').trim();
      if (value) return value;
    }
    return '';
  }

  function candidateFacts(candidate) {
    const facts = [
      candidate?.brand,
      candidate?.model,
      parameterValue(candidate, ['pojemność','storage','capacity']),
      parameterValue(candidate, ['wariant','wersja','variant','version'])
    ].filter(Boolean);
    return [...new Set(facts.map(String))];
  }

  function identificationSnapshot(data) {
    return {
      confidenceMethod:data?.confidenceMethod || '',
      completeness:Number(data?.completeness ?? 0),
      selectedBy:data?.selectedBy || '',
      selectedCandidateId:data?.best?.id || '',
      requiresTesterChoice:Boolean(data?.requiresTesterChoice),
      conflicts:Array.isArray(data?.conflicts) ? data.conflicts : [],
      hardConflicts:Array.isArray(data?.hardConflictDetails)
        ? data.hardConflictDetails
        : []
    };
  }

  function renderConflictSummary(data) {
    const conflicts = Array.isArray(data?.conflicts) ? data.conflicts : [];
    if (!conflicts.length) return '';

    return '<div class="pi-conflict-list">'+conflicts.map(conflict =>
      '<div class="pi-conflict-item '+(conflict.severity === 'critical' ? 'critical' : '')+'">'+
        '<div><b>'+safe(conflict.label || conflict.key || 'Konflikt')+'</b>'+
        '<div class="muted">'+safe(conflict.message || '')+'</div></div>'+
        (Array.isArray(conflict.values) && conflict.values.length
          ? '<div class="pi-conflict-values">'+conflict.values.map(value =>
              '<span>'+safe(value)+'</span>'
            ).join('')+'</div>'
          : '')+
      '</div>'
    ).join('')+'</div>';
  }

  function renderCandidateChoice(data) {
    const {setIdentified} = requireConfig();
    setIdentified(false);
    latestIdentification = identificationSnapshot(data);
    latestConflictResolutions = {};
    applyConfidence(data.confidence);

    const candidates = Array.isArray(data.candidates)
      ? data.candidates
      : [];

    const cards = candidates.map(candidate => {
      const facts = candidateFacts(candidate);
      return '<button type="button" class="pi-candidate" data-candidate-id="'+safe(candidate.id || '')+'">'+
        '<span class="pi-candidate-title">'+safe(candidate.name || 'Bez nazwy')+'</span>'+
        '<span class="pi-candidate-meta">'+safe(facts.join(' • ') || 'Brak danych wariantu')+'</span>'+
        '<span class="pi-candidate-action">Wybierz ten produkt</span>'+
      '</button>';
    }).join('');

    $('lookup').style.display = 'block';
    $('lookup').innerHTML =
      '<div class="lookupTop">'+
        '<div><b>Wymagany wybór testera</b>'+
          '<div class="muted">Allegro zwróciło konkurencyjne warianty dla tego samego wyszukiwania.</div>'+
        '</div>'+
        '<div><span class="score">'+Number(data.confidence ?? 0)+'%</span> <span class="badge warn">wybierz</span></div>'+
      '</div>'+
      renderConflictSummary(data)+
      '<div class="pi-candidates">'+cards+'</div>'+
      '<div class="note">Nie wpisaliśmy jeszcze danych do produktu. Porównaj propozycje z fizyczną sztuką i wybierz właściwą.</div>';

    $('lookup').querySelectorAll('[data-candidate-id]').forEach(button => {
      button.onclick = () => chooseCandidate(button.dataset.candidateId);
    });

    return false;
  }

  function unresolvedHardConflicts(data) {
    const hard = Array.isArray(data?.hardConflictDetails)
      ? data.hardConflictDetails
      : [];
    return hard.filter(conflict => !latestConflictResolutions[conflict.key]);
  }

  function renderHardConflictActions(data) {
    const hard = Array.isArray(data?.hardConflictDetails)
      ? data.hardConflictDetails
      : [];
    if (!hard.length) return '';

    return '<div class="pi-resolution-list">'+hard.map(conflict => {
      const resolution = latestConflictResolutions[conflict.key];
      const expected = conflict.expected ?? '';
      const actual = conflict.actual ?? '';

      return '<div class="pi-resolution" data-conflict-key="'+safe(conflict.key)+'">'+
        '<div class="pi-resolution-title">'+
          '<b>'+safe(conflict.label || conflict.key)+'</b>'+
          '<span class="'+(resolution ? 'ok' : 'bad')+'">'+
            (resolution ? 'rozstrzygnięto' : 'wymaga decyzji')+
          '</span>'+
        '</div>'+
        '<div class="muted">'+safe(conflict.message || '')+'</div>'+
        '<div class="pi-resolution-actions">'+
          '<button type="button" class="btn '+(resolution?.choice === 'query' ? 'primary' : '')+'" data-resolution-choice="query" data-conflict-key="'+safe(conflict.key)+'">'+
            'Zostaw zeskanowane: '+safe(expected || '—')+
          '</button>'+
          '<button type="button" class="btn '+(resolution?.choice === 'catalog' ? 'primary' : '')+'" data-resolution-choice="catalog" data-conflict-key="'+safe(conflict.key)+'">'+
            'Użyj Allegro: '+safe(actual || '—')+
          '</button>'+
        '</div>'+
      '</div>';
    }).join('')+'</div>';
  }

  function applyConflictResolution(conflict, choice, data) {
    const {setIdentified,saveDraft,addHistory,quality} = requireConfig();
    const value = choice === 'catalog'
      ? String(conflict.actual ?? '')
      : String(conflict.expected ?? '');

    latestConflictResolutions[conflict.key] = {
      choice,
      value,
      resolvedAt:new Date().toISOString()
    };

    if (conflict.key === 'ean' && $('ean')) {
      $('ean').value = value;
    }

    latestIdentification = {
      ...identificationSnapshot(data),
      conflictResolutions:{...latestConflictResolutions}
    };

    const unresolved = unresolvedHardConflicts(data);
    setIdentified(unresolved.length === 0);

    renderResolvedResult(data);
    quality();
    saveDraft();
    addHistory(
      'Rozstrzygnięto konflikt',
      (conflict.label || conflict.key) + ' • ' +
      (choice === 'catalog' ? 'Allegro' : 'wartość zeskanowana')
    );
  }

  function bindResolutionActions(data) {
    const details = Array.isArray(data?.hardConflictDetails)
      ? data.hardConflictDetails
      : [];

    $('lookup')?.querySelectorAll('[data-resolution-choice]').forEach(button => {
      button.onclick = () => {
        const conflict = details.find(item =>
          String(item.key) === String(button.dataset.conflictKey)
        );
        if (!conflict) return;
        applyConflictResolution(
          conflict,
          button.dataset.resolutionChoice,
          data
        );
      };
    });
  }

  function populateMaster(best, data) {
    if ($('productName')) $('productName').value = best.name || '';
    if ($('brand')) $('brand').value = best.brand || '';
    if ($('model')) $('model').value = best.model || '';
    if ($('category')) {
      $('category').value =
        data.categoryMeta?.categoryName ||
        best.category ||
        '';
    }

    if ($('parameters') && best.parameters) {
      $('parameters').value = Array.isArray(best.parameters)
        ? best.parameters.map(parameter =>
            (parameter.name || parameter.key)+': '+(parameter.value ?? '')
          ).join('\n')
        : String(best.parameters);
    }

    if (best.asin && !$('asin').value) $('asin').value = best.asin;
    if (best.ean && !$('ean').value) $('ean').value = best.ean;

    applyCategoryMeta(data.categoryMeta || null);
    applyGpsr(data.gpsr || null);
    applyConfidence(data.confidence);
  }

  function renderResolvedResult(data) {
    const best = normalizeRemote(data);
    if (!best) return false;

    const hard = Array.isArray(data?.hardConflictDetails)
      ? data.hardConflictDetails
      : [];
    const unresolved = unresolvedHardConflicts(data);
    const wasTesterChoice = data.selectedBy === 'tester';

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
        '<div><b>Wynik identyfikacji</b>'+
          '<div class="muted">'+
            (wasTesterChoice
              ? 'Wariant wybrany ręcznie przez testera.'
              : 'Dane z podłączonych źródeł API.')+
          '</div>'+
        '</div>'+
        '<div><span class="score">'+Number(data.confidence ?? 0)+'%</span> '+
          '<span class="badge '+(unresolved.length ? '' : 'ok')+'">'+
            (unresolved.length ? 'konflikt' : (wasTesterChoice ? 'wybrano' : 'wynik'))+
          '</span>'+
        '</div>'+
      '</div>'+
      (data.completeness != null
        ? '<div class="pi-confidence-meta">Kompletność danych katalogowych: '+safe(data.completeness)+'% • wynik identyfikacji nie jest prawdopodobieństwem</div>'
        : '')+
      '<div class="sources">'+sourceCards+'</div>'+
      '<div style="margin-top:12px">'+checks+'</div>'+
      (wasTesterChoice ? renderConflictSummary(data) : '')+
      (hard.length ? renderHardConflictActions(data) : '');

    bindResolutionActions(data);
    return true;
  }

  function renderRemote(data) {
    const {toast,saveDraft,addHistory,setIdentified,quality} = requireConfig();
    const best = normalizeRemote(data);

    if (!best) {
      setIdentified(false);
      toast('Nie znaleziono jednoznacznego produktu.');
      return false;
    }

    if (data.requiresTesterChoice) {
      return renderCandidateChoice(data);
    }

    latestIdentification = identificationSnapshot(data);
    latestConflictResolutions = {};
    populateMaster(best,data);

    const unresolved = unresolvedHardConflicts(data);
    setIdentified(unresolved.length === 0);

    renderResolvedResult(data);
    quality();
    saveDraft();

    addHistory(
      data.selectedBy === 'tester'
        ? 'Tester wybrał produkt z katalogu'
        : 'Identyfikacja API',
      ($('lpn').value || '') + ' • ' + (best.name || '')
    );

    return unresolved.length === 0;
  }

  async function fetchLookup(candidateId='') {
    const {keys,defaultApiBase} = requireConfig();
    const base = (
      localStorage.getItem(keys.apiBase) ||
      defaultApiBase
    ).replace(/\/$/,'');

    const query = new URLSearchParams();
    if ($('ean').value.trim()) query.set('ean',$('ean').value.trim());
    if ($('asin').value.trim()) query.set('asin',$('asin').value.trim());
    if (candidateId) query.set('candidateId',candidateId);

    const response = await fetch(
      base + '/api/search?' + query.toString()
    );
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Błąd API');
    }

    return data;
  }

  async function chooseCandidate(candidateId) {
    const {toast} = requireConfig();
    if (!candidateId) return;

    const buttons = $('lookup')?.querySelectorAll('[data-candidate-id]') || [];
    buttons.forEach(button => {
      button.disabled = true;
      if (button.dataset.candidateId === candidateId) {
        const action = button.querySelector('.pi-candidate-action');
        if (action) action.textContent = 'Wybieram…';
      }
    });

    try {
      const data = await fetchLookup(candidateId);
      renderRemote(data);
    } catch (error) {
      toast('Nie udało się wybrać produktu: ' + (error.message || 'błąd'));
      buttons.forEach(button => {
        button.disabled = false;
        const action = button.querySelector('.pi-candidate-action');
        if (action) action.textContent = 'Wybierz ten produkt';
      });
    }
  }

  async function lookup() {
    const {toast} = requireConfig();

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
      latestConflictResolutions = {};
      const data = await fetchLookup();
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
    applyIdentificationState,
    eanRequirementState,
    updateEanRequirementUi,
    applyCategoryMeta,
    applyGpsr,
    applyConfidence,
    renderRemote,
    lookup
  };
})();
