(() => {
  const APP_BUILD = 22;
  const APP_VERSION_LABEL = 'v22';
  let registration = null;
  let updateInProgress = false;

  const $ = id => document.getElementById(id);

  function ensureUi() {
    if ($('piUpdateButton')) return;

    const style = document.createElement('style');
    style.id = 'piUpdateStyles';
    style.textContent = `
      #piUpdateButton{
        position:fixed;
        top:calc(env(safe-area-inset-top,0px) + 8px);
        right:10px;
        z-index:2500;
        display:none;
        align-items:center;
        gap:7px;
        border:1px solid rgba(127,156,255,.45);
        background:rgba(26,36,56,.96);
        color:#eef3ff;
        padding:9px 11px;
        border-radius:11px;
        box-shadow:0 12px 34px rgba(0,0,0,.35);
        backdrop-filter:blur(14px);
        font-size:12px;
        font-weight:750;
        cursor:pointer
      }
      #piUpdateButton::before{
        content:'';
        width:8px;
        height:8px;
        border-radius:999px;
        background:#7f9cff;
        box-shadow:0 0 0 4px rgba(127,156,255,.12)
      }
      #piVersionBadge{
        position:fixed;
        right:12px;
        bottom:calc(100px + env(safe-area-inset-bottom,0px));
        z-index:850;
        color:#626d7b;
        font-size:10px;
        line-height:1;
        pointer-events:none;
        user-select:none
      }
      @media(min-width:1151px){
        #piVersionBadge{bottom:12px}
      }
    `;
    document.head.appendChild(style);

    const button = document.createElement('button');
    button.id = 'piUpdateButton';
    button.type = 'button';
    button.textContent = 'Aktualizacja dostępna';
    button.onclick = applyUpdate;
    document.body.appendChild(button);

    const badge = document.createElement('div');
    badge.id = 'piVersionBadge';
    badge.textContent = APP_VERSION_LABEL;
    document.body.appendChild(badge);
  }

  function showAvailable(remoteVersion) {
    ensureUi();
    const button = $('piUpdateButton');
    if (!button) return;
    button.dataset.version = String(remoteVersion || '');
    button.textContent = 'Aktualizacja dostępna';
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
    if (remoteVersion != null && remoteVersion > APP_BUILD) {
      showAvailable(remoteVersion);
      try { await registration?.update?.(); } catch {}
      return true;
    }
    return false;
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
      if ('serviceWorker' in navigator) {
        const reg = registration || await navigator.serviceWorker.getRegistration();
        if (reg) {
          try { await reg.update(); } catch {}
          if (reg.waiting) reg.waiting.postMessage({type:'SKIP_WAITING'});
        }
      }

      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(
          keys
            .filter(key => key.startsWith('product-intake-'))
            .map(key => caches.delete(key))
        );
      }

      const url = new URL(location.href);
      url.searchParams.set('app_update', String(Date.now()));
      location.replace(url.toString());
    } catch {
      updateInProgress = false;
      if (button) {
        button.disabled = false;
        button.textContent = 'Spróbuj ponownie';
      }
    }
  }

  function setup() {
    ensureUi();

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (updateInProgress) location.reload();
      });

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

  window.ProductIntakeUpdates = {setup, check, applyUpdate, build:APP_BUILD};
  setup();
})();
