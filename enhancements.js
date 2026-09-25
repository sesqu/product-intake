(() => {
  const DEFAULT_API_BASE = 'https://product-intake.sesquu.workers.dev';
  const KEYS = {
    draft: 'productIntake.draft.v2',
    products: 'productIntake.products.v2',
    history: 'productIntake.history.v2',
    apiBase: 'productIntake.apiBase'
  };
  const $ = id => document.getElementById(id);
  const safe = (v='') => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let photoData = [];

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(()=>{}));
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
      if (selects[1]) selects[1].id = 'gpsr';
    }
  }

  const fieldIds = ['lpn','ean','asin','productName','brand','model','category','parameters','confirm','condition','serial','contents','flaws','loc','shipping','weight','gpsr'];

  function readDraft() {
    const out = {};
    for (const id of fieldIds) {
      const el = $(id);
      if (!el) continue;
      out[id] = el.type === 'checkbox' ? el.checked : el.value;
    }
    out.photos = photoData;
    out.identified = typeof identified !== 'undefined' ? identified : false;
    return out;
  }
  function writeDraft(d) {
    if (!d) return;
    for (const id of fieldIds) {
      const el = $(id);
      if (!el || d[id] == null) continue;
      if (el.type === 'checkbox') el.checked = !!d[id];
      else el.value = d[id];
    }
    photoData = Array.isArray(d.photos) ? d.photos : [];
    if (d.identified && typeof identified !== 'undefined') identified = true;
    drawPhotos();
    if (typeof quality === 'function') quality();
  }
  function saveDraft() {
    try { localStorage.setItem(KEYS.draft, JSON.stringify(readDraft())); } catch {}
  }
  function loadDraft() {
    try {
      const raw = localStorage.getItem(KEYS.draft);
      if (raw) writeDraft(JSON.parse(raw));
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
    return req.filter(([,ok]) => !ok).map(([name]) => name);
  }

  function getProducts() { return JSON.parse(localStorage.getItem(KEYS.products) || '[]'); }
  function saveReadyProduct() {
    const missing = validateForReady();
    if (missing.length) {
      toast('Brakuje: ' + missing.slice(0,3).join(', ') + (missing.length > 3 ? '…' : ''));
      return false;
    }
    const d = readDraft();
    const products = getProducts();
    const record = {...d, id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()), savedAt:new Date().toISOString(), status:'ready'};
    products.unshift(record);
    localStorage.setItem(KEYS.products, JSON.stringify(products.slice(0,500)));
    addHistory('Produkt gotowy', d.lpn + (d.productName ? ' • ' + d.productName : ''));
    localStorage.removeItem(KEYS.draft);
    toast('Produkt zapisany jako gotowy.');
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

  function showProducts() {
    const products = getProducts();
    const rows = products.length ? products.map(p => '<tr><td>'+safe(p.lpn)+'</td><td>'+safe(p.productName||'—')+'</td><td>'+safe(p.ean||p.asin||'—')+'</td><td>'+safe(p.loc||'—')+'</td><td>'+new Date(p.savedAt).toLocaleString('pl-PL')+'</td></tr>').join('') : '<tr><td colspan="5" style="color:#919baa;padding:20px">Nie zapisano jeszcze żadnego produktu.</td></tr>';
    openModal('Produkty gotowe', '<div style="overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="text-align:left;color:#919baa"><th style="padding:9px">LPN</th><th>Nazwa</th><th>EAN / ASIN</th><th>Lokalizacja</th><th>Zapisano</th></tr></thead><tbody>'+rows+'</tbody></table></div>');
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
    openModal('Integracje', '<div style="display:grid;gap:14px"><div style="padding:14px;border:1px solid #2a323c;border-radius:12px"><b>Allegro API</b><div style="color:#919baa;font-size:12px;margin-top:4px">Wyszukiwanie katalogu po GTIN/EAN wymaga połączenia konta Allegro przez OAuth.</div><div style="margin-top:10px"><button id="connectAllegro" class="btn primary">Połącz konto Allegro</button> <button id="checkAllegro" class="btn">Sprawdź status</button></div><div id="allegroStatus" style="font-size:12px;color:#919baa;margin-top:8px"></div></div><div style="padding:14px;border:1px solid #2a323c;border-radius:12px"><b>Amazon SP-API</b><div style="color:#919baa;font-size:12px;margin-top:4px">Backend przygotowany do Catalog Items API po EAN/ASIN.</div></div><div><label>Adres naszego backendu API</label><input id="apiBaseInput" placeholder="np. https://api.twojadomena.pl" value="'+safe(base)+'"><div style="color:#919baa;font-size:11px;margin-top:6px">Tu zapisujemy tylko adres API. Client secretów i tokenów nigdy nie przechowujemy w przeglądarce.</div></div><div><button id="saveApiBase" class="btn">Zapisz adres</button> <button id="testApiBase" class="btn">Test połączenia</button></div><div id="apiTestResult" style="font-size:12px;color:#919baa"></div></div>');
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
    if ($('category')) $('category').value = best.category || '';
    if ($('parameters') && best.parameters) $('parameters').value = Array.isArray(best.parameters) ? best.parameters.map(p => (p.name||p.key)+': '+(p.value??'')).join('\n') : String(best.parameters);
    if (best.asin && !$('asin').value) $('asin').value = best.asin;
    if (best.ean && !$('ean').value) $('ean').value = best.ean;
    quality();
    saveDraft();
    addHistory('Identyfikacja API', ($('lpn').value||'')+' • '+(best.name||''));
    return true;
  }

  const demoLookup = window.lookup;
  window.lookup = async function() {
    const base = (localStorage.getItem(KEYS.apiBase)||DEFAULT_API_BASE).replace(/\/$/,'');
    if (!base) return demoLookup();
    if (!$('lpn').value.trim()) return toast('Najpierw wpisz lub zeskanuj LPN');
    if (!$('ean').value.trim() && !$('asin').value.trim()) return toast('Podaj EAN lub ASIN');
    toast('Sprawdzam Allegro i Amazon…');
    try {
      const q = new URLSearchParams();
      if ($('ean').value.trim()) q.set('ean',$('ean').value.trim());
      if ($('asin').value.trim()) q.set('asin',$('asin').value.trim());
      const r = await fetch(base+'/api/search?'+q.toString());
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Błąd API');
      renderRemote(j);
    } catch (e) { toast('Błąd integracji: '+(e.message||'brak połączenia')); }
  };

  const oldFinish = window.finish;
  window.finish = function() {
    if (saveReadyProduct()) {
      if (typeof oldFinish === 'function') oldFinish();
    }
  };

  function bindAutosave() {
    document.addEventListener('input', e => {
      if (e.target.matches('input,select,textarea')) saveDraft();
    });
    document.addEventListener('change', e => {
      if (e.target.matches('input,select,textarea')) saveDraft();
    });
  }

  async function handleAllegroCallback() {
    const params = new URLSearchParams(location.search);
    const code = params.get('code');
    const state = params.get('state');
    const error = params.get('error');
    if (error) {
      toast('Allegro: '+error);
      history.replaceState({},'',location.pathname);
      return;
    }
    if (!code) return;
    const b = (localStorage.getItem(KEYS.apiBase)||DEFAULT_API_BASE).replace(/\/$/,'');
    if (!b) {
      toast('Otrzymano kod Allegro, ale nie ustawiono adresu backendu.');
      return;
    }
    toast('Łączę konto Allegro…');
    try {
      const r = await fetch(b+'/api/allegro/exchange',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({code,state})
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Błąd autoryzacji');
      addHistory('Połączono Allegro','OAuth');
      toast('Konto Allegro połączone.');
      history.replaceState({},'',location.pathname);
    } catch (e) {
      toast('Allegro: '+(e.message||'błąd połączenia'));
    }
  }

  function boot() {
    ensureIds();
    setupPhotos();
    setupNav();
    bindAutosave();
    loadDraft();
    addHistory('Otwarto aplikację','Product Intake');
    handleAllegroCallback();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();