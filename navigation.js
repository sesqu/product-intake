(() => {
  let actions = null;

  function setActive(name) {
    const nav = document.getElementById('mobileNav');
    if (!nav) return;
    nav.querySelectorAll('button[data-act]').forEach(button => {
      const active = button.dataset.act === name;
      button.classList.toggle('primaryMobile', active);
      button.setAttribute('aria-current', active ? 'page' : 'false');
    });
  }

  function showMore() {
    setActive('more');
    actions.openModal(
      'Więcej',
      '<div style="display:grid;gap:8px">'+
      '<button id="mLocations" class="btn">Lokalizacje</button>'+
      '<button id="mHistory" class="btn">Historia</button>'+
      '<button id="mSettings" class="btn">Ustawienia</button>'+
      '</div>'
    );

    document.getElementById('mLocations').onclick = actions.showLocations;
    document.getElementById('mHistory').onclick = actions.showHistory;
    document.getElementById('mSettings').onclick = () => {
      setActive('more');
      actions.openModal(
        'Ustawienia',
        '<div style="color:#919baa">Ustawienia aplikacji będziemy rozwijać w kolejnych iteracjach.</div>'
      );
    };
  }

  function ensureMobileNav() {
    if (document.getElementById('mobileNav')) return;

    const style = document.createElement('style');
    style.id = 'piNavigationStyles';
    style.textContent = `
      #toast{z-index:2200}
      #mobileNav{display:none}
      @media(max-width:1150px){
        #mobileNav{
          position:fixed;
          left:8px;right:8px;
          bottom:calc(8px + env(safe-area-inset-bottom,0px));
          z-index:1800;
          display:grid;
          grid-template-columns:repeat(4,1fr);
          gap:6px;
          padding:7px;
          background:rgba(13,16,20,.97);
          backdrop-filter:blur(18px);
          -webkit-backdrop-filter:blur(18px);
          border:1px solid #303945;
          border-radius:16px;
          box-shadow:0 18px 48px rgba(0,0,0,.48)
        }
        #mobileNav button{
          min-height:46px;
          border:0;
          background:transparent;
          color:#aeb6c1;
          padding:10px 5px;
          border-radius:11px;
          font-size:12px;
          line-height:1;
          font-weight:720;
          letter-spacing:.01em;
          transition:background .15s,color .15s,transform .15s
        }
        #mobileNav button:active{transform:scale(.98)}
        #mobileNav button.primaryMobile{
          background:#1a2640;
          color:#fff;
          box-shadow:inset 0 0 0 1px rgba(127,156,255,.12)
        }
        body{padding-bottom:calc(88px + env(safe-area-inset-bottom,0px))}
        #piModalCard:not(.pi-editor-card){
          padding-bottom:calc(96px + env(safe-area-inset-bottom,0px))!important
        }
        #toast{
          bottom:calc(96px + env(safe-area-inset-bottom,0px));
          left:14px;right:14px;text-align:center
        }
      }
    `;
    document.head.appendChild(style);

    const nav = document.createElement('div');
    nav.id = 'mobileNav';
    nav.setAttribute('role','navigation');
    nav.setAttribute('aria-label','Główna nawigacja');
    nav.innerHTML = `
      <button class="primaryMobile" data-act="add" aria-current="page">Dodaj</button>
      <button data-act="products">Produkty</button>
      <button data-act="integrations">Integracje</button>
      <button data-act="more">Więcej</button>
    `;
    document.body.appendChild(nav);

    nav.querySelector('[data-act="add"]').onclick = () => {
      actions.closeModal();
      setActive('add');
      window.scrollTo({top:0,behavior:'smooth'});
    };
    nav.querySelector('[data-act="products"]').onclick = () => {
      setActive('products');
      actions.showProducts();
    };
    nav.querySelector('[data-act="integrations"]').onclick = () => {
      setActive('integrations');
      actions.showIntegrations();
    };
    nav.querySelector('[data-act="more"]').onclick = showMore;
  }

  function setupDesktopNav() {
    const navs = [...document.querySelectorAll('.nav')];
    if (navs[1]) navs[1].onclick = actions.showProducts;
    if (navs[2]) navs[2].onclick = actions.showLocations;
    if (navs[3]) navs[3].onclick = actions.showHistory;

    if (navs[4] && !document.querySelector('.nav[data-integrations="true"]')) {
      const integrations = navs[4].cloneNode(true);
      integrations.textContent = 'Integracje';
      integrations.dataset.integrations = 'true';
      navs[4].parentNode.insertBefore(integrations, navs[4]);
      integrations.onclick = actions.showIntegrations;
      navs[4].onclick = () => actions.openModal(
        'Ustawienia',
        '<div style="color:#919baa">Ustawienia aplikacji będziemy rozwijać w kolejnych iteracjach.</div>'
      );
    }
  }

  function setup(nextActions) {
    if (actions) return;
    actions = nextActions;
    ensureMobileNav();
    setupDesktopNav();
  }

  window.ProductIntakeNavigation = { setup, setActive };
})();
