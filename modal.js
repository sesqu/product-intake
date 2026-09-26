(() => {
  const $ = id => document.getElementById(id);

  function make() {
    let modal = $('piModal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'piModal';
    modal.style.cssText =
      'position:fixed;inset:0;z-index:1000;background:rgba(4,6,9,.72);'+
      'backdrop-filter:blur(8px);display:none;padding:18px;overflow:auto';

    modal.innerHTML =
      '<div id="piModalCard" style="max-width:1120px;margin:2vh auto;background:#11161c;'+
      'border:1px solid #2a323c;border-radius:16px;box-shadow:0 24px 80px rgba(0,0,0,.45);overflow:hidden">'+
        '<div class="pi-modal-header" style="display:flex;justify-content:space-between;align-items:center;'+
        'padding:16px 18px;border-bottom:1px solid #252c35;position:sticky;top:0;background:#11161c;z-index:20">'+
          '<b id="piModalTitle"></b>'+
          '<button id="piModalClose" class="btn">Zamknij</button>'+
        '</div>'+
        '<div id="piModalBody" style="padding:18px"></div>'+
      '</div>';

    document.body.appendChild(modal);
    $('piModalClose').onclick = close;
    modal.addEventListener('click', event => {
      if (event.target === modal) close();
    });

    return modal;
  }

  function close() {
    const modal = $('piModal');
    if (modal) modal.style.display = 'none';
    $('piModalCard')?.classList.remove('pi-editor-card');
    document.body.classList.remove('pi-editor-open');
  }

  function open(title, html) {
    document.body.classList.remove('pi-editor-open');
    const modal = make();
    $('piModalCard')?.classList.remove('pi-editor-card');
    $('piModalTitle').textContent = title;
    $('piModalBody').innerHTML = html;
    modal.style.display = 'block';
  }

  window.ProductIntakeModal = {open,close};
})();
