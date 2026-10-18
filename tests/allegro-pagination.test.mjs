import assert from 'node:assert/strict';
import {searchAllegroForResearch} from '../worker/src/research-allegro.js';
import {mapAllegroResearchProduct,buildResearchResult} from '../worker/src/product-research.js';

const rawPhone={
  id:'samsung-main',
  name:'Smartfon Samsung Galaxy S24 SM-S921B 128 GB',
  category:{id:'smart',name:'Smartfony'},
  parameters:[
    {name:'Marka',valuesLabels:['Samsung'],options:{isTrusted:true}},
    {name:'Model',valuesLabels:['SM-S921B'],options:{isTrusted:true}},
    {name:'Kod producenta',valuesLabels:['SM-S921B'],options:{isTrusted:true}}
  ]
};
const port=(id)=>({
  id,name:'Złącze USB-C część zamienna do Samsung SM-S921B',
  category:{id:'parts',name:'Części do telefonów'},
  parameters:[{name:'Model',valuesLabels:['SM-S921B'],options:{isTrusted:false}}]
});
const requestLog=[];
const nativeFetch=globalThis.fetch;
try {
  globalThis.fetch=async url=>{
    const target=new URL(url);
    requestLog.push({
      phrase:target.searchParams.get('phrase'),
      mode:target.searchParams.get('mode')||'',
      cursor:target.searchParams.get('page.id')
    });
    assert.equal(target.hostname,'api.allegro.pl');
    const mode=target.searchParams.get('mode')||'';
    const cursor=target.searchParams.get('page.id');
    const products=cursor ? [rawPhone] : Array.from({length:30},(_,i)=>port(mode+'-part-'+i));
    return {
      ok:true,
      async json(){return {products,nextPage:cursor?null:{id:'next-mpn-page-2'}};}
    };
  };
  const result=await searchAllegroForResearch({
    token:'test',input:{query:'SM-S921B'}
  });
  assert.equal(requestLog.length,3,'Search must not exceed 3 real Allegro calls');
  assert.equal(requestLog[2].cursor,'next-mpn-page-2');
  assert.equal(requestLog[2].mode,'MPN','Prefer specific MPN page 2 over guessing more phrases');
  assert.equal(result.searchAttempts[2].page,2);
  assert.equal(result.searchAttempts[2].reason,'mpn-page');
  assert.equal(result.searchAttempts[2].uniqueAdded,1);
  assert.equal(result.firstSeenById?.['samsung-main']?.mode,'MPN');
  assert.deepEqual(result.foundModesById['samsung-main'],['MPN']);
  assert(result.products.length>60,'Include product past the first 30 MPN results');
  const ranked=buildResearchResult(result.products.map(mapAllegroResearchProduct),{query:'SM-S921B'});
  assert.equal(ranked.selected?.id,'samsung-main','Complete product on second page must beat compatible parts');

  // Structured brand + model previously used request #3 on a redundant
  // short phrase, preventing page 2 of the exact MPN search from being read.
  requestLog.length=0;
  globalThis.fetch=async url=>{
    const target=new URL(url);
    const mode=target.searchParams.get('mode')||'';
    const phrase=target.searchParams.get('phrase');
    const cursor=target.searchParams.get('page.id');
    requestLog.push({phrase,mode,cursor});
    const parts=Array.from({length:30},(_,i)=>port('structured-'+mode+'-'+i));
    return {ok:true,async json(){
      return {
        products:cursor?[rawPhone]:parts,
        nextPage:mode==='MPN'&&!cursor?{id:'structured-mpn-page-two'}:null
      };
    }};
  };
  const structured=await searchAllegroForResearch({
    token:'test',input:{brand:'Samsung',model:'SM-S921B'}
  });
  assert.deepEqual(requestLog.map(x=>x.mode),['','MPN','MPN'],
    'With strong evidence only of accessories, third call must use second MPN page');
  assert.equal(requestLog[2].cursor,'structured-mpn-page-two');
  assert(!requestLog.some(x=>x.phrase==='SM-S921B' && x.mode===''),
    'Avoid wasting the last request on the old shorter phrase fallback');
  assert(structured.products.some(x=>x.id==='samsung-main'));
  assert.equal(structured.searchAttempts[2].reason,'mpn-page');

  requestLog.length=0;
  globalThis.fetch=async url=>{
    const target=new URL(url);
    const mode=target.searchParams.get('mode')||'';
    const cursor=target.searchParams.get('page.id');
    requestLog.push({mode,cursor});
    const products=mode==='MPN'?Array.from({length:30},(_,i)=>port('mpn-'+i)):[rawPhone];
    return {ok:true,async json(){return {products,nextPage:{id:'unnecessary-page'}};}};
  };
  const strong=await searchAllegroForResearch({token:'test',input:{query:'SM-S921B'}});
  assert(strong.products.some(p=>p.id==='samsung-main'));
  assert(!requestLog.some(x=>x.cursor),'Do not spend paging calls when strong full device already exists');

  requestLog.length=0;
  const wrongPhone={
    ...rawPhone,id:'samsung-wrong',
    name:'Smartfon Samsung Galaxy S24 Ultra SM-S928B 256 GB',
    parameters:rawPhone.parameters.map(x=>
      x.name==='Model'||x.name==='Kod producenta'
        ? {...x,valuesLabels:['SM-S928B']}
        : x
    )
  };
  globalThis.fetch=async url=>{
    const target=new URL(url);
    const mode=target.searchParams.get('mode')||'';
    const cursor=target.searchParams.get('page.id');
    requestLog.push({mode,cursor});
    return {ok:true,async json(){return {
      products:cursor?[rawPhone]:[wrongPhone],
      nextPage:cursor?null:{id:'exact-variant-on-page-2'}
    };}};
  };
  const variantResult=await searchAllegroForResearch({
    token:'test',input:{query:'SM-S921B'}
  });
  assert(requestLog.some(x=>x.cursor==='exact-variant-on-page-2'),
    'A high-scoring but different model must not block exact MPN page 2');
  assert(variantResult.products.some(x=>x.id==='samsung-main'));
  assert(requestLog.length<=3);

  requestLog.length=0;
  const vacuumAccessory=i=>({
    id:'filter-'+i,name:'Filtr zamienny do odkurzacza bezprzewodowego',
    category:{name:'Akcesoria do odkurzaczy'},parameters:[]
  });
  const vacuum={id:'vacuum-main',name:'Odkurzacz bezprzewodowy',
    category:{name:'Odkurzacze pionowe'},parameters:[]};
  globalThis.fetch=async url=>{
    const target=new URL(url);const cursor=target.searchParams.get('page.id');
    requestLog.push({mode:target.searchParams.get('mode'),cursor});
    return {ok:true,async json(){
      return {products:cursor?[vacuum]:Array.from({length:30},(_,i)=>vacuumAccessory(i)),
        nextPage:cursor?null:{id:'vacuum-second-page'}};
    }};
  };
  const phrase=await searchAllegroForResearch({
    token:'test',input:{query:'odkurzacz bezprzewodowy'}
  });
  assert(requestLog.some(x=>x.cursor==='vacuum-second-page'),
    'Without a credible primary device, retrieve page 2 of ordinary catalog search');
  assert(phrase.products.some(p=>p.id==='vacuum-main'));
  assert(requestLog.length<=3);
  console.log('PASS Allegro cursor pagination: MPN rescue, skip wasted calls, ordinary phrase rescue, 3-call budget.');
}finally{
  globalThis.fetch=nativeFetch;
}