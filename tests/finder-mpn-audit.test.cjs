const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const resultBox = {
  innerHTML:'',
  style:{display:'none'},
  querySelectorAll(){return [];}
};
const searchButton = {};
const refreshButton = {};
const queryInput = {value:'SM-S921B', addEventListener(){}};
const elements = {
  productFinderSearch:searchButton,
  productFinderQuery:queryInput,
  productFinderResult:resultBox,
  productFinderRefresh:refreshButton,
  productFinderBrand:{value:''},
  productFinderMpn:{value:''},
  productFinderDetails:{value:''}
};
const escapeHtml = text=>String(text??'')
  .replaceAll('&','&amp;')
  .replaceAll('<','&lt;')
  .replaceAll('>','&gt;')
  .replaceAll('"','&quot;')
  .replaceAll("'",'&#39;');
const win = {};
let payload;
let calls=0;
const storage={};
const context = {
  window:win,
  document:{
    getElementById(id){return elements[id]||null;},
    querySelectorAll(){return []}
  },
  localStorage:{
    getItem(key){return storage[key]||null},
    setItem(key,value){storage[key]=value}
  },
  URLSearchParams,
  setTimeout,
  fetch:async()=>({
    ok:true,
    async json(){calls++; return payload;}
  })
};
vm.runInNewContext(fs.readFileSync('product-finder.js','utf8'),context);
assert(win.ProductIntakeProductFinder);
win.ProductIntakeProductFinder.setup({
  safe:escapeHtml,
  apiBase:()=> 'https://example.invalid',
  toast(){},
  catalogLookup:{}
});
payload = {
  best:{id:'phone-main',name:'Smartfon Samsung Galaxy S24',brand:'Samsung',model:'SM-S921B',mpn:'SM-S921B',score:85},
  candidates:[{id:'phone-main',name:'Smartfon Samsung Galaxy S24',brand:'Samsung',model:'SM-S921B',mpn:'SM-S921B',score:85}],
  searchAttempts:[
    {phrase:'SM-S921B',mode:'',reason:'primary',foundCount:30,uniqueAdded:30},
    {phrase:'SM-S921B',mode:'MPN',reason:'mpn',foundCount:1,uniqueAdded:1}
  ],
  queriesUsed:['SM-S921B','SM-S921B [MPN]'],
  bestFoundBy:{mode:'MPN',reason:'mpn',attempt:2},
  requiresTesterChoice:true
};
(async()=>{
  await win.ProductIntakeProductFinder.runSearch({force:true});
  assert.equal(calls,1);
  assert(resultBox.innerHTML.includes('Szczegóły wyszukiwania'));
  assert(resultBox.innerHTML.includes('sprawdzono MPN'));
  assert(resultBox.innerHTML.includes('Wyniki: 30 · nowe: 30'));
  assert(resultBox.innerHTML.includes('Wyniki: 1 · nowe: 1'));
  assert(resultBox.innerHTML.includes('Źródło pierwszego odnalezienia'));
  assert(resultBox.innerHTML.includes('fizycznym produktem'));
  assert(resultBox.innerHTML.includes('Wyniki są niejednoznaczne'));

  payload={
    candidates:[],
    searchAttempts:[
      {phrase:'<img src=x onerror=alert(1)>',mode:'MPN',foundCount:0,uniqueAdded:0,error:'<script>alert(1)</script>'}
    ]
  };
  await win.ProductIntakeProductFinder.runSearch({force:true});
  assert(resultBox.innerHTML.includes('Szczegóły wyszukiwania'));
  assert(resultBox.innerHTML.includes('Nie znaleziono produktu'));
  assert(resultBox.innerHTML.includes('&lt;img'));
  assert(resultBox.innerHTML.includes('&lt;script'));
  assert(!resultBox.innerHTML.includes('<img'));
  assert(!resultBox.innerHTML.includes('<script'));
  console.log('PASS Finder audit: per-attempt MPN diagnostics, manual-review note, empty results and escaping.');
})().catch(error=>{console.error(error);process.exitCode=1;});
