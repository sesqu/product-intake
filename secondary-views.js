(() => {
  let cfg = null;
  const $ = id => document.getElementById(id);
  const safe = (value='') => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[char]));

  function setup(options) {
    cfg = options;
  }

  function requireConfig() {
    if (!cfg) throw new Error('Secondary views module is not configured');
    return cfg;
  }

  function showHistory() {
    const {keys, openModal, setActive} = requireConfig();
    setActive('more');

    let history = [];
    try { history = JSON.parse(localStorage.getItem(keys.history) || '[]'); } catch {}
    history = Array.isArray(history) ? history : [];

    openModal(
      'Historia',
      history.length
        ? history.map(item =>
            '<div style="padding:10px 0;border-bottom:1px solid #252c35">'+
              '<b>'+safe(item.action)+'</b>'+
              '<div style="color:#919baa;font-size:12px;margin-top:3px">'+
                new Date(item.time).toLocaleString('pl-PL')+' • '+safe(item.details)+
              '</div>'+
            '</div>'
          ).join('')
        : '<div style="color:#919baa">Brak historii.</div>'
    );
  }

  function showLocations() {
    const {getProducts, openModal, setActive} = requireConfig();
    setActive('more');

    const locations = [...new Set(getProducts().map(product => product.loc).filter(Boolean))].sort();
    openModal(
      'Lokalizacje',
      locations.length
        ? locations.map(location =>
            '<span style="display:inline-block;padding:8px 10px;margin:5px;border:1px solid #2a323c;border-radius:9px">'+
              safe(location)+
            '</span>'
          ).join('')
        : '<div style="color:#919baa">Lokalizacje pojawią się po zapisaniu produktów.</div>'
    );
  }

  function showIntegrations() {
    const {
      keys,
      defaultApiBase,
      getWorkspaceKey,
      syncProductsFromCloud,
      openModal,
      setActive
    } = requireConfig();

    setActive('integrations');
    const base = localStorage.getItem(keys.apiBase) || defaultApiBase;

    openModal(
      'Integracje',
      '<div style="display:grid;gap:14px">'+
        '<div style="padding:14px;border:1px solid #2a323c;border-radius:12px">'+
          '<b>Allegro API</b>'+
          '<div style="color:#919baa;font-size:12px;margin-top:4px">Wyszukiwanie katalogu po GTIN/EAN wymaga połączenia konta Allegro przez OAuth.</div>'+
          '<div style="margin-top:10px"><button id="connectAllegro" class="btn primary">Połącz konto Allegro</button> <button id="checkAllegro" class="btn">Sprawdź status</button></div>'+
          '<div id="allegroStatus" style="font-size:12px;color:#919baa;margin-top:8px"></div>'+
        '</div>'+
        '<div style="padding:14px;border:1px solid #2a323c;border-radius:12px">'+
          '<b>Synchronizacja urządzeń</b>'+
          '<div style="color:#919baa;font-size:12px;margin-top:4px">Ten kod łączy iPhone, iPad i komputer z tą samą bazą produktów. Traktuj go jak hasło — osoba z tym kodem może odczytać produkty.</div>'+
          '<div style="margin-top:10px"><label>Kod synchronizacji</label><input id="workspaceKeyInput" type="password" autocomplete="off" value="'+safe(getWorkspaceKey())+'" style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace"></div>'+
          '<div style="margin-top:10px"><button id="copyWorkspaceKey" class="btn">Kopiuj kod</button> <button id="useWorkspaceKey" class="btn primary">Użyj tego kodu</button> <button id="syncNow" class="btn">Synchronizuj teraz</button></div>'+
          '<div id="syncStatus" style="font-size:12px;color:#919baa;margin-top:8px">Wspólna baza online jest aktywna.</div>'+
        '</div>'+
        '<div style="padding:14px;border:1px solid #2a323c;border-radius:12px">'+
          '<b>Amazon SP-API</b>'+
          '<div style="color:#919baa;font-size:12px;margin-top:4px">Backend przygotowany do Catalog Items API po EAN/ASIN.</div>'+
        '</div>'+
        '<div>'+
          '<label>Adres naszego backendu API</label>'+
          '<input id="apiBaseInput" placeholder="np. https://api.twojadomena.pl" value="'+safe(base)+'">'+
          '<div style="color:#919baa;font-size:11px;margin-top:6px">Tu zapisujemy tylko adres API. Client secretów i tokenów nigdy nie przechowujemy w przeglądarce.</div>'+
        '</div>'+
        '<div><button id="saveApiBase" class="btn">Zapisz adres</button> <button id="testApiBase" class="btn">Test połączenia</button></div>'+
        '<div id="apiTestResult" style="font-size:12px;color:#919baa"></div>'+
      '</div>'
    );

    $('copyWorkspaceKey').onclick = async () => {
      try {
        await navigator.clipboard.writeText(getWorkspaceKey());
        $('syncStatus').textContent = 'Kod skopiowany. Wklej go na drugim urządzeniu.';
      } catch {
        $('workspaceKeyInput').type = 'text';
        $('workspaceKeyInput').select();
        $('syncStatus').textContent = 'Zaznaczyłem kod — skopiuj go ręcznie.';
      }
    };

    $('useWorkspaceKey').onclick = async () => {
      const key = $('workspaceKeyInput').value.trim();
      if (!/^[A-Za-z0-9_-]{32,128}$/.test(key)) {
        $('syncStatus').textContent = 'Nieprawidłowy kod synchronizacji.';
        return;
      }

      $('syncStatus').textContent = 'Łączę z bazą…';
      localStorage.setItem(keys.workspaceKey, key);
      localStorage.setItem('productIntake.cloudMigrated.' + key.slice(0,12), 'done');

      try {
        const products = await syncProductsFromCloud(true);
        $('syncStatus').textContent = 'Połączono • ' + products.length + ' produktów w tej bazie.';
      } catch (error) {
        $('syncStatus').textContent = 'Błąd: ' + (error.message || 'nie udało się połączyć');
      }
    };

    $('syncNow').onclick = async () => {
      $('syncStatus').textContent = 'Synchronizuję…';
      try {
        const products = await syncProductsFromCloud(true);
        $('syncStatus').textContent = 'Gotowe • ' + products.length + ' produktów.';
      } catch (error) {
        $('syncStatus').textContent = 'Błąd: ' + (error.message || 'brak połączenia');
      }
    };

    $('saveApiBase').onclick = () => {
      localStorage.setItem(keys.apiBase, $('apiBaseInput').value.trim().replace(/\/$/,''));
      $('apiTestResult').textContent = 'Zapisano.';
    };

    $('testApiBase').onclick = async () => {
      const url = $('apiBaseInput').value.trim().replace(/\/$/,'');
      if (!url) {
        $('apiTestResult').textContent = 'Najpierw wpisz adres API.';
        return;
      }

      $('apiTestResult').textContent = 'Sprawdzam…';
      try {
        const response = await fetch(url + '/health');
        const data = await response.json();
        $('apiTestResult').textContent = response.ok
          ? 'Połączenie działa: ' + (data.status || 'OK')
          : 'API zwróciło błąd.';
      } catch {
        $('apiTestResult').textContent = 'Brak połączenia z API.';
      }
    };

    $('connectAllegro').onclick = async () => {
      const url = (
        $('apiBaseInput').value.trim() ||
        localStorage.getItem(keys.apiBase) ||
        defaultApiBase
      ).replace(/\/$/,'');

      if (!url) {
        $('allegroStatus').textContent = 'Najpierw zapisz adres backendu.';
        return;
      }

      localStorage.setItem(keys.apiBase, url);
      $('allegroStatus').textContent = 'Pobieram link logowania…';

      try {
        const response = await fetch(url + '/api/allegro/auth-url');
        const data = await response.json();
        if (!response.ok || !data.url) throw new Error(data.error || 'Brak URL');
        location.href = data.url;
      } catch (error) {
        $('allegroStatus').textContent = 'Błąd: ' + (error.message || 'brak połączenia');
      }
    };

    $('checkAllegro').onclick = async () => {
      const url = (
        $('apiBaseInput').value.trim() ||
        localStorage.getItem(keys.apiBase) ||
        ''
      ).replace(/\/$/,'');

      if (!url) {
        $('allegroStatus').textContent = 'Najpierw zapisz adres backendu.';
        return;
      }

      $('allegroStatus').textContent = 'Sprawdzam…';
      try {
        const response = await fetch(url + '/api/allegro/status');
        const data = await response.json();
        $('allegroStatus').textContent = data.connected
          ? 'Allegro połączone.'
          : data.configured
            ? 'Skonfigurowane, ale konto nie jest jeszcze połączone.'
            : 'Backend nie ma jeszcze konfiguracji Allegro.';
      } catch {
        $('allegroStatus').textContent = 'Nie udało się sprawdzić statusu.';
      }
    };
  }

  window.ProductIntakeSecondaryViews = {
    setup,
    showHistory,
    showLocations,
    showIntegrations
  };
})();
