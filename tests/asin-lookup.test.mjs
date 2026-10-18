import assert from 'node:assert/strict';
import {validateAsin,validateAmazonDomain,mapSerpApiAsinResponse,lookupAsinWithSerpApi} from '../worker/src/asin-lookup.js';
import worker from '../worker/src/index.js';
assert.equal(validateAsin(' b072mq5brx '),'B072MQ5BRX');
assert.throws(()=>validateAsin('B072MQ5BRXX'),/10 znaków/);
assert.throws(()=>validateAsin('"><script>'),/10 znaków/);
assert.equal(validateAmazonDomain('amazon.pl'),'amazon.pl');
assert.throws(()=>validateAmazonDomain('evil.example'),/Obsługiwane sklepy/);

const response={
  search_metadata:{status:'Success'},
  product_results:{
    asin:'B072MQ5BRX',
    title:'Zestaw testowy Samsung 128 GB',
    brand:'Brand: Samsung',
    description:'Opis testowy',
    thumbnails:['https://m.media-amazon.com/images/test.jpg'],
    categories:[{name:'Elektronika'},{name:'Smartfony'}],
  },
  product_details:{
    asin:'B072MQ5BRX',
    manufacturer:'Samsung',
    item_model_number:'SM-S921B'
  },
  item_specifications:{color:'Czarny',capacity:'128 GB',brand:'Samsung'}
};
const mapped=mapSerpApiAsinResponse(response,'B072MQ5BRX','amazon.pl');
assert.equal(mapped.product.asin,'B072MQ5BRX');
assert.equal(mapped.product.brand,'Samsung');
assert.equal(mapped.product.model,'SM-S921B');
assert.equal(mapped.product.ean,'','Never infer EAN');
assert.equal(mapped.product.score,null,'ASIN is not a confidence percentage');
assert.equal(mapped.product.category,'Smartfony');
assert.equal(mapped.product.url,'https://www.amazon.pl/dp/B072MQ5BRX');
assert(mapped.product.parameters.find(x=>x.name==='capacity'&&x.value==='128 GB'));
assert.equal(mapped.product.asinMatched,true);
assert.equal(mapSerpApiAsinResponse({...response,product_results:{...response.product_results,asin:'B072MQ5BRZ'}},'B072MQ5BRX','amazon.pl').product,null);
const withoutAsin=mapSerpApiAsinResponse({...response,product_results:{...response.product_results,asin:''},product_details:{}},'B072MQ5BRX','amazon.pl');
assert.equal(withoutAsin.product.asinMatched,false);
assert(withoutAsin.product.warnings.length>0);
let count=0;
const store=new Map();
const kv={
  async get(key){return JSON.parse(store.get(key)||'null');},
  async put(key,value){store.set(key,value);}
};
const key='private-serpapi-secret-key-test';
const originalFetch=globalThis.fetch;
try{
  globalThis.fetch=async (url,opts)=>{
    const target=new URL(url);
    assert.equal(target.origin,'https://serpapi.com');
    assert.equal(target.pathname,'/search.json');
    assert.equal(target.searchParams.get('engine'),'amazon_product');
    assert.equal(target.searchParams.get('asin'),'B072MQ5BRX');
    assert.equal(target.searchParams.get('amazon_domain'),'amazon.pl');
    assert.equal(target.searchParams.get('language'),'pl_PL');
    assert.equal(target.searchParams.get('api_key'),key);
    count++;
    return {ok:true,status:200,async json(){return response;}};
  };
  const first=await lookupAsinWithSerpApi({asin:'b072mq5brx',apiKey:key,kv});
  assert.equal(first.cached,false);
  const second=await lookupAsinWithSerpApi({asin:'B072MQ5BRX',apiKey:key,kv});
  assert.equal(second.cached,true);
  assert.equal(count,1,'Cache avoids wasting free calls');
  assert(!JSON.stringify(first).includes(key),'Secret must never leak into response');
  assert(!JSON.stringify([...store.values()]).includes(key),'Secret must never leak into KV');
  assert.equal(first.product.source,'amazon');
  assert.equal(store.size,1);
  const missing=await worker.fetch(new Request('https://test.example/api/asin?asin=B072MQ5BRX'),{
    AUTH:kv,
    SERPAPI_API_KEY:key,
    APP_VERSION:'v44b'
  });
  assert.equal(missing.status,200);
  const data=await missing.json();
  assert.equal(data.source,'amazon');
  assert.equal(data.best.asin,'B072MQ5BRX');
  assert.equal(data.requiresTesterChoice,true);
  assert.equal(data.confidence,null);
  assert.equal(data.cached,true);
  assert(!JSON.stringify(data).includes(key),'Worker response must not leak secret');
  const noSecret=await worker.fetch(new Request('https://test.example/api/asin?asin=B072MQ5BRX'),{AUTH:kv});
  assert.equal(noSecret.status,503);
  const bad=await worker.fetch(new Request('https://test.example/api/asin?asin=wrong'),{AUTH:kv,SERPAPI_API_KEY:key});
  assert.equal(bad.status,400);
  assert.equal(count,1,'Invalid ASIN must not consume credits');
  const domain=await worker.fetch(new Request('https://test.example/api/asin?asin=B072MQ5BRX&domain=amazon.ru'),{AUTH:kv,SERPAPI_API_KEY:key});
  assert.equal(domain.status,400);
  assert.equal(count,1,'Unapproved domain must not invoke third-party network');
  console.log('PASS SerpApi ASIN: validation, PL lookup, source provenance, KV cache, no key leak, Worker API.');
}finally{
  globalThis.fetch=originalFetch;
}