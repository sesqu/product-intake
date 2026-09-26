(() => {
  const DEFAULT_API_BASE = 'https://product-intake.sesquu.workers.dev';
  const KEYS = {
    draft:'productIntake.draft.v2',
    products:'productIntake.products.v2',
    history:'productIntake.history.v2',
    apiBase:'productIntake.apiBase',
    workspaceKey:'productIntake.workspaceKey.v1'
  };

  const safe = (value='') => String(value ?? '').replace(
    /[&<>"']/g,
    char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])
  );

  const CatalogLookup = window.ProductIntakeCatalogLookup;
  const CloudProducts = window.ProductIntakeCloudProducts;
  const IntakeSession = window.ProductIntakeSession;
  const Modal = window.ProductIntakeModal;
  const ProductEditor = window.ProductIntakeProductEditor;
  const ProductList = window.ProductIntakeProductList;
  const SecondaryViews = window.ProductIntakeSecondaryViews;
  const Navigation = window.ProductIntakeNavigation;

  window.ProductIntakePWA?.setup({build:33,label:'v33'});

  function getProducts() {
    return IntakeSession.getProducts();
  }

  function saveDraft() {
    return IntakeSession.saveDraft();
  }

  function addHistory(action, details='') {
    return IntakeSession.addHistory(action, details);
  }

  function compressImage(file) {
    return IntakeSession.compressImage(file);
  }

  function updateQualityPanel() {
    return IntakeSession.updateQualityPanel();
  }

  function openModal(title, html) {
    return Modal.open(title, html);
  }

  function closeModal() {
    return Modal.close();
  }

  function getWorkspaceKey() {
    return CloudProducts.getWorkspaceKey();
  }

  function apiBase() {
    return CloudProducts.apiBase();
  }

  function cloudGetProduct(lpn) {
    return CloudProducts.cloudGetProduct(lpn);
  }

  function cloudSaveProduct(product) {
    return CloudProducts.cloudSaveProduct(product);
  }

  function syncProductsFromCloud(quiet=false) {
    return CloudProducts.syncProductsFromCloud(quiet);
  }

  function ensureVerifiedRealProductsLocal() {
    return CloudProducts.ensureVerifiedRealProductsLocal();
  }

  function initializeCloudProducts() {
    return CloudProducts.initializeCloudProducts();
  }

  function pushVerifiedRealProductsToCloud() {
    return CloudProducts.pushVerifiedRealProductsToCloud();
  }

  function seedRealCatalogProducts(force=false) {
    return CloudProducts.seedRealCatalogProducts(force);
  }

  function setMobileNavActive(name) {
    Navigation?.setActive(name);
  }

  function showProducts() {
    return ProductList.showProducts();
  }

  function showHistory() {
    return SecondaryViews.showHistory();
  }

  function showLocations() {
    return SecondaryViews.showLocations();
  }

  function showIntegrations() {
    return SecondaryViews.showIntegrations();
  }

  function setupSession() {
    IntakeSession?.setup({
      keys:KEYS,
      safe,
      toast,
      catalogLookup:CatalogLookup,
      cloudSaveProduct,
      syncProductsFromCloud,
      openModal,
      showProducts
    });
  }

  function setupCloudProducts() {
    CloudProducts?.setup({
      keys:KEYS,
      defaultApiBase:DEFAULT_API_BASE,
      getProducts,
      addHistory,
      toast
    });
  }

  function setupCatalogLookup() {
    CatalogLookup?.setup({
      keys:KEYS,
      defaultApiBase:DEFAULT_API_BASE,
      safe,
      toast,
      saveDraft,
      addHistory,
      setIdentified:value => {
        if (typeof identified !== 'undefined') identified = Boolean(value);
      },
      quality:updateQualityPanel
    });
  }

  function setupProductEditor() {
    ProductEditor?.setup({
      keys:KEYS,
      safe,
      getProducts,
      apiBase,
      cloudGetProduct,
      cloudSaveProduct,
      openModal,
      setMobileNavActive,
      addHistory,
      toast,
      compressImage
    });
  }

  function setupProductList() {
    ProductList?.setup({
      safe,
      getProducts,
      ensureVerifiedRealProductsLocal,
      seedRealCatalogProducts,
      syncProductsFromCloud,
      openModal,
      setMobileNavActive,
      openProductEditor:lpn => ProductEditor.openProductEditor(lpn)
    });
  }

  function setupSecondaryViews() {
    SecondaryViews?.setup({
      keys:KEYS,
      defaultApiBase:DEFAULT_API_BASE,
      getProducts,
      getWorkspaceKey,
      syncProductsFromCloud,
      openModal,
      setActive:setMobileNavActive
    });
  }

  function setupNavigation() {
    Navigation?.setup({
      closeModal,
      showProducts,
      showIntegrations,
      showLocations,
      showHistory,
      openModal
    });
  }

  function handleAllegroCallback() {
    const params = new URLSearchParams(location.search);
    const allegro = params.get('allegro');
    const reason = params.get('reason');

    if (allegro === 'connected') {
      addHistory('Połączono Allegro','OAuth');
      toast('Konto Allegro połączone.');
      history.replaceState({},'',location.pathname);
      return;
    }

    if (allegro === 'error') {
      toast('Allegro: błąd autoryzacji' + (reason ? ' ('+reason+')' : ''));
      history.replaceState({},'',location.pathname);
    }
  }

  async function boot() {
    setupSession();
    setupCloudProducts();
    setupCatalogLookup();
    setupProductEditor();
    setupProductList();
    setupSecondaryViews();
    setupNavigation();

    IntakeSession.start();

    ensureVerifiedRealProductsLocal();
    await initializeCloudProducts();
    await pushVerifiedRealProductsToCloud();
    await seedRealCatalogProducts();

    addHistory('Otwarto aplikację','Product Intake');
    handleAllegroCallback();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
