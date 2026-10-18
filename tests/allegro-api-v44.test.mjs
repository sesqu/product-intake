import assert from 'node:assert/strict';
import worker from '../worker/src/index.js';
const origin='https://example.workers.dev';
const env={
  ALLEGRO_USER_AGENT:'Product-Intake-test',
  AUTH:{async get(key){
    if(key==='allegro:access_token')return 'mock-access-token';
    if(key==='allegro:expires_at')return String(Date.now()+3600000);
    return null;
  }}
};
const nativeFetch=globalThis.fetch;
const urls=[];
function product(index){
  return {
    id:'catalog-'+index,
    name:'Smartfon Samsung Galaxy S24 SM-S921B wariant '+index,
    category:{id:'smart',name:'Smartfony'},
    parameters:[
      {name:'Marka',valuesLabels:['Samsung'],options:{isTrusted:true}},
      {name:'Model',valuesLabels:['SM-S921B'],options:{isTrusted:true}},
      {name:'Kod producenta',valuesLabels:['SM-S921B'],options:{isTrusted:true}}
    ]
  };
}
try{
  globalThis.fetch=async (url,options)=>{
    const u=new URL(url);
    assert.equal(u.hostname,'api.allegro.pl');
    assert.equal(options.headers.authorization,'Bearer mock-access-token');
    urls.push(u);
    return {ok:true,async json(){return {
      products:Array.from({length:14},(_,i)=>product(i))
    };}};
  };
  const r=await worker.fetch(new Request(origin+'/api/research',{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({query:'Samsung SM-S921B'})
  }),env);
  assert.equal(r.status,200);
  const data=await r.json();
  assert.equal(data.source,'allegro');
  assert.equal(data.provider,'allegro-catalog');
  assert.equal(data.candidates.length,12,'Finder must be offered twelve candidate variants');
  assert.equal(data.searchAttempts.length,2);
  assert.equal(data.searchAttempts[0].foundCount,14);
  assert.equal(data.searchAttempts[1].foundCount,14);
  assert.equal(data.searchAttempts[0].uniqueAdded,14);
  assert.equal(data.searchAttempts[1].uniqueAdded,0);
  assert.equal(data.comparison.phrase.count,14);
  assert.equal(data.comparison.mpn.count,14);
  assert.equal(data.bestFoundBy.mode,'PHRASE');
  assert.equal(urls.length,2);
  assert.equal(urls[1].searchParams.get('phrase'),'SM-S921B');
  assert.equal(urls[1].searchParams.get('mode'),'MPN');
  assert(!Object.keys(data).includes('asin'));
  console.log('PASS Allegro-only API: exact MPN, 12 candidates, three-call budget and provenance.');
}finally{globalThis.fetch=nativeFetch;}