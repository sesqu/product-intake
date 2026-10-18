import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from '../worker/src/index.js';

const raw=new DatabaseSync(':memory:');
raw.exec(readFileSync('worker/migrations/0001_team_workspace.sql','utf8'));
const db={prepare(sql){
  const statement=raw.prepare(sql);
  return {bind(...params){
    return {
      async first(){return statement.get(...params)||null;},
      async all(){return {results:statement.all(...params)};},
      async run(){return {meta:{changes:Number(statement.run(...params).changes)}};}
    };
  }};
}};
const subtle=crypto.subtle;
const pair=await subtle.generateKey({name:'RSASSA-PKCS1-v1_5',
  modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},
  true,['sign','verify']);
const publicJwk=await subtle.exportKey('jwk',pair.publicKey);
publicJwk.kid='team-key-1';
const originFetch=globalThis.fetch;
globalThis.fetch=async url=>{
  assert.equal(String(url),'https://intake-test.cloudflareaccess.com/cdn-cgi/access/certs');
  return {ok:true,async json(){return {keys:[publicJwk]};}};
};
const b64=s=>Buffer.from(s).toString('base64url');
const encoder=new TextEncoder();
async function token(email,sub){
  const header=b64(JSON.stringify({alg:'RS256',kid:'team-key-1',typ:'JWT'}));
  const claims=b64(JSON.stringify({
    iss:'https://intake-test.cloudflareaccess.com',
    aud:['team-audience'],exp:Math.floor(Date.now()/1000)+1800,
    iat:Math.floor(Date.now()/1000)-5,sub,email
  }));
  const signature=await subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,
    encoder.encode(header+'.'+claims));
  return header+'.'+claims+'.'+Buffer.from(signature).toString('base64url');
}
const owner=await token('owner@example.test','owner-sub-123456');
const tester=await token('staff@example.test','staff-sub-123456');
const viewer=await token('viewer@example.test','viewer-sub-123456');
const outsider=await token('unknown@example.test','unknown-sub-123456');
const base='https://team.example.workers.dev';
const env={
  TEAM_MODE:'1',TEAM_DB:db,TEAM_WORKSPACE_ID:'bakery-intake',
  TEAM_OWNER_EMAIL:'owner@example.test',
  TEAM_ACCESS_DOMAIN:'intake-test',TEAM_ACCESS_AUD:'team-audience',
  AUTH:{async get(){return null}}
};
async function ask(jwt,method,path,body){
  const headers={};
  if(jwt)headers['cf-access-jwt-assertion']=jwt;
  if(body)headers['content-type']='application/json';
  const r=await worker.fetch(new Request(base+path,{
    method,headers,body:body?JSON.stringify(body):undefined
  }),env);
  return {status:r.status,data:await r.json()};
}
try{
  // The email is never trusted from a forged JWT payload. The signature
  // must be verified using the configured Cloudflare Access public key.
  const segments=tester.split('.');
  const forgedPayload=JSON.parse(Buffer.from(segments[1],'base64url').toString());
  forgedPayload.email='owner@example.test';
  const forged=segments[0]+'.'+Buffer.from(JSON.stringify(forgedPayload)).toString('base64url')+
    '.'+segments[2];
  let forgedResponse=await ask(forged,'GET','/api/team/me');
  assert.equal(forgedResponse.status,401,'A client cannot impersonate owner by changing JWT email');

  let r=await ask(null,'GET','/api/team/me');
  assert.equal(r.status,401,'Anonymous team access must be denied');
  r=await ask(outsider,'GET','/api/team/products');
  assert.equal(r.status,403,'Not-invited user must be denied');
  r=await ask(owner,'GET','/api/team/me');
  assert.equal(r.status,200);
  assert.equal(r.data.user.role,'owner');
  r=await ask(owner,'POST','/api/team/members',{email:'staff@example.test',role:'tester'});
  assert.equal(r.status,201);
  r=await ask(owner,'POST','/api/team/members',{email:'viewer@example.test',role:'viewer'});
  assert.equal(r.status,201);
  r=await ask(tester,'GET','/api/team/me');
  assert.equal(r.data.user.role,'tester');
  r=await ask(viewer,'PUT','/api/team/products/LPN-100',{
    expectedRevision:0,product:{lpn:'LPN-100',productName:'Phone'}
  });
  assert.equal(r.status,403,'Viewer cannot edit');
  r=await ask(tester,'PUT','/api/team/products/LPN-100',{
    expectedRevision:0,product:{lpn:'LPN-100',productName:'Phone'}
  });
  assert.equal(r.status,201);
  assert.equal(r.data.product.revision,1);
  assert.equal(r.data.product.locked_by,'staff@example.test');
  r=await ask(owner,'POST','/api/team/products/LPN-100/claim');
  assert.equal(r.status,423,'Another user cannot claim active product');
  r=await ask(owner,'PUT','/api/team/products/LPN-100',{
    expectedRevision:1,product:{lpn:'LPN-100',productName:'Overwriting teammate'}
  });
  assert.equal(r.status,423,'A second user cannot overwrite a valid lease');
  r=await ask(tester,'PUT','/api/team/products/LPN-100',{
    expectedRevision:1,product:{lpn:'LPN-100',productName:'Phone revised'}
  });
  assert.equal(r.status,200);
  assert.equal(r.data.product.revision,2);
  // Two browser tabs carrying the same valid user identity can race.
  // Exactly one write for revision 2 may succeed; the other must be rejected.
  const [tabA,tabB]=await Promise.all([
    ask(tester,'PUT','/api/team/products/LPN-100',{
      expectedRevision:2,product:{lpn:'LPN-100',productName:'Edited in tab A'}
    }),
    ask(tester,'PUT','/api/team/products/LPN-100',{
      expectedRevision:2,product:{lpn:'LPN-100',productName:'Edited in tab B'}
    })
  ]);
  assert.deepEqual([tabA.status,tabB.status].sort(),[200,409],
    'Optimistic revision check must prevent lost updates across concurrent tabs');
  const newProduct=(await ask(tester,'GET','/api/team/products/LPN-100')).data.product;
  assert.equal(newProduct.revision,3);
  assert(['Edited in tab A','Edited in tab B'].includes(newProduct.data.productName));
  const memberHistory=await ask(owner,'GET','/api/team/members/history');
  assert.equal(memberHistory.status,200);
  assert(memberHistory.data.history.some(x=>x.action==='invite'&&x.email==='staff@example.test'));

  r=await ask(tester,'PUT','/api/team/products/LPN-100',{
    expectedRevision:1,product:{lpn:'LPN-100',productName:'Stale'}
  });
  assert.equal(r.status,409,'Old version must not overwrite newer revision');
  r=await ask(tester,'GET','/api/team/products/LPN-100');
  assert(['Edited in tab A','Edited in tab B'].includes(r.data.product.data.productName),
    'The winner of concurrent edits must remain saved');
  r=await ask(tester,'GET','/api/team/products/LPN-100/history');
  assert.deepEqual(r.data.history.map(x=>x.action),['update','update','create'],
    'Database trigger creates durable change history');
  r=await ask(tester,'POST','/api/team/products/LPN-100/release');
  assert.equal(r.status,200);
  r=await ask(owner,'POST','/api/team/products/LPN-100/claim');
  assert.equal(r.status,200);
  assert.equal(r.data.product.locked_by,'owner@example.test');
  r=await ask(tester,'PUT','/api/team/products/LPN-100',{
    expectedRevision:3,product:{lpn:'LPN-100',productName:'Unclaimed'}
  });
  assert.equal(r.status,423,'Previous editor can no longer write');
  r=await ask(owner,'PATCH','/api/team/members',{
    email:'staff@example.test',active:false
  });
  assert.equal(r.status,200);
  r=await ask(tester,'GET','/api/team/products');
  assert.equal(r.status,403,'Disabled user loses access immediately');
  r=await ask(owner,'PATCH','/api/team/members',{
    email:'owner@example.test',active:false
  });
  assert.equal(r.status,403,'Owner cannot disable themselves');
  r=await ask(owner,'GET','/api/products');
  assert.equal(r.status,403,'Legacy key-based endpoints MUST be disabled in team mode');
  r=await ask(owner,'GET','/api/team/products');
  assert.equal(r.data.products.length,1);
  // >100 products must all be visible through stable cursor pagination,
  // rather than silently disappearing from the warehouse list.
  for(let i=0;i<101;i++){
    const lpn='BATCH-'+String(i).padStart(3,'0');
    const create=await ask(owner,'PUT','/api/team/products/'+lpn,{
      expectedRevision:0,product:{lpn,productName:'Test item '+i}
    });
    assert.equal(create.status,201);
  }
  const firstPage=await ask(owner,'GET','/api/team/products');
  assert.equal(firstPage.status,200);
  assert.equal(firstPage.data.products.length,100);
  assert(firstPage.data.nextCursor,'More products must provide nextCursor');
  const page2=await ask(owner,'GET','/api/team/products?cursor='+
    encodeURIComponent(firstPage.data.nextCursor));
  assert.equal(page2.status,200);
  assert.equal(page2.data.products.length,2);
  assert.equal(page2.data.nextCursor,null);
  assert.equal(new Set([...firstPage.data.products,...page2.data.products]
    .map(x=>x.lpn)).size,102,'No repeated or missing products across pages');
  env.TEAM_MODE='0';
  r=await ask(owner,'GET','/api/team/me');
  assert.equal(r.status,404,'Team API hidden on old production deployments');
  console.log('PASS multi-user D1: signed login, roles, account disable, locks, version 409, history, legacy isolation.');
}finally{
  globalThis.fetch=originFetch;raw.close();
}
