const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const storage={};
const elements={};
function element(value=''){
  return {value,textContent:'',innerHTML:'',style:{},checked:false,disabled:false,
    listeners:{},addEventListener(type,fn){this.listeners[type]=fn;},
    querySelectorAll(){return []}};
}
for(const key of [
  'productFinderQuery','productFinderBrand','productFinderMpn','productFinderDetails',
  'productFinderResult','productFinderSearch','productFinderDiagnosticsToggle',
  'productFinderAuditList','productFinderAuditCount','productFinderAuditExport',
  'productFinderAuditClear','productFinderRefresh',
  'productFinderDiagnosticOptions','productFinderStagingToggle',
  'productFinderStagingCredentials','productFinderStagingKey'
])elements[key]=element();
elements.productFinderQuery.value='SM-S921B';
elements.productFinderDiagnosticsToggle.checked=true;
const container=elements.productFinderResult;
let cachedHtml='';
let cachedSelectors={};
container.querySelectorAll=(selector)=>{
  if (cachedHtml !== container.innerHTML) {
    cachedHtml=container.innerHTML;
    cachedSelectors={};
  }
  if (cachedSelectors[selector]) return cachedSelectors[selector];
  const attr=selector.match(/^\[([^\]]+)\]$/)?.[1];
  if(!attr)return [];
  const regex=new RegExp(attr+'="([^"]*)"','g');
  const ret=[];let match;
  while((match=regex.exec(container.innerHTML))!==null){
    const button={onclick:null,dataset:{},disabled:false,textContent:''};
    const camel=attr.replace(/^data-/,'').replace(/-([a-z])/g,(_,x)=>x.toUpperCase());
    button.dataset[camel]=match[1].replaceAll('&amp;','&');
    ret.push(button);
  }
  cachedSelectors[selector]=ret;
  return ret;
};
let payload={
  best:{id:'main',name:'Samsung Galaxy S24 SM-S921B',model:'SM-S921B',score:88},
  candidates:[
    {id:'main',name:'Samsung Galaxy S24 SM-S921B',model:'SM-S921B',score:88},
    {id:'other',name:'Złącze do SM-S921B',model:'SM-S921B',score:18}
  ],
  searchAttempts:[
    {mode:'',phrase:'SM-S921B',foundCount:30,uniqueAdded:30},
    {mode:'MPN',phrase:'SM-S921B',foundCount:2,uniqueAdded:1}
  ],
  comparison:{
    phrase:{count:30,best:{id:'other',name:'Złącze do SM-S921B',score:18}},
    mpn:{count:2,best:{id:'main',name:'Samsung Galaxy S24 SM-S921B',score:88}}
  },
  bestFoundBy:{mode:'MPN'},
  requiresTesterChoice:true
};
let clipboard='';
let requestLog=[];
const context={
  window:{},document:{
    getElementById:id=>elements[id]||null,
    querySelectorAll:()=>[]
  },
  localStorage:{
    getItem:k=>storage[k]??null,
    setItem:(k,v)=>{storage[k]=v},
    removeItem:k=>{delete storage[k]}
  },
  navigator:{clipboard:{async writeText(v){clipboard=v}}},
  confirm:()=>true,
  Date,Math,URLSearchParams,setTimeout,
  fetch:async(url,opts={})=>{
    requestLog.push({url,opts});
    return {ok:true,async json(){return payload;}};
  }
};
vm.runInNewContext(fs.readFileSync('product-finder.js','utf8'),context);
let toasts=[];
const finder=context.window.ProductIntakeProductFinder;
finder.setup({safe:escapeHtml,apiBase:()=> 'https://test.invalid',toast:m=>toasts.push(m),catalogLookup:{}});
(async()=>{
  await finder.runSearch({force:true});
  assert(container.innerHTML.includes('Tryb MPN'),'comparison card must render');
  assert(container.innerHTML.includes('Wyszukiwanie frazowe'),'phrase card must render');
  assert(container.innerHTML.includes('Potwierdź: Samsung'),'manual selection button must render');
  const buttons=container.querySelectorAll('[data-finder-verify]');
  assert.equal(buttons.length,2);
  buttons[1].onclick();
  let history=JSON.parse(storage['productIntake.finderAudit.v1']);
  assert.equal(history[0].verdict,'other','second candidate should not be top1');
  assert.equal(history[0].chosen.id,'other');
  assert.equal(elements.productFinderAuditCount.textContent,'1');
  assert.equal(history[0].attempts[1].mode,'MPN');
  assert.equal(history[0].comparison.mpn.count,2);
  assert(elements.productFinderAuditList.innerHTML.includes('Poprawny inny kandydat'));

  container.querySelectorAll('[data-finder-verify]')[0].onclick();
  history=JSON.parse(storage['productIntake.finderAudit.v1']);
  assert.equal(history[0].verdict,'top1');
  container.querySelectorAll('[data-finder-verdict]')[0].onclick();
  history=JSON.parse(storage['productIntake.finderAudit.v1']);
  assert.equal(history[0].verdict,'missing');
  assert.equal(elements.productFinderAuditCount.textContent,'3');
  await elements.productFinderAuditExport.onclick();
  const report=JSON.parse(clipboard);
  assert.equal(report.tests.length,3);
  assert.equal(report.storage,'local-only');
  assert.equal(report.tests[2].verdict,'other');
  elements.productFinderAuditClear.onclick();
  assert.equal(JSON.parse(storage['productIntake.finderAudit.v1']||'[]').length,0);
  assert.equal(elements.productFinderAuditCount.textContent,'0');

  payload={best:null,candidates:[],searchAttempts:[],comparison:{
    phrase:{count:0,best:null},mpn:{count:0,best:null}
  }};
  await finder.runSearch({force:true});
  assert(container.innerHTML.includes('Nie ma właściwego produktu'));
  assert.equal(container.querySelectorAll('[data-finder-verdict]').length,2);
  container.querySelectorAll('[data-finder-verdict]')[0].onclick();
  history=JSON.parse(storage['productIntake.finderAudit.v1']);
  assert.equal(history[0].verdict,'missing');
  assert.equal(history[0].best,null);

  elements.productFinderDiagnosticsToggle.checked=false;
  await finder.runSearch({force:true});
  assert(!container.innerHTML.includes('Test identyfikacji produktu'));
  assert.equal(elements.productFinderAuditCount.textContent,'1');

  // Switch to the independent staging Worker INSIDE the same Finder.
  elements.productFinderDiagnosticsToggle.checked=true;
  elements.productFinderDiagnosticsToggle.listeners.change();
  elements.productFinderStagingToggle.checked=true;
  elements.productFinderStagingToggle.listeners.change();
  assert.equal(elements.productFinderStagingCredentials.style.display,'block');
  elements.productFinderStagingKey.value='test-stage-key-only-in-browser-123456';
  payload={
    best:{id:'stage-main',name:'Telefon z testowego Allegro',score:91},
    candidates:[{id:'stage-main',name:'Telefon z testowego Allegro',score:91}],
    comparison:{
      phrase:{count:7,best:{name:'Akcesorium frazowe',score:12}},
      mpn:{count:1,best:{name:'Telefon z testowego Allegro',score:91}}
    },
    requiresTesterChoice:true
  };
  await finder.runSearch({force:true});
  const last=requestLog[requestLog.length-1];
  assert.equal(last.url,'https://product-intake-v44b-staging.sesquu.workers.dev/api/research');
  assert.equal(last.opts.headers['x-staging-test-key'],'test-stage-key-only-in-browser-123456');
  assert(container.innerHTML.includes('Wyniki z odizolowanego stagingu'));
  assert(!container.innerHTML.includes('data-finder-use='),
    'Staging candidates must not be imported to the master');
  assert(!container.innerHTML.includes('data-finder-description='),
    'Staging candidates must not enter the normal description path');
  assert(!JSON.stringify(storage).includes('test-stage-key-only-in-browser-123456'),
    'Staging API key must never enter local cache or history');
  assert.equal(container.querySelectorAll('[data-finder-verify]').length,1);
  container.querySelectorAll('[data-finder-verify]')[0].onclick();
  assert(!JSON.stringify(storage).includes('test-stage-key-only-in-browser-123456'));

  elements.productFinderStagingToggle.checked=false;
  elements.productFinderStagingToggle.listeners.change();
  assert.equal(elements.productFinderStagingKey.value,'','Stage key must clear on exit');
  assert.equal(elements.productFinderStagingCredentials.style.display,'none');
  assert(!container.innerHTML.includes('Telefon z testowego Allegro'));
  payload={best:{id:'normal',name:'Produkt ze zwykłego API'},candidates:[]};
  await finder.runSearch({force:true});
  const normalCall=requestLog[requestLog.length-1];
  assert.equal(normalCall.url,'https://example.invalid/api/research');
  assert(!('x-staging-test-key' in normalCall.opts.headers));
  assert(container.innerHTML.includes('data-finder-use='));
  console.log('PASS integrated Finder: local diagnostics, stage isolation, browser-only key and master protection.');
})().catch(e=>{console.error(e);process.exitCode=1;});