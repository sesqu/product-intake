(() => {
  let cfg = null;
  let state = {
    input:null,
    kind:'',
    result:null,
    fromCache:false
  };

  const CACHE_KEY = 'productIntake.finderCache.allegro-v44';
  const CACHE_TTL = 24 * 60 * 60 * 1000;
  const $ = id => document.getElementById(id);

  function setup(options) {
    cfg = options;
    bind();
  }

  function requireConfig() {
    if (!cfg) throw new Error('Product finder module is not configured');
    return cfg;
  }

  function clean(value='') {
    return String(value ?? '').trim();
  }

  function norm(value='') {
    return clean(value)
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\p{L}\p{N}]+/gu,' ')
      .trim();
  }

  function detectKind(query) {
    const value = clean(query).replace(/\s+/g,'');
    if (/^\d{8,14}$/.test(value)) return 'ean';
    return 'research';
  }

  function currentInput() {
    return {
      query:clean($('productFinderQuery')?.value),
      brand:clean($('productFinderBrand')?.value),
      manufacturer:clean($('productFinderBrand')?.value),
      mpn:clean($('productFinderMpn')?.value),
      details:clean($('productFinderDetails')?.value)
    };
  }

  function cacheKey(input) {
    return [
      norm(input.query),
      norm(input.brand),
      norm(input.mpn),
      norm(input.details)
    ].join('|');
  }

  function readCache(input) {
    try {
      const all = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
      const hit = all[cacheKey(input)];
      if (!hit || Date.now() - Number(hit.savedAt || 0) > CACHE_TTL) return null;
      return hit.data || null;
    } catch {
      return null;
    }
  }

  function writeCache(input,data) {
    try {
      const all = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
      const now = Date.now();
      for (const [key,value] of Object.entries(all)) {
        if (now - Number(value?.savedAt || 0) > CACHE_TTL) delete all[key];
      }
      all[cacheKey(input)] = {savedAt:now,data};
      const keys = Object.keys(all);
      if (keys.length > 30) {
        keys
          .sort((a,b) => Number(all[a]?.savedAt || 0) - Number(all[b]?.savedAt || 0))
          .slice(0,keys.length - 30)
          .forEach(key => delete all[key]);
      }
      localStorage.setItem(CACHE_KEY,JSON.stringify(all));
    } catch {}
  }

  function scoreOf(candidate,result,index) {
    const raw =
      candidate?.score ??
      candidate?.confidence ??
      (index === 0 ? result?.confidence : null);
    const value = Number(raw);
    return Number.isFinite(value) ? Math.max(0,Math.min(100,Math.round(value))) : null;
  }

  function qualityLabel(score) {
    if (score == null) return {text:'kandydat',className:''};
    if (score >= 85) return {text:'mocne dopasowanie',className:'ok'};
    if (score >= 60) return {text:'sprawdź',className:'warn'};
    return {text:'słabe dopasowanie',className:'warn'};
  }

  function candidateEvidence(candidate,result,index) {
    if (Array.isArray(candidate?.evidence) && candidate.evidence.length) {
      return candidate.evidence;
    }
    if (index === 0 && Array.isArray(result?.confidenceEvidence)) {
      return result.confidenceEvidence;
    }
    return [];
  }

  function evidenceHtml(candidate,result,index) {
    const safe = requireConfig().safe;
    const evidence = candidateEvidence(candidate,result,index);
    if (!evidence.length) return '';

    return '<div style="display:grid;gap:5px;margin-top:10px">'+evidence.slice(0,6).map(item => {
      const points = Number(item?.points || 0);
      const trusted = item?.trusted === true;
      return '<div style="display:flex;justify-content:space-between;gap:10px;font-size:11px">'+
        '<span class="muted">'+safe(item?.label || item?.field || 'Dopasowanie')+
          (item?.value ? ': '+safe(item.value) : '')+
          (trusted ? ' • trusted' : '')+
        '</span>'+
        '<b class="'+(points >= 0 ? 'ok' : 'bad')+'">'+
          (points > 0 ? '+' : '')+safe(points)+' pkt'+
        '</b>'+
      '</div>';
    }).join('')+'</div>';
  }

  function variantHint(candidate,primary) {
    if (!candidate || !primary || candidate.id === primary.id) return '';
    const sameModel = norm(candidate.model) && norm(candidate.model) === norm(primary.model);
    const differentMpn =
      norm(candidate.mpn) &&
      norm(primary.mpn) &&
      norm(candidate.mpn) !== norm(primary.mpn);
    const differentName =
      norm(candidate.name) &&
      norm(primary.name) &&
      norm(candidate.name) !== norm(primary.name);

    return sameModel && (differentMpn || differentName)
      ? 'Możliwy wariant / zestaw — porównaj z fizyczną sztuką.'
      : '';
  }

  function candidatesOf(result) {
    const list = Array.isArray(result?.candidates) ? result.candidates.filter(Boolean) : [];
    const best = result?.best || null;
    if (best && !list.some(item => String(item.id) === String(best.id))) {
      list.unshift(best);
    }
    return list.slice(0,12);
  }

  function renderCandidate(candidate,result,index) {
    const safe = requireConfig().safe;
    const score = scoreOf(candidate,result,index);
    const quality = qualityLabel(score);
    const primary = result?.best || candidatesOf(result)[0] || null;
    const variant = variantHint(candidate,primary);
    const warnings = Array.isArray(candidate?.warnings)
      ? candidate.warnings
      : index === 0 && Array.isArray(result?.warnings)
        ? result.warnings
        : [];

    return '<div class="pi-finder-card" data-finder-candidate="'+safe(candidate.id || '')+'">'+
      '<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">'+
        '<div style="min-width:0">'+
          '<b style="display:block">'+safe(candidate.name || 'Bez nazwy')+'</b>'+
          '<div class="muted" style="font-size:12px;margin-top:4px">'+
            safe([
              candidate.brand || candidate.manufacturer,
              candidate.model,
              candidate.mpn
            ].filter(Boolean).join(' • ') || 'Brak danych modelu')+
          '</div>'+
        '</div>'+
        '<div style="text-align:right;flex:none">'+
          (score == null ? '' : '<div class="score">'+safe(score)+'%</div>')+
          '<span class="badge '+quality.className+'">'+quality.text+'</span>'+
        '</div>'+
      '</div>'+
      (variant ? '<div class="note" style="margin-top:9px">'+safe(variant)+'</div>' : '')+
      (warnings.length
        ? '<div style="margin-top:8px;font-size:11px" class="warn">'+
            warnings.slice(0,3).map(item => '⚠ '+safe(item.message || item)).join('<br>')+
          '</div>'
        : '')+
      evidenceHtml(candidate,result,index)+
      '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px">'+
        '<button type="button" class="btn primary" data-finder-use="'+safe(candidate.id || '')+'">Użyj tego produktu</button>'+
        '<button type="button" class="btn" data-finder-description="'+safe(candidate.id || '')+'">Zbuduj opis</button>'+
      '</div>'+
    '</div>';
  }

  function researchTraceHtml(result) {
    const attempts=Array.isArray(result?.searchAttempts)
      ? result.searchAttempts.slice(0,3):[];
    if(!attempts.length) return '';
    const safe=requireConfig().safe;
    const first=result?.bestFoundBy;
    const foundVia=first
      ? (first.mode==='MPN'?'MPN':'fraza')+
        (first.reason?.endsWith('-page')?' (kolejna strona)':'')
      : 'nieustalone';
    const rows=attempts.map((x,i)=>
      '<div style="padding:6px 0;border-top:1px solid #303947">'+
        '<b>'+safe(i+1)+'. '+(x.mode==='MPN'?'MPN':'fraza')+
          (x.page>1?' · strona '+safe(x.page):'')+'</b> '+
        safe(x.phrase || '')+
        '<div class="muted" style="font-size:11px">Wyniki: '+
          safe(x.foundCount??'?')+' · nowe: '+safe(x.uniqueAdded??'?')+'</div>'+
        (x.error?'<div class="warn">'+safe(x.error)+'</div>':'')+
      '</div>'
    ).join('');
    const cmp=result?.comparison;
    const comparison=cmp
      ? '<div class="muted" style="font-size:12px;margin:6px 0">'+
          'Najlepszy z frazy: '+safe(cmp.phrase?.best?.name||'brak')+
          ' · z MPN: '+safe(cmp.mpn?.best?.name||'brak')+
        '</div>'
      : '';
    return '<details class="note" style="margin:10px 0">'+
      '<summary style="cursor:pointer">Jak Allegro wyszukało produkty ('+safe(attempts.length)+' zapytania)</summary>'+
      '<div class="muted" style="font-size:12px;margin-top:7px">Źródło TOP 1: '+safe(foundVia)+
      '. Dopasowanie nadal wymaga sprawdzenia fizycznego produktu.</div>'+
      comparison+rows+'</details>';
  }

  function renderResult(result,{fromCache=false}={}) {
    const safe = requireConfig().safe;
    const box = $('productFinderResult');
    if (!box) return;

    const candidates = candidatesOf(result);
    if (!candidates.length) {
      box.style.display = 'block';
      box.innerHTML =
        '<div class="note">Nie znaleziono produktu. Dopisz markę / producenta, MPN albo dodatkową informację i spróbuj ponownie.</div>'+
        researchTraceHtml(result);
      return;
    }

    const mode =
      state.kind === 'ean'
        ? 'EAN / GTIN'
        : 'model / MPN / fraza';
    const used = Array.isArray(result?.queriesUsed) && result.queriesUsed.length
      ? '<div class="muted" style="font-size:11px;margin-top:5px">Próby: '+safe(result.queriesUsed.join(' → '))+'</div>'
      : '';

    box.style.display = 'block';
    box.innerHTML =
      '<div class="lookupTop">'+
        '<div><b>Znalezione produkty</b>'+
          '<div class="muted">Tryb: '+safe(mode)+' • nic nie wpisujemy do mastera bez Twojego wyboru.</div>'+
          used+
          researchTraceHtml(result)+
        '</div>'+
        '<div>'+
          (fromCache ? '<span class="badge">pamięć 24h</span> ' : '')+
          '<button id="productFinderRefresh" type="button" class="btn">Odśwież</button>'+
        '</div>'+
      '</div>'+
      (result?.ambiguity?.noConfidentProduct
        ? '<div class="note" style="margin-top:10px">Nie znaleziono jeszcze wiarygodnego urządzenia głównego. Najlepsze wyniki mogą być częściami lub akcesoriami. Sprawdź kolejne propozycje i doprecyzuj model.</div>'
        : result?.requiresTesterChoice
          ? '<div class="note" style="margin-top:10px">Wyniki są niejednoznaczne. Porównaj model, MPN i wariant.</div>'
          : '')+
      '<div style="display:grid;gap:10px;margin-top:12px">'+
        candidates.slice(0,5).map((candidate,index) => renderCandidate(candidate,result,index)).join('')+
      '</div>'+
      (candidates.length>5
        ? '<button class="btn" type="button" id="productFinderMoreCandidates" style="margin-top:10px">'+
            'Pokaż pozostałe propozycje ('+safe(candidates.length-5)+')</button>'+
          '<div id="productFinderExtraCandidates" style="display:none;gap:10px;margin-top:12px">'+
            candidates.slice(5).map((candidate,index)=>renderCandidate(candidate,result,index+5)).join('')+
          '</div>'
        :'');

    $('productFinderRefresh').onclick = () => runSearch({force:true});
    const more=$('productFinderMoreCandidates');
    const extra=$('productFinderExtraCandidates');
    if(more && extra) more.onclick=()=>{
      const show=extra.style.display==='none';
      extra.style.display=show?'grid':'none';
      more.textContent=show
        ? 'Ukryj pozostałe propozycje'
        : 'Pokaż pozostałe propozycje ('+(candidates.length-5)+')';
    };

    box.querySelectorAll('[data-finder-use]').forEach(button => {
      button.onclick = () => useCandidate(button.dataset.finderUse);
    });
    box.querySelectorAll('[data-finder-description]').forEach(button => {
      button.onclick = () => buildDescription(button.dataset.finderDescription);
    });
  }

  async function fetchEan(input,candidateId='') {
    const {apiBase} = requireConfig();
    const params = new URLSearchParams({
      ean:input.query.replace(/\s+/g,''),
      source:'allegro'
    });
    if (candidateId) params.set('candidateId',candidateId);

    const response = await fetch(apiBase().replace(/\/$/,'') + '/api/search?' + params.toString());
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Błąd wyszukiwania EAN');
    return data;
  }

  async function fetchResearch(input,candidateId='') {
    const {apiBase} = requireConfig();
    const response = await fetch(apiBase().replace(/\/$/,'') + '/api/research', {
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({...input,candidateId})
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Błąd wyszukiwania produktu');
    return data;
  }

  async function fetchRemote(input,candidateId='') {
    return detectKind(input.query) === 'ean'
      ? fetchEan(input,candidateId)
      : fetchResearch(input,candidateId);
  }

  async function runSearch({force=false}={}) {
    const {toast} = requireConfig();
    const input = currentInput();

    if (!input.query) {
      toast('Wpisz EAN, model, MPN albo nazwę identyfikującą produkt.');
      $('productFinderQuery')?.focus();
      return;
    }

    state.input = input;
    state.kind = detectKind(input.query);
    const box = $('productFinderResult');
    if (box) {
      box.style.display = 'block';
      box.innerHTML = '<div class="muted">Szukam kandydatów i porównuję dane…</div>';
    }

    if (!force) {
      const cached = readCache(input);
      if (cached) {
        state.result = cached;
        state.fromCache = true;
        renderResult(cached,{fromCache:true});
        return;
      }
    }

    try {
      const data = await fetchRemote(input);
      state.result = data;
      state.fromCache = false;
      writeCache(input,data);
      renderResult(data);
    } catch (error) {
      if (box) {
        box.innerHTML = '<div class="note">Błąd: '+requireConfig().safe(error.message || 'nie udało się wyszukać produktu')+'</div>';
      }
    }
  }

  async function selectedResult(candidateId) {
    if (!state.input) throw new Error('Brak aktywnego wyszukiwania');
    return fetchRemote(state.input,candidateId);
  }

  async function useCandidate(candidateId) {
    const {catalogLookup,toast,saveDraft,quality} = requireConfig();
    const button = [...document.querySelectorAll('[data-finder-use]')]
      .find(item => String(item.dataset.finderUse) === String(candidateId || ''));
    const oldText = button?.textContent;
    if (button) {
      button.disabled = true;
      button.textContent = 'Wybieram…';
    }

    try {
      const data = await selectedResult(candidateId);
      const ok = state.kind === 'ean'
        ? catalogLookup.renderRemote(data)
        : catalogLookup.acceptResearchResult(data);

      if (ok !== false) {
        saveDraft?.();
        quality?.();
        toast('Dane produktu wpisane. Porównaj je z fizyczną sztuką.');
        window.ProductIntakeCore?.showStep?.(1);
        document.querySelector('.section.on')?.scrollIntoView?.({behavior:'smooth',block:'start'});
      }
    } catch (error) {
      toast('Nie udało się użyć produktu: ' + (error.message || 'błąd'));
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = oldText || 'Użyj tego produktu';
      }
    }
  }

  function candidateById(candidateId) {
    return candidatesOf(state.result).find(item => String(item.id) === String(candidateId)) || null;
  }

  function buildDescription(candidateId) {
    const candidate = candidateById(candidateId);
    if (!candidate) return;

    requireConfig().showDescription?.({
      brand:candidate.brand || candidate.manufacturer || '',
      model:candidate.model || state.input?.query || '',
      mpn:candidate.mpn || '',
      details:state.input?.details || '',
      candidateId:candidate.id || '',
      autoRun:true
    });
  }

  function focus() {
    requireConfig().closeModal?.();
    window.ProductIntakeCore?.showStep?.(0);
    document.querySelector('.section.on')?.scrollIntoView?.({behavior:'smooth',block:'start'});
    setTimeout(() => $('productFinderQuery')?.focus(),150);
  }

  function bind() {
    if (!$('productFinderSearch')) return;

    $('productFinderSearch').onclick = () => runSearch();
    $('productFinderQuery')?.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        runSearch();
      }
    });

    $('productFinderAdvanced')?.addEventListener('click', () => {
      const box = $('productFinderAdvancedFields');
      if (!box) return;
      const open = box.style.display !== 'none';
      box.style.display = open ? 'none' : 'grid';
      $('productFinderAdvanced').textContent = open ? 'Doprecyzuj wyszukiwanie' : 'Ukryj dodatkowe pola';
    });
  }

  window.ProductIntakeProductFinder = {
    setup,
    focus,
    runSearch
  };
})();
