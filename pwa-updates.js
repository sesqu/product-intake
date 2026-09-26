(() => {
  let currentBuild = 0;
  let currentLabel = '';
  let registration = null;
  let updateInProgress = false;
  let started = false;

  const $ = id => document.getElementById(id);

  function ensureUi() {
    if (!$('piUpdateStyles')) {
      const style = document.createElement('style');
      style.id = 'piUpdateStyles';
      style.textContent = `
        #piUpdateButton{
          position:fixed;
          top:calc(env(safe-area-inset-top,0px) + 10px);
          right:10px;
          z-index:2500;
          display:none;
          align-items:center;
          gap:6px;
          min-height:36px;
          border:1px solid rgba(127,156,255,.42);
          background:rgba(25,34,52,.96);
          color:#eef3ff;
          padding:7px 10px;
          border-radius:10px;
          box-shadow:0 10px 28px rgba(0,0,0,.28);
          backdrop-filter:blur(14px);
          -webkit-backdrop-filter:blur(14px);
          font-size:11px;
          line-height:1;
          font-weight:750;
          cursor:pointer
        }
        #piUpdateButton::before{
          content:'';
          width:7px;
          height:7px;
          flex:0 0 7px;
          border-radius:999px;
          background:#7f9cff;
          box-shadow:0 0 0 3px rgba(127,156,255,.12)
        }
        #piUpdateButton:disabled{opacity:.78;cursor:default}
        #piVersionBadge{
          position:fixed;
          right:11px;
          bottom:calc(96px + env(safe-area-inset-bottom,0px));
          z-index:850;
          color:#56606d;
          font-size:9px;
          line-height:1;
          pointer-events:none;
          user-select:none
        }
        @media(max-width:620px){
          #piUpdateButton{
            top:calc(env(safe-area-inset-top,0px) + 7px);
            right:8px;
            max-width:46vw;
            min-height:32px;
            padding:6px 8px;
            font-size:10px;
            border-radius:9px
          }
        }
        @media(min-width:1151px){
          #piVersionBadge{bottom:12px}
        }
      `;
      document.head.appendChild(style);
    }

    if (!$('piUpdateButton')) {
      const button = document.createElement('button');
      button.id = 'piUpdateButton';
      button.type = 'button';
      button.textContent = 'Aktualizacja dostępna';
      button.onclick = applyUpdate;
      document.body.appendChild(button);
    }

    if (!$('piVersionBadge')) {
      const badge = document.createElement('div');
      badge.id = 'piVersionBadge';
      document.body.appendChild(badge);
    }

    $('piVersionBadge').textContent = currentLabel || (currentBuild ? 'v' + currentBuild : '');
  }

  function hideUpdate() {
    const button = $('piUpdateButton');
    if (!button) return;
    button.style.display = 'none';
    button.disabled = false;
    button.textContent = 'Aktualizacja dostępna';
  }

  function showUpdate(remoteVersion) {
    ensureUi();
    const button = $('piUpdateButton');
    button.dataset.version = String(remoteVersion || '');
    button.textContent = 'Aktualizacja dostępna';
    button.disabled = false;
    button.style.display = 'inline-flex';
  }

  async function fetchRemoteVersion() {
    try {
      const response = await fetch('./version.json?ts=' + Date.now(), {
        cache:'no-store',
        headers:{'cache-control':'no-cache'}
      });
      if (!response.ok) return null;
      const data = await response.json();
      const version = Number(data?.version);
      return Number.isFinite(version) ? version : null;
    } catch {
      return null;
    }
  }

  async function check() {
    const remoteVersion = await fetchRemoteVersion();
    if (remoteVersion == null) return false;

    if (remoteVersion > currentBuild) {
      showUpdate(remoteVersion);
      try {
        registration = registration || await navigator.serviceWorker?.getRegistration?.();
        await registration?.update?.();
      } catch {}
      return true;
    }

    hideUpdate();
    return false;
  }

  async function clearAppCaches() {
    if (!('caches' in window)) return;
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(key => key.startsWith('product-intake-'))
        .map(key => caches.delete(key))
    );
  }

  async function unregisterWorkers() {
    if (!('serviceWorker' in navigator)) return;
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map(item => item.unregister().catch(() => false)));
  }

  async function applyUpdate() {
    if (updateInProgress) return;
    updateInProgress = true;
    ensureUi();

    const button = $('piUpdateButton');
    if (button) {
      button.disabled = true;
      button.textContent = 'Aktualizuję…';
      button.style.display = 'inline-flex';
    }

    try {
      const remoteVersion = await fetchRemoteVersion();
      await unregisterWorkers();
      await clearAppCaches();

      const url = new URL(location.href);
      url.searchParams.set('app_update', String(remoteVersion || 'latest') + '-' + Date.now());
      location.replace(url.toString());
    } catch (error) {
      updateInProgress = false;
      if (button) {
        button.disabled = false;
        button.textContent = 'Spróbuj ponownie';
      }
      console.warn('PWA update failed', error);
    }
  }

  function setup({build,label} = {}) {
    currentBuild = Number(build) || 0;
    currentLabel = String(label || (currentBuild ? 'v' + currentBuild : ''));
    ensureUi();

    if (started) {
      check();
      return;
    }
    started = true;

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', async () => {
        try {
          registration = await navigator.serviceWorker.register('./sw.js', {updateViaCache:'none'});
          await registration.update();
        } catch {}
        check();
      });
    } else {
      window.addEventListener('load', check);
    }

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check();
    });
    window.addEventListener('pageshow', check);
    setInterval(check, 3 * 60 * 1000);
  }

  const api = {setup,check,applyUpdate};
  window.ProductIntakePWA = api;
  window.ProductIntakeUpdates = api;
})();
