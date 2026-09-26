(() => {
  let cfg = null;
  const $ = id => document.getElementById(id);

  function setup(options) {
    cfg = options;
  }

  function requireConfig() {
    if (!cfg) throw new Error('Product list module is not configured');
    return cfg;
  }

  function safe(value='') {
    return requireConfig().safe(value);
  }

  async function showProducts() {
    const {
      getProducts,
      ensureVerifiedRealProductsLocal,
      seedRealCatalogProducts,
      syncProductsFromCloud,
      openModal,
      setMobileNavActive,
      openProductEditor
    } = requireConfig();

    setMobileNavActive('products');
    ensureVerifiedRealProductsLocal();

    openModal(
      'Produkty',
      '<div style="padding:24px;color:#919baa;text-align:center">Ładuję i synchronizuję produkty…</div>'
    );

    let products = getProducts()
      .filter(product => !String(product?.lpn || '').startsWith('TEST-SEED-'));

    const realTestEans = ['195949544026','4548736132580','6925281994258'];
    const hasRealSeed = realTestEans.every(
      ean => products.some(product => String(product?.ean || '') === ean)
    );

    if (!hasRealSeed) {
      await seedRealCatalogProducts(true);
      products = getProducts()
        .filter(product => !String(product?.lpn || '').startsWith('TEST-SEED-'));
    }

    try {
      products = await syncProductsFromCloud(true);
    } catch {}

    products = products
      .filter(product => !String(product?.lpn || '').startsWith('TEST-SEED-'));

    const cards = products.length
      ? products.map(product => {
          const image =
            product.catalogImage ||
            product?.sourceSnapshot?.allegro?.image ||
            '';

          const thumbnail = image
            ? '<img class="pi-product-thumb" src="'+safe(image)+'" alt="">'
            : '<div class="pi-product-thumb pi-product-thumb-empty">Brak<br>zdjęcia</div>';

          return (
            '<div class="pi-product-card" data-product-lpn="'+safe(product.lpn)+'">'+
              '<div class="pi-product-row">'+
                thumbnail+
                '<div style="min-width:0;flex:1">'+
                  '<div class="pi-small pi-muted">'+safe(product.lpn || '')+'</div>'+
                  '<div style="font-weight:700;margin:3px 0 6px;line-height:1.3">'+
                    safe(product.productName || 'Bez nazwy')+
                  '</div>'+
                  '<div class="pi-small pi-muted">'+
                    safe([product.brand,product.model].filter(Boolean).join(' • ') || '—')+
                  '</div>'+
                '</div>'+
              '</div>'+
              '<div style="margin-top:10px">'+
                (product.ean
                  ? '<span class="pi-chip">EAN '+safe(product.ean)+'</span>'
                  : '')+
                (product.loc
                  ? '<span class="pi-chip">'+safe(product.loc)+'</span>'
                  : '')+
                (product.confidence != null
                  ? '<span class="pi-chip">'+safe(product.confidence)+'%</span>'
                  : '')+
              '</div>'+
              '<div class="pi-small pi-muted" style="display:flex;justify-content:space-between;gap:8px;margin-top:10px">'+
                '<span>'+safe(product.status || '—')+'</span>'+
                '<span>Otwórz →</span>'+
              '</div>'+
            '</div>'
          );
        }).join('')
      : '<div style="color:#919baa;padding:20px">Nie zapisano jeszcze żadnego produktu.</div>';

    openModal(
      'Produkty',
      '<div class="pi-products-toolbar">'+
        '<div class="pi-muted pi-small">Master produktów • '+products.length+'</div>'+
        '<button id="refreshProducts" class="btn">Odśwież</button>'+
      '</div>'+
      '<div class="pi-products-grid">'+cards+'</div>'
    );

    document.querySelectorAll('.pi-product-card').forEach(card => {
      card.onclick = () => openProductEditor(card.dataset.productLpn);
    });

    const refresh = $('refreshProducts');
    if (refresh) {
      refresh.onclick = async () => {
        refresh.disabled = true;
        refresh.textContent = 'Synchronizuję…';

        try {
          await seedRealCatalogProducts(true);
          await syncProductsFromCloud(false);
        } finally {
          showProducts();
        }
      };
    }
  }

  window.ProductIntakeProductList = { setup, showProducts };
})();
