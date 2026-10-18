// Validate real end-to-end MPN requests only against a dedicated feature Worker.
// A staging Worker must have its OWN OAuth/KV setup; this script never reads tokens.
const rawBase = String(process.env.V44B_STAGING_BASE_URL || '').trim();
if (!rawBase) {
  console.error('BLOCKED: set V44B_STAGING_BASE_URL to a deployed v44b test Worker URL.');
  process.exit(2);
}
let base;
try { base = new URL(rawBase); } catch {
  console.error('Invalid V44B_STAGING_BASE_URL');
  process.exit(2);
}
if (
  base.protocol !== 'https:' ||
  base.username || base.password ||
  base.pathname !== '/' ||
  base.search || base.hash ||
  base.hostname !== 'product-intake-v44b-staging.sesquu.workers.dev'
) {
  console.error('BLOCKED: staging must use its own HTTPS origin, not the production Worker.');
  process.exit(2);
}
const stageKey = String(process.env.V44B_STAGING_API_KEY || '').trim();
if (stageKey.length < 20) {
  console.error('BLOCKED: V44B_STAGING_API_KEY is missing or too short.');
  process.exit(2);
}
const stageHeaders = {
  'content-type':'application/json',
  'x-staging-test-key':stageKey
};
async function verifyStagingIdentity(){
  const healthResponse = await fetch(new URL('/health',base),{
    headers:{'accept':'application/json'},
    signal:AbortSignal.timeout(12000)
  });
  if(!healthResponse.ok) throw Error('Staging health failed: HTTP '+healthResponse.status);
  const health = await healthResponse.json();
  if (health.environment !== 'staging' || health.appVersion !== 'v44b-staging') {
    throw Error('BLOCKED: wrong deployment identity (expected v44b-staging)');
  }
  if (!health.allegro?.configured || !health.allegro?.connected) {
    throw Error('BLOCKED: staging Allegro OAuth credentials missing or not connected');
  }
  const denied = await fetch(new URL('/api/research',base),{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({query:'SM-S921B'}),
    signal:AbortSignal.timeout(12000)
  });
  if(denied.status !== 401) throw Error('BLOCKED: staging API is not rejecting anonymous access');
}
try { await verifyStagingIdentity(); } catch(error) {
  console.error(String(error?.message||error));
  process.exit(2);
}
const cases = [
  {query:'SM-S921B',brand:'Samsung'},
  {query:'SM-S928B',brand:'Samsung'},
  {query:'SM-A556B',brand:'Samsung'},
  {query:'WH1000XM5',brand:'Sony'},
  {query:'L50 Ultra',brand:'Dreame'},
  {query:'S8 MaxV Ultra',brand:'Roborock'},
  {query:'DCD796',brand:'DeWalt'},
  {query:'GSR 18V-55',brand:'Bosch'}
];
const rows = [];
let failed = 0;
for (const test of cases) {
  try {
    const start = Date.now();
    const response = await fetch(new URL('/api/research',base),{
      method:'POST',
      headers:stageHeaders,
      body:JSON.stringify({query:test.query}),
      signal:AbortSignal.timeout(20000)
    });
    const result = await response.json().catch(()=>({error:'Non-JSON response'}));
    if (!response.ok) throw new Error('HTTP '+response.status+': '+String(result.error||'unknown'));
    const attempts = result.searchAttempts;
    if (!Array.isArray(attempts)) throw new Error('Feature Worker is not exposing searchAttempts');
    if (attempts.length > 3) throw new Error('Request budget exceeded: '+attempts.length);
    if (!attempts.some(item=>item.mode==='MPN')) throw new Error('No MPN attempt for model');
    if (attempts.some(item=>item.mode==='MPN' && item.error)) {
      throw new Error('MPN rejected: '+attempts.filter(item=>item.mode==='MPN').map(item=>item.error||'').join(''));
    }
    rows.push({
      query:test.query,
      attempts:attempts.map(x=>({phrase:x.phrase,mode:x.mode,reason:x.reason})),
      best:result.best?.name||null,
      score:result.confidence??0,
      needsReview:Boolean(result.requiresTesterChoice),
      candidates:(result.candidates||[]).map(x=>({id:x.id,name:x.name,score:x.score,relation:x.relation?.type||null})),
      elapsedMs:Date.now()-start
    });
    console.log('MPN_CASE '+JSON.stringify({status:'ok',...rows[rows.length-1]}));
  } catch(error) {
    failed += 1;
    rows.push({query:test.query,error:String(error?.message||error)});
    console.error('MPN_CASE '+JSON.stringify({status:'failed',...rows[rows.length-1]}));
  }
}
console.log('MPN_SUMMARY '+JSON.stringify({
  staging:base.origin,total:cases.length,passed:cases.length-failed,
  failed,rows
}));
if (failed) process.exitCode = 1;
