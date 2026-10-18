const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const box={innerHTML:'',style:{display:'none'},querySelectorAll(){return []}};
const extra={style:{display:'none'}};
const more={onclick:null,textContent:''};
const elements={
  productFinderQuery:{value:'Samsung SM-S921B',addEventListener(){}},
  productFinderBrand:{value:''},
  productFinderMpn:{value:''},
  productFinderDetails:{value:''},
  productFinderSearch:{onclick:null},
  productFinderResult:box,
  productFinderRefresh:{onclick:null},
  productFinderMoreCandidates:more,
  productFinderExtraCandidates:extra
};
const escapeHtml=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const storage={
  'productIntake.finderCache.v1':JSON.stringify({old:{savedAt:Date.now(),data:{best:{name:'outdated v43'}}}})
};
let searches=0;
let result={
  best:{id:'main',name:'Smartfon Samsung Galaxy S24',model:'SM-S921B',score:94},
  candidates:Array.from({length:12},(_,i)=>({
    id:i===0?'main':'variant-'+i,
    name:i===0?'Smartfon Samsung Galaxy S24':'Wariant Samsung SM-S921B '+i,
    model:'SM-S921B',score:94-i
  })),
  searchAttempts:[
    {phrase:'Samsung SM-S921B',mode:'',page:1,foundCount:30,uniqueAdded:30},
    {phrase:'SM-S921B',mode:'MPN',page:1,foundCount:30,uniqueAdded:15},
    {phrase:'SM-S921B',mode:'MPN',page:2,foundCount:1,uniqueAdded:1}
  ],
  bestFoundBy:{mode:'MPN',reason:'mpn-page'},
  comparison:{
    phrase:{best:{name:'Złącze zamienne'},count:30},
    mpn:{best:{name:'Smartfon Samsung Galaxy S24'},count:31}
  },
  requiresTesterChoice:true
};
const ctx={
  window:{},
  document:{
    getElementById(id){return elements[id]||null},
    querySelectorAll(){return []}
  },
  localStorage:{
    getItem(k){return storage[k]||null},
    setItem(k,v){storage[k]=v}
  },
  Date,URLSearchParams,setTimeout,
  fetch:async()=>({ok:true,async json(){searches++;return result;}})
};
vm.runInNewContext(fs.readFileSync('product-finder.js','utf8'),ctx);
ctx.window.ProductIntakeProductFinder.setup({
  safe:escapeHtml,apiBase:()=> 'https://example.test',
  toast(){},catalogLookup:{}
});
(async()=>{
  await ctx.window.ProductIntakeProductFinder.runSearch();
  assert.equal(searches,1,'v43 cache cannot block new Allegro search');
  assert(box.innerHTML.includes('Pokaż pozostałe propozycje (7)'));
  assert(box.innerHTML.includes('Wyniki: 30 · nowe: 30'));
  assert(box.innerHTML.includes('MPN · strona 2'));
  assert(box.innerHTML.includes('Źródło TOP 1: MPN (kolejna strona)'));
  assert(box.innerHTML.includes('Najlepszy z frazy: Złącze zamienne'));
  assert(box.innerHTML.includes('Wariant Samsung SM-S921B 11'));
  assert.equal(extra.style.display,'none');
  more.onclick();assert.equal(extra.style.display,'grid');
  more.onclick();assert.equal(extra.style.display,'none');
  result={
    candidates:[],
    searchAttempts:[{phrase:'<img src=x onerror=alert(1)>',mode:'MPN',error:'<script>alert(1)</script>'}]
  };
  await ctx.window.ProductIntakeProductFinder.runSearch({force:true});
  assert(box.innerHTML.includes('Nie znaleziono produktu'));
  assert(box.innerHTML.includes('&lt;img'));
  assert(box.innerHTML.includes('&lt;script'));
  assert(!box.innerHTML.includes('<img'));
  assert(!box.innerHTML.includes('<script'));
  console.log('PASS Finder Allegro: new cache, MPN page provenance, safe output, 12 candidates.');
})().catch(error=>{console.error(error);process.exitCode=1;});