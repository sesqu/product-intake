(() => {
  let cfg = null;
  const $ = id => document.getElementById(id);

  function setup(options) {
    cfg = options;
  }

  function requireConfig() {
    if (!cfg) throw new Error('Product research module is not configured');
    return cfg;
  }

  function inputValue(id) {
    return $(id)?.value?.trim() || '';
  }

  function currentInput() {
    return {
      brand:inputValue('researchBrand'),
      manufacturer:inputValue('researchBrand'),
      model:inputValue('researchModel'),
      mpn:inputValue('researchMpn'),
      details:inputValue('researchDetails')
    };
  }

  function renderFacts(result) {
    const safe = requireConfig().safe;
    const facts = result?.description?.facts || [];
    if (!facts.length) return '<div class="muted">Brak dodatkowych parametrów.</div>';

    return '<div style="display:grid;gap:7px">'+facts.map(item =>
      '<div style="display:grid;grid-template-columns:minmax(120px,.8fr) minmax(0,1.4fr) auto;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid #252c35">'+
        '<span class="muted">'+safe(item.name)+'</span>'+
        '<b>'+safe(item.value)+'</b>'+
        '<span class="'+(item.isTrusted ? 'ok' : 'muted')+'" style="font-size:11px">'+
          (item.isTrusted ? 'trusted' : 'katalog')+
        '</span>'+
      '</div>'
    ).join('')+'</div>';
  }

  function renderCandidates(result, input) {
    const safe = requireConfig().safe;
    const candidates = Array.isArray(result?.candidates) ? result.candidates : [];
    if (candidates.length < 2) return '';

    return '<div style="margin-top:14px">'+
      '<b>Kandydaci</b>'+
      '<div class="muted" style="margin-top:4px">Jeżeli wynik nie pasuje do tabliczki, wybierz właściwy produkt.</div>'+
      '<div style="display:grid;gap:8px;margin-top:10px">'+candidates.map(candidate =>
        '<button type="button" class="btn researchCandidate" data-id="'+safe(candidate.id)+'" style="text-align:left">'+
          '<b>'+safe(candidate.name || 'Bez nazwy')+'</b>'+
          '<div class="muted" style="margin-top:4px">'+
            safe([candidate.brand || candidate.manufacturer,candidate.model,candidate.mpn].filter(Boolean).join(' • ') || 'Brak danych modelu')+
            ' • '+safe(candidate.score)+'%'+
          '</div>'+
        '</button>'
      ).join('')+'</div>'+
    '</div>';
  }

  function renderResult(result, input) {
    const safe = requireConfig().safe;
    const box = $('researchResult');
    if (!box) return;

    const selected = result?.best;
    if (!selected) {
      box.innerHTML = '<div class="note">Nie znaleziono pasującego produktu. Spróbuj podać dokładniejszy model albo kod / MPN.</div>';
      return;
    }

    const description = result.description || {};
    const warnings = Array.isArray(result.warnings) ? result.warnings : [];
    const draft = Boolean(description.draft);

    box.innerHTML =
      '<div class="lookupTop">'+
        '<div><b>'+safe(selected.name || 'Znaleziony produkt')+'</b>'+
          '<div class="muted">'+safe([selected.brand || selected.manufacturer,selected.model,selected.mpn].filter(Boolean).join(' • '))+'</div>'+
        '</div>'+
        '<div><span class="score">'+safe(result.confidence ?? 0)+'%</span> '+
          '<span class="badge '+(draft ? 'warn' : 'ok')+'">'+(draft ? 'wersja robocza' : 'wynik')+'</span></div>'+
      '</div>'+
      (warnings.length
        ? '<div class="note" style="margin-top:12px">'+warnings.map(item => '⚠ '+safe(item.message)).join('<br>')+'</div>'
        : '')+
      renderCandidates(result,input)+
      '<div style="margin-top:16px"><label>Tytuł</label><textarea id="researchTitle" style="min-height:62px">'+safe(description.title || '')+'</textarea></div>'+
      '<div style="margin-top:12px"><label>Krótki opis</label><textarea id="researchShort" style="min-height:95px">'+safe(description.shortDescription || '')+'</textarea></div>'+
      '<div style="margin-top:12px"><label>Pełny opis</label><textarea id="researchFull" style="min-height:260px">'+safe(description.fullDescription || '')+'</textarea></div>'+
      '<div style="margin-top:14px"><b>Fakty użyte do opisu</b><div class="muted" style="margin:4px 0 8px">Trusted = wartość oznaczona przez Allegro jako zaufana. Pozostałe są zwykłymi danymi katalogowymi.</div>'+renderFacts(result)+'</div>'+
      '<div style="margin-top:14px"><button id="copyResearchDescription" class="btn primary">Kopiuj pełny opis</button></div>';

    box.querySelectorAll('.researchCandidate').forEach(button => {
      button.onclick = () => runSearch(button.dataset.id);
    });

    $('copyResearchDescription').onclick = async () => {
      const value = $('researchFull')?.value || '';
      try {
        await navigator.clipboard.writeText(value);
        requireConfig().toast('Opis skopiowany.');
      } catch {
        $('researchFull')?.select();
        requireConfig().toast('Zaznaczyłem opis — skopiuj go ręcznie.');
      }
    };
  }

  async function runSearch(candidateId = '') {
    const {apiBase, toast} = requireConfig();
    const input = currentInput();
    const resultBox = $('researchResult');

    if (!input.mpn && !input.model) {
      toast('Podaj przynajmniej model albo kod / MPN. Marka / producent jest opcjonalna.');
      return;
    }

    resultBox.innerHTML = '<div class="muted">Szukam w katalogu Allegro i składam fakty…</div>';

    try {
      const response = await fetch(apiBase().replace(/\/$/,'') + '/api/research', {
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({...input,candidateId})
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Błąd wyszukiwania');

      renderResult(data,input);
    } catch (error) {
      resultBox.innerHTML = '<div class="note">Błąd: '+requireConfig().safe(error.message || 'nie udało się wyszukać produktu')+'</div>';
    }
  }

  function show(prefill = {}) {
    const {openModal,setActive} = requireConfig();
    setActive?.('research');

    openModal(
      'Kreator opisu',
      '<div>'+
        '<div class="muted">Wystarczy sam model. Marka / producent i kod / MPN są opcjonalne i zwiększają pewność dopasowania.</div>'+
        '<div class="grid" style="margin-top:16px">'+
          '<div><label>Marka / producent</label><input id="researchBrand" placeholder="np. Bosch"></div>'+
          '<div><label>Model</label><input id="researchModel" placeholder="np. GSR 18V-55"></div>'+
          '<div><label>Kod / MPN / numer katalogowy</label><input id="researchMpn" placeholder="np. 06019H5200"></div>'+
          '<div><label>Dodatkowa informacja</label><input id="researchDetails" placeholder="np. 18 V, 55 Nm"></div>'+
        '</div>'+
        '<div style="margin-top:14px"><button id="runProductResearch" class="btn primary">Szukaj i zbuduj opis</button></div>'+
        '<div id="researchResult" class="lookup" style="display:block;margin-top:16px"><div class="muted">Wynik pojawi się tutaj.</div></div>'+
      '</div>'
    );

    if ($('researchBrand')) $('researchBrand').value = prefill.brand || prefill.manufacturer || '';
    if ($('researchModel')) $('researchModel').value = prefill.model || '';
    if ($('researchMpn')) $('researchMpn').value = prefill.mpn || '';
    if ($('researchDetails')) $('researchDetails').value = prefill.details || '';

    $('runProductResearch').onclick = () => runSearch('');

    if (prefill.autoRun && (prefill.model || prefill.mpn)) {
      runSearch(prefill.candidateId || '');
    }
  }

  window.ProductIntakeProductResearch = {setup,show};
})();
