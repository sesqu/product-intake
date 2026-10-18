(() => {
  let cfg = null;
  let state = {
    input:null,
    kind:'',
    result:null,
    fromCache:false,
    fromStaging:false
  };
  const STAGING_API = 'https://product-intake-v44b-staging.sesquu.workers.dev';

  // Upgrade the cache whenever the matching algorithm changes. Otherwise
  // prior v43/v44 cached results can shadow the improved v44b search.
  const CACHE_KEY = 'productIntake.finderCache.v44b';
  const CACHE_TTL = 24 * 60 * 60 * 1000;
  const UNCERTAIN_CACHE_TTL = 15 * 60 * 1000;
  function ttlFor(result) {
    return result?.requiresTesterChoice || result?.ambiguity?.noConfidentProduct ||
      (!result?.best && !result?.selected && !result?.candidates?.length)
      ? UNCERTAIN_CACHE_TTL
      : CACHE_TTL;
  }
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
    // Auto-detect common Amazon ASINs only, not arbitrary 10-char model codes.
    // Other ASIN formats are supported by the dedicated advanced ASIN field.
    if (/^B[A-Z0-9]{9}$/i.test(value) && /\d/.test(value)) return 'asin';
    return 'research';
  }

  function currentInput() {
    return {
      query:clean($('productFinderAsin')?.value) || clean($('productFinderQuery')?.value),
      asin:clean($('productFinderAsin')?.value),
      domain:clean($('productFinderAmazonDomain')?.value) || 'amazon.pl',
      brand:clean($('productFinderBrand')?.value),
      manufacturer:clean($('productFinderBrand')?.value),
      mpn:clean($('productFinderMpn')?.value),
      details:clean($('productFinderDetails')?.value)
    };
  }

  function cacheKey(input) {
    return [
      requireConfig().apiBase().replace(/\/$/,''),
      norm(input.query),
      norm(input.asin),
      norm(input.domain),
      norm(input.brand),
      norm(input.mpn),
      norm(input.details)
    ].join('|');
  }

  function readCache(input) {
    try {
      const all = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
      const hit = all[cacheKey(input)];
      if (!hit || Date.now() - Number(hit.savedAt || 0) > ttlFor(hit.data)) return null;
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
        if (now - Number(value?.savedAt || 0) > ttlFor(value?.data)) delete all[key];
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

  const AUDIT_KEY = 'productIntake.finderAudit.v1';
  const AUDIT_LIMIT = 50;
  let activeSearch = 0;

  function auditEnabled() {
    return Boolean($('productFinderDiagnosticsToggle')?.checked);
  }
  function stagingEnabled() {
    return auditEnabled() && Boolean($('productFinderStagingToggle')?.checked);
  }
  function resetActiveResult() {
    ++activeSearch;
    state.result=null;
    state.input=null;
    state.fromCache=false;
    state.fromStaging=false;
    const box=$('productFinderResult');
    if(box){
      box.style.display='block';
      box.innerHTML='<div class="muted">Zmieniono źródło wyszukiwania. Kliknij Szukaj, aby sprawdzić aktualny backend.</div>';
    }
  }

  function readAudit() {
    try {
      const raw = JSON.parse(localStorage.getItem(AUDIT_KEY) || '[]');
      return Array.isArray(raw) ? raw.slice(0,AUDIT_LIMIT) : [];
    } catch { return []; }
  }

  function shortSnapshot(value) {
    return {
      id:clean(value?.id).slice(0,160),
      name:clean(value?.name).slice(0,300),
      model:clean(value?.model).slice(0,120),
      mpn:clean(value?.mpn).slice(0,120),
      score:Number.isFinite(Number(value?.score)) ? Number(value.score) : null
    };
  }

  function comparisonHtml(result) {
    const safe=requireConfig().safe;
    const stats=result?.comparison;
    if (!stats || (!stats.phrase && !stats.mpn)) {
      return '<p class="muted" style="font-size:12px">Porównanie fraza / MPN będzie widoczne po uruchomieniu nowej wersji API v44b.</p>';
    }
    const item=(label,source)=>'<div style="flex:1;min-width:170px;border:1px solid #303947;border-radius:10px;padding:10px">'+
      '<b>'+safe(label)+'</b>'+
      '<div class="muted" style="font-size:12px">Wyników: '+safe(source?.count ?? 0)+'</div>'+
      '<div style="margin-top:6px;font-size:12px">'+safe(source?.best?.name || 'Brak produktu')+'</div>'+
      '<div class="muted" style="font-size:11px">'+
        (source?.best ? 'Ocena: '+safe(source.best.score ?? source.confidence ?? '?')+' pkt' : '')+
      '</div></div>';
    return '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px">'+
      item('Wyszukiwanie frazowe',stats.phrase)+
      item('Tryb MPN',stats.mpn)+
    '</div><div class="muted" style="font-size:11px;margin-top:5px">'+
      'Ta sama pula zapytań, bez dodatkowych wywołań Allegro. Kandydat może wystąpić w obu grupach.'+
    '</div>';
  }

  function auditPanel(result) {
    if (!auditEnabled() || !['research','asin'].includes(state.kind)) return '';
    const safe=requireConfig().safe;
    const candidates=candidatesOf(result);
    const choices=candidates.map(candidate=>
      '<button type="button" class="btn" data-finder-verify="'+safe(candidate.id || '')+'">'+
        'Potwierdź: '+safe(candidate.name || 'produkt')+
      '</button>'
    ).join('');
    return '<section class="note" style="margin-top:12px">'+
      '<b>Test identyfikacji produktu</b>'+
      '<div class="muted" style="font-size:12px">Porównaj wyniki z fizyczną sztuką. Sam wynik punktowy nie potwierdza zgodności modelu.</div>'+
      comparisonHtml(result)+
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">'+
        choices+
        '<button type="button" class="btn" data-finder-verdict="missing">Nie ma właściwego produktu</button>'+
        '<button type="button" class="btn" data-finder-verdict="uncertain">Nie wiem / do wyjaśnienia</button>'+
      '</div>'+
      '<div class="muted" style="font-size:11px;margin-top:10px">Zapisz wynik testu tylko po sprawdzeniu produktu. Nie zmienia to mastera ani aukcji.</div>'+
    '</section>';
  }

  function recordAudit(verdict,candidateId='') {
    if (!auditEnabled() || !['research','asin'].includes(state.kind) || !state.result || !state.input) return false;
    const candidates=candidatesOf(state.result);
    const chosen=candidates.find(x=>String(x.id)===String(candidateId))||null;
    if (verdict==='correct' && !chosen) return false;
    const first=candidates[0]||null;
    const compactAttempts=(state.result.searchAttempts||[]).slice(0,3).map(x=>({
      mode:clean(x.mode) || 'PHRASE',
      phrase:clean(x.phrase).slice(0,150),
      foundCount:Number(x.foundCount)||0,
      uniqueAdded:Number(x.uniqueAdded)||0,
      error:clean(x.error).slice(0,160)
    }));
    const snapshot= {
      id:String(Date.now())+'-'+Math.random().toString(36).slice(2,9),
      savedAt:new Date().toISOString(),
      input:{
        query:state.input.query.slice(0,150),
        brand:state.input.brand.slice(0,100),
        mpn:state.input.mpn.slice(0,100),
        asin:(state.input.asin || (state.kind==='asin'?state.input.query:'')).slice(0,15),
        domain:state.input.domain
      },
      method:clean(state.result.confidenceMethod),
      verdict: verdict==='correct'
        ? (String(first?.id)===String(chosen.id) ? 'top1' : 'other')
        : verdict,
      best:first?shortSnapshot(first):null,
      chosen:chosen?shortSnapshot(chosen):null,
      candidates:candidates.map(shortSnapshot),
      attempts:compactAttempts,
      comparison:state.result.comparison || null,
      bestFoundBy:state.result.bestFoundBy || null,
      requiresTesterChoice:Boolean(state.result.requiresTesterChoice)
    };
    try{
      const all=[snapshot,...readAudit()].slice(0,AUDIT_LIMIT);
      localStorage.setItem(AUDIT_KEY,JSON.stringify(all));
    }catch{
      requireConfig().toast?.('Nie udało się zapisać testu w przeglądarce.');
      return false;
    }
    renderAuditHistory();
    requireConfig().toast?.('Zapisano ocenę testera w lokalnej historii.');
    return true;
  }

  function renderAuditHistory() {
    const list=$('productFinderAuditList');
    if (!list) return;
    const safe=requireConfig().safe;
    const rows=readAudit();
    if ($('productFinderAuditCount')) $('productFinderAuditCount').textContent=String(rows.length);
    const label={
      top1:'TOP 1 poprawny',
      other:'Poprawny inny kandydat',
      missing:'Brak właściwego produktu',
      uncertain:'Nierozstrzygnięte'
    };
    const ok=rows.filter(x=>x.verdict==='top1').length;
    const other=rows.filter(x=>x.verdict==='other').length;
    const wrong=rows.filter(x=>x.verdict==='missing').length;
    list.innerHTML=rows.length
      ? '<div class="muted" style="margin:8px 0;font-size:12px">TOP1: '+ok+
        ' · Inny kandydat: '+other+' · Brak: '+wrong+
        ' · Nierozstrzygnięte: '+(rows.length-ok-other-wrong)+
        ' (oceny ręczne, nie statystyka całego katalogu)</div>'+
        rows.slice(0,15).map(x=>'<div style="border-top:1px solid #303947;padding:9px 0">'+
          '<b>'+safe(x.input?.query || 'Brak modelu')+'</b>'+
          '<div class="muted" style="font-size:12px">'+safe(label[x.verdict]||'Test')+
            ' · '+safe(x.savedAt||'')+'</div>'+
          '<div style="font-size:12px">'+safe(x.chosen?.name || x.best?.name || 'Brak kandydatów')+'</div>'+
        '</div>').join('')+
        (rows.length>15 ? '<div class="muted">Pokazano 15 najnowszych; pełne dane w eksporcie JSON.</div>' : '')
      : '<p class="muted">Brak zapisanych testów.</p>';
  }

  async function exportAudit() {
    const rows=readAudit();
    if (!rows.length){requireConfig().toast?.('Brak testów do skopiowania.');return;}
    try{
      await navigator.clipboard.writeText(JSON.stringify({
        format:'product-intake-finder-audit-v1',
        storage:'local-only',
        exportedAt:new Date().toISOString(),
        tests:rows
      },null,2));
      requireConfig().toast?.('Skopiowano raport testów.');
    }catch {
      requireConfig().toast?.('Nie udało się skopiować historii.');
    }
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
    return list.slice(0,5);
  }

  function renderCandidate(candidate,result,index) {
    const safe = requireConfig().safe;
    const score = state.kind==='asin' ? null : scoreOf(candidate,result,index);
    const quality = state.kind==='asin'
      ? {text:'Amazon — do weryfikacji',className:'warn'}
      : qualityLabel(score);
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
          (state.kind==='asin' && candidate.image
            ? '<img src="'+safe(candidate.image)+'" alt="" loading="lazy" style="float:right;max-width:95px;max-height:100px;border-radius:8px;margin:0 0 8px 12px">'
            : '')+
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
      (state.kind==='asin'
        ? '<div class="muted" style="margin-top:9px;font-size:12px">ASIN: '+safe(candidate.asin)+
          ' · '+safe(result?.marketplace || 'Amazon')+
          ' · brak automatycznego EAN i potwierdzenia wariantu.</div>'
        : '')+
      (warnings.length
        ? '<div style="margin-top:8px;font-size:11px" class="warn">'+
            warnings.slice(0,3).map(item => '⚠ '+safe(item.message || item)).join('<br>')+
          '</div>'
        : '')+
      evidenceHtml(candidate,result,index)+
      (state.fromStaging
        ? '<div class="muted" style="font-size:12px;margin-top:10px">Tryb testowy — wybierz ocenę poniżej. Import do mastera jest zablokowany.</div>'
        : '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px">'+
          '<button type="button" class="btn primary" data-finder-use="'+safe(candidate.id || '')+'">'+
            (state.kind==='asin' ? 'Potwierdzam produkt i używam danych Amazon' : 'Użyj tego produktu')+
          '</button>'+
          (state.kind==='asin' ? '' :
            '<button type="button" class="btn" data-finder-description="'+safe(candidate.id || '')+'">Zbuduj opis</button>')+
        '</div>')+
    '</div>';
  }

  function researchTraceHtml(result) {
    const attempts = Array.isArray(result?.searchAttempts)
      ? result.searchAttempts.slice(0,3)
      : [];
    if (!attempts.length) return '';

    const safe = requireConfig().safe;
    const mpn = attempts.find(item => item?.mode === 'MPN');
    const first = result?.bestFoundBy || null;
    const discoveredVia = first?.mode === 'MPN'
      ? 'MPN'
      : first?.mode === 'PHRASE'
        ? 'wyszukiwanie frazowe'
        : 'nieustalone (starsza wersja API)';
    const items = attempts.map((attempt,index) => {
      const mode = attempt?.mode === 'MPN' ? 'MPN' : 'fraza';
      const found = Number.isFinite(Number(attempt?.foundCount))
        ? String(Math.max(0,Number(attempt.foundCount)))
        : '?';
      const added = Number.isFinite(Number(attempt?.uniqueAdded))
        ? String(Math.max(0,Number(attempt.uniqueAdded)))
        : '?';
      const error = attempt?.error
        ? '<div class="warn">Błąd próby: '+safe(attempt.error)+'</div>'
        : '';
      return '<div style="padding:7px 0;border-top:1px solid #303847">'+
        '<b>'+safe(index+1)+'. '+safe(mode)+'</b> — '+safe(attempt?.phrase || '')+
        '<div class="muted" style="font-size:11px">'+
          'Wyniki: '+safe(found)+' · nowe: '+safe(added)+
        '</div>'+error+
      '</div>';
    }).join('');

    return '<details class="note" style="margin-top:10px">'+
      '<summary style="cursor:pointer">Szczegóły wyszukiwania'+
        (mpn ? ' · sprawdzono MPN' : '')+
      '</summary>'+
      '<div style="margin-top:8px;font-size:12px">Źródło pierwszego odnalezienia wybranego wyniku: '+
        '<b>'+safe(discoveredVia)+'</b>.'+
        '<div class="muted">To nie jest potwierdzenie zgodności z fizycznym produktem.</div>'+
      '</div>'+items+
    '</details>';
  }

  function renderResult(result,{fromCache=false}={}) {
    const safe = requireConfig().safe;
    const box = $('productFinderResult');
    if (!box) return;

    const candidates = candidatesOf(result);
    if (!candidates.length) {
      box.style.display = 'block';
      box.innerHTML =
        '<div class="note">'+(state.kind==='asin'
          ? safe(result?.message || 'Nie znaleziono tego ASIN w wybranym sklepie Amazon.')
          : 'Nie znaleziono produktu. Dopisz markę / producenta, MPN albo dodatkową informację i spróbuj ponownie.')+'</div>'+
        researchTraceHtml(result)+
        auditPanel(result);
      bindAuditActions(box);
      return;
    }

    const mode = state.kind === 'ean' ? 'EAN / GTIN'
      : state.kind === 'asin' ? 'ASIN / Amazon przez SerpApi'
      : 'model / MPN / fraza';
    const used = Array.isArray(result?.queriesUsed) && result.queriesUsed.length
      ? '<div class="muted" style="font-size:11px;margin-top:5px">Próby: '+safe(result.queriesUsed.join(' → '))+'</div>'
      : '';

    box.style.display = 'block';
    box.innerHTML =
      '<div class="lookupTop">'+
        '<div><b>Znalezione produkty</b>'+
          '<div class="muted">Tryb: '+safe(mode)+' • nic nie wpisujemy do mastera bez Twojego wyboru.</div>'+
          (state.fromStaging ? '<div class="note" style="margin-top:8px">Wyniki z odizolowanego stagingu v44b. Nie można użyć ich do zapisu produktu.</div>' : '')+
          used+
          (state.kind==='asin'
            ? '<div class="muted" style="font-size:12px;margin-top:8px">Źródło: SerpApi / '+safe(result?.marketplace || '')+
              (result?.cached ? ' · wynik z pamięci 24h' : ' · pobrano online')+'</div>'+
              '<div class="note" style="margin-top:8px">Źródło nieoficjalne. Porównaj ASIN, model i wariant z fizyczną sztuką. Dane Amazon nie mają pierwszeństwa przed innymi źródłami.</div>'+
              (result?.sourceUrl ? '<a href="'+safe(result.sourceUrl)+'" target="_blank" rel="noopener noreferrer" style="font-size:12px">Otwórz kartę na Amazon ↗</a>' : '')
            : '')+
          researchTraceHtml(result)+
        '</div>'+
        '<div>'+
          (fromCache ? '<span class="badge">'+(ttlFor(result) === UNCERTAIN_CACHE_TTL ? 'pamięć 15 min' : 'pamięć 24h')+'</span> ' : '')+
          '<button id="productFinderRefresh" type="button" class="btn">Odśwież</button>'+
        '</div>'+
      '</div>'+
      (result?.ambiguity?.noConfidentProduct
        ? '<div class="note" style="margin-top:10px">Nie mam jeszcze pewnego produktu głównego. Najwyższe wyniki wyglądają na część / akcesorium albo mają za słabe potwierdzenie. Dopisz markę, producenta lub typ produktu i porównaj fizyczną sztukę.</div>'
        : result?.requiresTesterChoice
          ? '<div class="note" style="margin-top:10px">Wyniki są niejednoznaczne — nie wybieram automatycznie. Porównaj model, markę, MPN i wariant.</div>'
          : '')+
      '<div style="display:grid;gap:10px;margin-top:12px">'+
        candidates.map((candidate,index) => renderCandidate(candidate,result,index)).join('')+
      '</div>'+
      auditPanel(result);

    $('productFinderRefresh').onclick = () => runSearch({force:true});

    box.querySelectorAll('[data-finder-use]').forEach(button => {
      button.onclick = () => useCandidate(button.dataset.finderUse);
    });
    box.querySelectorAll('[data-finder-description]').forEach(button => {
      button.onclick = () => buildDescription(button.dataset.finderDescription);
    });
    bindAuditActions(box);
  }

  function bindAuditActions(box) {
    box.querySelectorAll('[data-finder-verify]').forEach(button => {
      button.onclick=()=>recordAudit('correct',button.dataset.finderVerify);
    });
    box.querySelectorAll('[data-finder-verdict]').forEach(button => {
      button.onclick=()=>recordAudit(button.dataset.finderVerdict);
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

  async function fetchResearch(input,candidateId='',useStage=false) {
    const {apiBase} = requireConfig();
    const credentials=clean($('productFinderStagingKey')?.value);
    if (useStage && credentials.length < 20) {
      throw new Error('Wpisz klucz do testowego Workera (minimum 20 znaków).');
    }
    const response = await fetch(
      (useStage ? STAGING_API : apiBase().replace(/\/$/,''))+'/api/research', {
      method:'POST',
      cache:'no-store',
      headers:{
        'content-type':'application/json',
        ...(useStage ? {'x-staging-test-key':credentials} : {})
      },
      body:JSON.stringify({...input,candidateId})
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Błąd wyszukiwania produktu');
    return data;
  }

  async function fetchAsin(input,useStage=false) {
    const {apiBase}=requireConfig();
    const asin=clean(input.asin || input.query).toUpperCase();
    if (!/^[A-Z0-9]{10}$/.test(asin)) {
      throw new Error('ASIN musi mieć 10 liter lub cyfr.');
    }
    const domain=clean(input.domain)||'amazon.pl';
    if (!['amazon.pl','amazon.de','amazon.com'].includes(domain)) {
      throw new Error('Nieobsługiwany region Amazon.');
    }
    const key=clean($('productFinderStagingKey')?.value);
    if(useStage && key.length<20) throw new Error('Wpisz klucz do testowego Workera.');
    const query=new URLSearchParams({asin,domain});
    const response=await fetch(
      (useStage ? STAGING_API : apiBase().replace(/\/$/,''))+'/api/asin?'+query.toString(),{
        headers:useStage ? {'x-staging-test-key':key} : {},
        cache:'no-store'
      }
    );
    const data=await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(data.error || 'Nie udało się pobrać danych ASIN.');
    return data;
  }

  async function fetchRemote(input,candidateId='',useStage=false) {
    if (useStage && !input.asin && detectKind(input.query) === 'ean') {
      throw new Error('Testowy tryb MPN wymaga kodu modelu albo frazy, a nie EAN.');
    }
    if (input.asin || detectKind(input.query)==='asin') return fetchAsin(input,useStage);
    return detectKind(input.query) === 'ean'
      ? fetchEan(input,candidateId)
      : fetchResearch(input,candidateId,useStage);
  }

  async function runSearch({force=false}={}) {
    const searchId=++activeSearch;
    const {toast} = requireConfig();
    const input = currentInput();

    if (!input.query) {
      toast('Wpisz EAN, ASIN, model, MPN albo nazwę produktu.');
      $('productFinderQuery')?.focus();
      return;
    }

    const useStage=stagingEnabled();
    state.input = input;
    state.kind = input.asin ? 'asin' : detectKind(input.query);
    state.fromStaging=useStage;
    const box = $('productFinderResult');
    if (box) {
      box.style.display = 'block';
      box.innerHTML = '<div class="muted">Szukam kandydatów i porównuję dane…</div>';
    }

    if (!force && !useStage) {
      const cached = readCache(input);
      if (cached) {
        state.result = cached;
        state.fromCache = true;
        renderResult(cached,{fromCache:true});
        return;
      }
    }

    try {
      const data = await fetchRemote(input,'',useStage);
      if (searchId !== activeSearch) return;
      state.result = data;
      state.fromCache = false;
      if (!useStage) writeCache(input,data);
      renderResult(data);
    } catch (error) {
      if (searchId !== activeSearch) return;
      if (box) {
        box.innerHTML = '<div class="note">Błąd: '+requireConfig().safe(error.message || 'nie udało się wyszukać produktu')+'</div>';
      }
    }
  }

  async function selectedResult(candidateId) {
    if (!state.input) throw new Error('Brak aktywnego wyszukiwania');
    if (state.fromStaging) throw new Error('Zapis produktu jest wyłączony dla testowego Workera.');
    return fetchRemote(state.input,candidateId,false);
  }

  async function useCandidate(candidateId) {
    const {catalogLookup,toast,saveDraft,quality} = requireConfig();
    if (state.fromStaging){
      toast('Wyniku stagingu nie można zapisać do mastera.');
      return;
    }
    const asinResult=state.kind==='asin';
    const button = [...document.querySelectorAll('[data-finder-use]')]
      .find(item => String(item.dataset.finderUse) === String(candidateId || ''));
    const oldText = button?.textContent;
    if (button) {
      button.disabled = true;
      button.textContent = 'Wybieram…';
    }

    try {
      const data = asinResult ? state.result : await selectedResult(candidateId);
      const ok = asinResult
        ? (String(data?.best?.id)===String(candidateId) &&
          catalogLookup.acceptAsinResult?.(data))
        : state.kind === 'ean'
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
    if (state.fromStaging || state.kind==='asin') return;
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
    $('productFinderDiagnosticsToggle')?.addEventListener('change',()=>{
      const on=auditEnabled();
      const options=$('productFinderDiagnosticOptions');
      if(options) options.style.display=on?'block':'none';
      if (!on && $('productFinderStagingToggle')) {
        $('productFinderStagingToggle').checked=false;
        if ($('productFinderStagingKey')) $('productFinderStagingKey').value='';
        resetActiveResult();
      }else if (state.result){
        renderResult(state.result,{fromCache:state.fromCache});
      }
    });
    $('productFinderStagingToggle')?.addEventListener('change',()=>{
      const on=stagingEnabled();
      const credentials=$('productFinderStagingCredentials');
      if(credentials) credentials.style.display=on?'block':'none';
      if(!on && $('productFinderStagingKey')) $('productFinderStagingKey').value='';
      resetActiveResult();
    });
    if ($('productFinderAuditExport')) $('productFinderAuditExport').onclick=exportAudit;
    if ($('productFinderAuditClear')) $('productFinderAuditClear').onclick=()=>{
      if (!readAudit().length) return;
      if (typeof confirm === 'function' && !confirm('Usunąć lokalną historię testów wyszukiwania?')) return;
      localStorage.removeItem(AUDIT_KEY);
      renderAuditHistory();
      requireConfig().toast?.('Usunięto historię testów.');
    };
    renderAuditHistory();
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
