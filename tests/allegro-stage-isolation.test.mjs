import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,unlinkSync} from 'node:fs';
import worker from '../worker/src/index.js';

const script='worker/scripts/prepare-allegro-stage.mjs';
const runtime='worker/wrangler.allegro-stage.runtime.json';
const valid={
  V44_STAGE_URL:'https://product-intake-v44-search-staging.sesquu.workers.dev/',
  V44_STAGE_KV_ID:'a'.repeat(32),
  V44_STAGE_ALLEGRO_CLIENT_ID:'b'.repeat(32),
  V44_STAGE_ALLEGRO_CLIENT_SECRET:'local-fixture-not-a-secret',
  V44_STAGE_KEY:'local-32-char-stage-key-only-testing-123'
};
function exec(changes={}){
  return execFileSync(process.execPath,[script],{
    env:{...process.env,...valid,...changes},encoding:'utf8'
  });
}
function expectReject(field,value){
  assert.throws(()=>exec({[field]:value}),/Command failed|Command exited/);
}
try{
  exec();
  const data=JSON.parse(readFileSync(runtime,'utf8'));
  assert.equal(data.name,'product-intake-v44-search-staging');
  assert.equal(data.kv_namespaces[0].id,valid.V44_STAGE_KV_ID);
  assert.equal(data.vars.ALLEGRO_REDIRECT_URI,
    valid.V44_STAGE_URL+'api/allegro/callback');
  assert.equal(data.vars.STAGING_ONLY,'1');
  assert.notEqual(data.vars.ALLEGRO_CLIENT_ID,'3e39ca5bf6c64c91abf11983a8e1ea48');
  assert(!JSON.stringify(data).includes(valid.V44_STAGE_ALLEGRO_CLIENT_SECRET));
  assert(!JSON.stringify(data).includes(valid.V44_STAGE_KEY));
  expectReject('V44_STAGE_URL','https://product-intake.sesquu.workers.dev/');
  expectReject('V44_STAGE_KV_ID','234d48b2a6104d759f600588dbdb69fb');
  expectReject('V44_STAGE_ALLEGRO_CLIENT_ID','3e39ca5bf6c64c91abf11983a8e1ea48');
  expectReject('V44_STAGE_KEY','short');

  const env={
    STAGING_ONLY:'1',V44_STAGE_KEY:valid.V44_STAGE_KEY,
    AUTH:{async get(){return null}}
  };
  const base=valid.V44_STAGE_URL;
  let response=await worker.fetch(new Request(base+'api/products',{
    headers:{'x-workspace-key':'a'.repeat(44)}
  }),env);
  assert.equal(response.status,401);
  response=await worker.fetch(new Request(base+'api/allegro/auth-url'),env);
  assert.equal(response.status,401);
  response=await worker.fetch(new Request(base+'api/allegro/auth-url',{
    headers:{'x-v44-stage-key':valid.V44_STAGE_KEY}
  }),env);
  assert.notEqual(response.status,401,'Correct stage key should pass stage gate');
  console.log('PASS v44 stage: isolated config, production IDs rejected, API key fail-closed.');
}finally{
  try{unlinkSync(runtime);}catch{}
}
