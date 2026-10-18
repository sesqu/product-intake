import assert from 'node:assert/strict';
import worker from '../worker/src/index.js';

const stageUrl='https://product-intake-v44b-staging.sesquu.workers.dev';
const secret='local-stage-integration-test-secret-32bytes';
const env={
  STAGING_ONLY:'1',
  STAGING_API_KEY:secret,
  APP_VERSION:'v44b-staging',
  ALLOWED_ORIGIN:'https://sesqu.github.io',
  AUTH:{
    async get(key){
      if(key==='allegro:access_token') return 'mock-oauth-access';
      if(key==='allegro:expires_at') return String(Date.now()+3600000);
      return null;
    }
  }
};
const part={
  id:'mock-phone-part',name:'Złącze USB-C do Samsung SM-S921B',
  category:{id:'part',name:'Części do telefonów'},
  parameters:[
    {name:'Marka',valuesLabels:['bez marki'],options:{isTrusted:false}},
    {name:'Model',valuesLabels:['SM-S921B'],options:{isTrusted:false}}
  ]
};
const phone={
  id:'mock-phone-main',name:'Smartfon Samsung Galaxy S24 SM-S921B 128 GB',
  category:{id:'smart',name:'Smartfony'},
  parameters:[
    {name:'Marka',valuesLabels:['Samsung'],options:{isTrusted:true}},
    {name:'Model',valuesLabels:['SM-S921B'],options:{isTrusted:true}},
    {name:'Kod producenta',valuesLabels:['SM-S921B'],options:{isTrusted:true}}
  ]
};
const originalFetch=globalThis.fetch;
const calls=[];
try {
  globalThis.fetch=async (url,options={})=>{
    const requestUrl=new URL(String(url));
    assert.equal(requestUrl.hostname,'api.allegro.pl','Worker must request only catalog API');
    assert.equal(options.headers.authorization,'Bearer mock-oauth-access');
    const mode=requestUrl.searchParams.get('mode')||'';
    calls.push({mode,phrase:requestUrl.searchParams.get('phrase')});
    const products=mode==='MPN'?[phone]:[part];
    return {ok:true,status:200,async json(){return {products};}};
  };
  const request=new Request(stageUrl+'/api/research',{
    method:'POST',
    headers:{'content-type':'application/json','x-staging-test-key':secret},
    body:JSON.stringify({query:'SM-S921B'})
  });
  const response=await worker.fetch(request,env);
  assert.equal(response.status,200,'End-to-end staging research must succeed');
  const body=await response.json();
  assert.equal(body.best?.id,'mock-phone-main','Actual phone must outrank spare part');
  assert.equal(body.bestFoundBy?.mode,'MPN','Source provenance must identify the MPN request');
  assert.equal(body.searchAttempts?.length,3,'The entire request plan remains bounded to 3 attempts');
  const mpn=body.searchAttempts.find(x=>x.mode==='MPN');
  assert.equal(mpn?.foundCount,1);
  assert.equal(mpn?.uniqueAdded,1);
  assert.equal(calls.filter(c=>c.mode==='MPN').length,1);
  assert(body.searchAttempts.every(x=>x.foundCount>=0 && x.uniqueAdded>=0));
  console.log('PASS staging API MPN integration: OAuth token, staging key, ranking and source provenance.');
} finally {
  globalThis.fetch=originalFetch;
}
