(() => {
  const EXPECTED_BUILD_KEY = 'productIntake.expectedBuild';

  let currentBuild = 0;
  let currentLabel = '';
  let registration = null;
  let updateInProgress = false;
  let started = false;
  let availableRelease = null;
  let progressValue = 0;
  let progressTarget = 0;
  let progressFrame = 0;

  const $ = id => document.getElementById(id);

  function fnv32(text) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8,'0');
  }

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
          background:rgba(25,34,52,.97);
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
          width:7px;height:7px;flex:0 0 7px;
          border-radius:999px;
          background:#7f9cff;
          box-shadow:0 0 0 3px rgba(127,156,255,.12)
        }
        #piUpdatePanel{
          position:fixed;
          top:calc(env(safe-area-inset-top,0px) + 9px);
          right:9px;
          z-index:2600;
          display:none;
          width:min(238px,calc(100vw - 18px));
          padding:11px 12px 12px;
          border:1px solid #303b49;
          border-radius:12px;
          background:rgba(17,23,31,.98);
          box-shadow:0 14px 38px rgba(0,0,0,.38);
          backdrop-filter:blur(16px);
          -webkit-backdrop-filter:blur(16px)
        }
        #piUpdateStage{
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:10px;
          color:#eef3ff;
          font-size:11px;
          font-weight:750
        }
        #piUpdatePercent{
          flex:0 0 auto;
          font-variant-numeric:tabular-nums;
          color:#aebfff
        }
        #piUpdateTrack{
          height:5px;
          margin-top:9px;
          overflow:hidden;
          border-radius:999px;
          background:#252d38
        }
        #piUpdateBar{
          width:0%;
          height:100%;
          border-radius:inherit;
          background:#7f9cff;
          transition:none;
          will-change:width
        }
        #piUpdateMessage{
          display:none;
          margin-top:8px;
          color:#aeb6c1;
          font-size:10px;
          line-height:1.35
        }
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
            max-width:52vw;
            min-height:32px;
            padding:6px 8px;
            font-size:10px;
            border-radius:9px
          }
          #piUpdatePanel{
            top:calc(env(safe-area-inset-top,0px) + 7px);
            right:8px
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
      button.onclick = applyUpdate;
      document.body.appendChild(button);
    }

    if (!$('piUpdatePanel')) {
      const panel = document.createElement('div');
      panel.id = 'piUpdatePanel';
      panel.innerHTML =
        '<div id="piUpdateStage"><span id="piUpdateStageText">Pobieranie</span><span id="piUpdatePercent">0%</span></div>'+
        '<div id="piUpdateTrack"><div id="piUpdateBar"></div></div>'+
        '<div id="piUpdateMessage"></div>';
      document.body.appendChild(panel);
    }

    if (!$('piVersionBadge')) {
      const badge = document.createElement('div');
      badge.id = 'piVersionBadge';
      document.body.appendChild(badge);
    }

    $('piVersionBadge').textContent =
      currentLabel || (currentBuild ? 'v' + currentBuild : '');
  }

  function setProgress(target, stage, message='') {
    ensureUi();
    progressTarget = Math.max(progressTarget, Math.min(100, Number(target) || 0));

    if (stage) $('piUpdateStageText').textContent = stage;
    const messageEl = $('piUpdateMessage');
    messageEl.textContent = message;
    messageEl.style.display = message ? 'block' : 'none';

    if (!progressFrame) progressFrame = requestAnimationFrame(animateProgress);
  }

  function animateProgress() {
    const delta = progressTarget - progressValue;

    if (delta > 0.05) {
      progressValue += Math.max(0.18, delta * 0.09);
      if (progressValue > progressTarget) progressValue = progressTarget;
    } else {
      progressValue = progressTarget;
    }

    const shown = Math.min(100, Math.round(progressValue));
    $('piUpdateBar').style.width = progressValue.toFixed(2) + '%';
    $('piUpdatePercent').textContent = shown + '%';

    if (Math.abs(progressTarget - progressValue) > 0.05) {
      progressFrame = requestAnimationFrame(animateProgress);
    } else {
      progressFrame = 0;
    }
  }

  function resetProgress() {
    progressValue = 0;
    progressTarget = 0;
    if (progressFrame) cancelAnimationFrame(progressFrame);
    progressFrame = 0;
    if ($('piUpdateBar')) $('piUpdateBar').style.width = '0%';
    if ($('piUpdatePercent')) $('piUpdatePercent').textContent = '0%';
  }

  function hideUpdate() {
    availableRelease = null;
    const button = $('piUpdateButton');
    if (button) button.style.display = 'none';
  }

  function showUpdate(release) {
    ensureUi();
    availableRelease = release;
    const button = $('piUpdateButton');
    button.dataset.version = String(release.version);
    button.textContent = 'Aktualizacja v' + release.version;
    button.disabled = false;
    button.style.display = 'inline-flex';
  }

  function showRestartRequired(expectedBuild) {
    ensureUi();
    $('piUpdateButton').style.display = 'none';
    $('piUpdatePanel').style.display = 'block';
    resetProgress();
    progressValue = 100;
    progressTarget = 100;
    $('piUpdateBar').style.width = '100%';
    $('piUpdatePercent').textContent = '100%';
    $('piUpdateStageText').textContent = 'Aktualizacja pobrana';
    const message = $('piUpdateMessage');
    message.textContent =
      'iOS nadal używa starej wersji. Zamknij Product Intake i otwórz ponownie, aby uruchomić v' +
      expectedBuild + '.';
    message.style.display = 'block';
  }

  async function fetchRemoteManifest() {
    try {
      const response = await fetch('./version.json?ts=' + Date.now(), {
        cache:'no-store',
        headers:{'cache-control':'no-cache'}
      });
      if (!response.ok) return null;

      const data = await response.json();
      const version = Number(data?.version);
      if (!Number.isInteger(version)) return null;

      return {
        ...data,
        version,
        label:String(data?.label || ('v' + version)),
        assets:Array.isArray(data?.assets) ? data.assets : []
      };
    } catch {
      return null;
    }
  }

  async function fetchVerifiedAsset(asset, cacheBust='ready') {
    const url = new URL(asset.url, location.href);
    url.searchParams.set(cacheBust, String(Date.now()));

    const response = await fetch(url.toString(), {
      cache:'no-store',
      headers:{'cache-control':'no-cache'}
    });

    if (!response.ok) throw new Error('Brak pliku ' + asset.url);
    const text = await response.text();

    if (
      Number.isInteger(asset.chars) &&
      text.length !== asset.chars
    ) {
      throw new Error('Niepełny plik ' + asset.url);
    }

    if (asset.fnv32 && fnv32(text) !== String(asset.fnv32)) {
      throw new Error('Nieaktualny plik ' + asset.url);
    }

    return text;
  }

  async function verifyReleaseReady(release) {
    if (!release?.assets?.length) return false;

    try {
      await Promise.all(
        release.assets.map(asset => fetchVerifiedAsset(asset,'verify'))
      );
      return true;
    } catch {
      return false;
    }
  }

  async function check() {
    const expectedBuild = Number(localStorage.getItem(EXPECTED_BUILD_KEY) || 0);

    if (expectedBuild > currentBuild) {
      showRestartRequired(expectedBuild);
      return false;
    }

    if (expectedBuild && currentBuild >= expectedBuild) {
      localStorage.removeItem(EXPECTED_BUILD_KEY);
      const cleanUrl = new URL(location.href);
      if (cleanUrl.searchParams.has('app_update')) {
        cleanUrl.searchParams.delete('app_update');
        history.replaceState({},'',cleanUrl.pathname + cleanUrl.search + cleanUrl.hash);
      }
    }

    const release = await fetchRemoteManifest();
    if (!release || release.version <= currentBuild) {
      hideUpdate();
      return false;
    }

    const ready = await verifyReleaseReady(release);
    if (!ready) {
      hideUpdate();
      return false;
    }

    showUpdate(release);

    try {
      registration =
        registration ||
        await navigator.serviceWorker?.getRegistration?.();
      await registration?.update?.();
    } catch {}

    return true;
  }

  function concatChunks(chunks, total) {
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }

  async function downloadRelease(release) {
    const cacheName = 'product-intake-v' + release.version;
    if ('caches' in window) await caches.delete(cacheName);
    const cache = 'caches' in window ? await caches.open(cacheName) : null;

    const totalBytes = release.assets.reduce(
      (sum, asset) => sum + Math.max(1, Number(asset.bytes) || 1),
      0
    );
    let downloadedBytes = 0;

    for (const asset of release.assets) {
      const url = new URL(asset.url, location.href);
      url.searchParams.set('download', release.version + '-' + Date.now());

      const response = await fetch(url.toString(), {
        cache:'no-store',
        headers:{'cache-control':'no-cache'}
      });

      if (!response.ok) throw new Error('Nie udało się pobrać ' + asset.url);

      const expectedBytes = Math.max(1, Number(asset.bytes) || 1);
      const chunks = [];
      let assetBytes = 0;

      if (response.body?.getReader) {
        const reader = response.body.getReader();

        while (true) {
          const {done,value} = await reader.read();
          if (done) break;
          if (!value) continue;

          chunks.push(value);
          assetBytes += value.byteLength;
          const effective =
            downloadedBytes + Math.min(assetBytes, expectedBytes);
          setProgress(
            4 + (effective / totalBytes) * 76,
            'Pobieranie v' + release.version
          );
        }
      } else {
        const buffer = new Uint8Array(await response.arrayBuffer());
        chunks.push(buffer);
        assetBytes = buffer.byteLength;
      }

      const bytes = concatChunks(chunks, assetBytes);
      const text = new TextDecoder().decode(bytes);

      if (
        Number.isInteger(asset.chars) &&
        text.length !== asset.chars
      ) {
        throw new Error('Pobrano niepełny plik ' + asset.url);
      }

      if (asset.fnv32 && fnv32(text) !== String(asset.fnv32)) {
        throw new Error('Pobrano złą wersję ' + asset.url);
      }

      if (cache) {
        await cache.put(
          new Request(new URL(asset.url, location.href).toString()),
          new Response(bytes, {
            status:200,
            headers:{
              'content-type':response.headers.get('content-type') || 'text/plain;charset=utf-8'
            }
          })
        );
      }

      downloadedBytes += expectedBytes;
      setProgress(
        4 + (downloadedBytes / totalBytes) * 76,
        'Pobieranie v' + release.version
      );
    }
  }

  async function activateLatestWorker() {
    if (!('serviceWorker' in navigator)) return;

    registration =
      registration ||
      await navigator.serviceWorker.getRegistration();

    if (!registration) {
      registration = await navigator.serviceWorker.register(
        './sw.js',
        {updateViaCache:'none'}
      );
    }

    await registration.update();

    const waiting = registration.waiting;
    if (waiting) waiting.postMessage({type:'SKIP_WAITING'});

    await new Promise(resolve => {
      let settled = false;

      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };

      navigator.serviceWorker.addEventListener(
        'controllerchange',
        finish,
        {once:true}
      );

      const worker = registration.installing || registration.waiting;
      if (worker) {
        worker.addEventListener('statechange', () => {
          if (worker.state === 'activated') finish();
        });
      }

      setTimeout(finish, 4500);
    });
  }

  async function applyUpdate() {
    if (updateInProgress) return;
    updateInProgress = true;
    ensureUi();

    const release =
      availableRelease ||
      await fetchRemoteManifest();

    if (
      !release ||
      release.version <= currentBuild ||
      !(await verifyReleaseReady(release))
    ) {
      updateInProgress = false;
      hideUpdate();
      return;
    }

    $('piUpdateButton').style.display = 'none';
    $('piUpdatePanel').style.display = 'block';
    resetProgress();
    setProgress(3,'Pobieranie v' + release.version);

    try {
      await downloadRelease(release);

      setProgress(84,'Instalowanie v' + release.version);
      await activateLatestWorker();

      setProgress(96,'Uruchamianie v' + release.version);
      localStorage.setItem(EXPECTED_BUILD_KEY, String(release.version));

      await new Promise(resolve => setTimeout(resolve, 420));
      setProgress(100,'Uruchamianie v' + release.version);
      await new Promise(resolve => setTimeout(resolve, 280));

      const url = new URL(location.href);
      url.searchParams.set(
        'app_update',
        'v' + release.version + '-' + Date.now()
      );
      location.replace(url.toString());
    } catch (error) {
      updateInProgress = false;
      const message = $('piUpdateMessage');
      $('piUpdateStageText').textContent = 'Nie udało się zaktualizować';
      message.textContent = 'Spróbuj ponownie za chwilę.';
      message.style.display = 'block';
      console.warn('PWA update failed', error);

      setTimeout(() => {
        $('piUpdatePanel').style.display = 'none';
        showUpdate(release);
      }, 2600);
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
          registration = await navigator.serviceWorker.register(
            './sw.js',
            {updateViaCache:'none'}
          );
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
