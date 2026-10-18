import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import worker from '../worker/src/index.js';

const root = new URL('../worker/',import.meta.url);
const production = JSON.parse(readFileSync(new URL('wrangler.jsonc',root),'utf8'));
const stage = JSON.parse(readFileSync(new URL('wrangler.staging.jsonc',root),'utf8'));

assert.equal(stage.name,'product-intake-v44b-staging');
assert.notEqual(stage.name,production.name,'Staging can never deploy under the production Worker name');
assert.equal(stage.main,'src/index.js');
assert.equal(stage.workers_dev,true);
assert.equal(stage.vars.STAGING_ONLY,'1');
assert.equal(stage.vars.APP_VERSION,'v44b-staging');
assert(!stage.route && !stage.routes,'Staging must not use production/custom routes');
assert.equal(
  stage.vars.ALLEGRO_REDIRECT_URI,
  'https://product-intake-v44b-staging.sesquu.workers.dev/api/allegro/callback'
);
assert.notEqual(stage.vars.ALLEGRO_REDIRECT_URI,production.vars.ALLEGRO_REDIRECT_URI);
assert(!('ALLEGRO_CLIENT_ID' in stage.vars),'Staging OAuth client ID must be a secret');
assert(!('ALLEGRO_CLIENT_SECRET' in stage.vars),'Client secret must not be in config');
assert(!('STAGING_API_KEY' in stage.vars),'Staging API key must not be in config');
assert.equal(stage.kv_namespaces.length,1);
assert.equal(stage.kv_namespaces[0].binding,'AUTH');
assert.notEqual(stage.kv_namespaces[0].id,production.kv_namespaces[0].id,
  'Staging must have a separate KV namespace');
const stageClientId=process.env.V44B_STAGING_ALLEGRO_CLIENT_ID;
if(stageClientId){
  assert.notEqual(stageClientId,production.vars.ALLEGRO_CLIENT_ID,
    'Staging must have its own Allegro application');
}
const origin='https://product-intake-v44b-staging.sesquu.workers.dev';
const fakeKv={async get(){return null;}};
const env={
  ...stage.vars,
  AUTH:fakeKv,
  STAGING_API_KEY:'this-is-a-separate-strong-staging-key-for-tests'
};
function req(path,init){return new Request(origin+path,init);}
const health=await worker.fetch(req('/health'),env);
assert.equal(health.status,200);
const body=await health.json();
assert.equal(body.environment,'staging');
assert.equal(body.appVersion,'v44b-staging');
assert.equal(body.allegro.connected,false);

const anonymous=await worker.fetch(req('/api/research',{
  method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({query:'SM-S921B'})
}),env);
assert.equal(anonymous.status,401,'Staging API must refuse requests without a key');
const invalidKey=await worker.fetch(req('/api/allegro/auth-url',{
  headers:{'x-staging-test-key':'wrong'}
}),env);
assert.equal(invalidKey.status,401,'OAuth URL generation must also be protected');
const missingKey=await worker.fetch(req('/api/research',{
  method:'POST',headers:{'x-staging-test-key':'x'},
  body:JSON.stringify({query:'SM-S921B'})
}),{...env,STAGING_API_KEY:''});
assert.equal(missingKey.status,503,'Never silently disable the staging key guard');
const callback=await worker.fetch(req('/api/allegro/callback'),env);
assert.equal(callback.status,302);
assert.equal(new URL(callback.headers.get('location')).pathname,'/staging/oauth');
const connect=await worker.fetch(req('/staging/connect'),env);
assert.equal(connect.status,200);
assert(connect.headers.get('content-type')?.includes('text/html'));
assert(connect.headers.get('content-security-policy')?.includes("script-src 'self'"));
const connectHtml=await connect.text();
assert(connectHtml.includes('type="password"'));
assert(!connectHtml.includes(env.STAGING_API_KEY),'Never embed staging secret into browser HTML');
const connectScript=await worker.fetch(req('/staging/connect.js'),env);
assert.equal(connectScript.status,200);
const connectJs=await connectScript.text();
assert(connectJs.includes("'x-staging-test-key'"));
assert.doesNotThrow(()=>new Script(connectJs),'Onboarding browser script must parse cleanly');
const feedback=await worker.fetch(req('/staging/oauth?allegro=connected'),env);
assert.equal((await feedback.json()).environment,'staging');

const prodEnv={...production.vars,AUTH:fakeKv};
const prodStagePage=await worker.fetch(req('/staging/connect'),prodEnv);
assert.equal(prodStagePage.status,404,'Production must never expose staging onboarding');
const prodCallback=await worker.fetch(req('/api/allegro/callback'),prodEnv);
assert.equal(new URL(prodCallback.headers.get('location')).origin,'https://sesqu.github.io');
const cors=await worker.fetch(req('/api/research',{
  method:'OPTIONS',headers:{origin:'https://sesqu.github.io'}
}),env);
assert.equal(cors.status,204);
assert(cors.headers.get('access-control-allow-headers')?.includes('x-staging-test-key'));

console.log('PASS staging isolation: dedicated Worker/KV/OAuth, key guard, callback separation, production unchanged.');
