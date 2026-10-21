// Balanced Allegro sample: 100 candidate identities across 10 categories.
// Read-only tests. No SKU/master writes. Queries are identical for v43/v44.
// IMPORTANT: HTTP 200 and textual model overlap are NOT truth labels.
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';

const sample=JSON.parse(readFileSync(new URL('./fixtures/allegro-sample-100.json',import.meta.url),'utf8'));
if(sample.cases.length!==100 || sample.humanVerified!==false)throw Error('Unexpected sample format');
const cats=new Map();
const uniq=new Set();
for(const x of sample.cases) {
  if(!x.id||!x.query||!x.expectedBrand||!x.expectedModel||!x.expectedKind||
    x.verifiedGroundTruth!==false)throw Error('Incomplete/unreviewed sample row: '+x.id);
  if(uniq.has(x.query.toLowerCase()))throw Error('Duplicate input: '+x.query);
  uniq.add(x.query.toLowerCase());
  cats.set(x.category,(cats.get(x.category)||0)+1);
}
if(cats.size!==10||[...cats.values()].some(n=>n!==10))throw Error('Expected ten category groups × ten');

const target=process.env.BENCHMARK_TARGET||'validate';
const batchArg=process.env.BENCHMARK_BATCH||'0';
const stage='https://product-intake-v44-search-staging.sesquu.workers.dev';
const prod='https://product-intake.sesquu.workers.dev';
const origins={production:prod,staging:stage};
if(!['validate','production','staging'].includes(target))throw Error('Unknown target');
let items=[];
if(batchArg==='all'){
  if(process.env.ALLOW_100_LIVE!=='true')throw Error('Full 100 requires explicit ALLOW_100_LIVE=true');
  items=sample.cases;
}else{
  const batch=Number(batchArg);
  if(!Number.isInteger(batch)||batch<0||batch>9)throw Error('BENCHMARK_BATCH must be 0..9 or all');
  items=sample.cases.slice(batch*10,(batch+1)*10);
}
const selectedCats=new Set(items.map(x=>x.category));
if(target!=='validate'&&batchArg!=='all'&&selectedCats.size!==10)
  throw Error('Each batch must cover all ten categories');

function strip(v,max=230){return String(v??'').replace(/\s+/g,' ').slice(0,max);}
function title(item){return item?{
  id:strip(item.id,90),name:strip(item.name),
  brand:strip(item.brand,65),model:strip(item.model,90),mpn:strip(item.mpn,90),
  category:strip(item.category,90),score:item.score??null
}:null;}
if(target==='validate'){
  console.log('SAMPLE100_VALIDATION '+JSON.stringify({
    total:sample.cases.length,categories:Object.fromEntries(cats),batch:batchArg,
    selected:items.map(x=>({id:x.id,query:x.query,category:x.category})),
    humanVerified:false,queryStatus:'not executed'
  }));
  process.exit(0);
}
const key=process.env.V44_STAGE_KEY||'';
if(target==='staging'){
  if(key.length<32)throw Error('No separate staging secret; refusing any call');
  const health=await fetch(stage+'/health',{signal:AbortSignal.timeout(12000)});
  if(!health.ok)throw Error('Staging health failed '+health.status);
  const state=await health.json();
  if(state.service!=='product-intake-api'||!state.allegro?.connected)
    throw Error('Staging OAuth is not connected; refusing to claim real v44 results');
}
const results=[];
for(const item of items){
  const started=Date.now();
  let row={id:item.id,category:item.category,query:item.query,
    expectedBrand:item.expectedBrand,expectedModel:item.expectedModel,
    expectedKind:item.expectedKind,groundTruthVerified:false,
    target,elapsedMs:0,http:null,top1:null,top3:[],top5:[],
    reportedRequests:null,requiresTesterChoice:null,hasAnyCandidates:false,error:null};
  try{
    const r=await fetch(origins[target]+'/api/research',{
      method:'POST',
      headers:{'content-type':'application/json',
        ...(target==='staging'?{'x-v44-stage-key':key}:{})},
      body:JSON.stringify({query:item.query}),
      signal:AbortSignal.timeout(25000)
    });
    const data=await r.json().catch(()=>({}));
    const pool=Array.isArray(data.candidates)?data.candidates:[];
    const attempts=Array.isArray(data.searchAttempts)?data.searchAttempts:null;
    if(attempts?.length>3)throw Error('API exceeded 3 Allegro search calls');
    row={...row,http:r.status,top1:title(data.best||pool[0]),
      top3:pool.slice(0,3).map(title),top5:pool.slice(0,5).map(title),
      reportedRequests:attempts?.length??null,
      requiresTesterChoice:data.requiresTesterChoice??null,
      hasAnyCandidates:pool.length>0||Boolean(data.best),
      error:r.ok?null:strip(data.error||data.message||'API HTTP '+r.status)};
  }catch(error){row.error=strip(error.message||error);}
  row.elapsedMs=Date.now()-started;
  results.push(row);
  console.log('SAMPLE100_ROW '+JSON.stringify(row));
}
const ok=results.filter(x=>x.http===200).length;
const found=results.filter(x=>x.hasAnyCandidates).length;
const summary={
  dataset:'allegro-sample-100',environment:target,
  batch:batchArg,requested:items.length,ok,responsesWithCandidates:found,
  requestsReported:results.reduce((n,r)=>n+(r.reportedRequests||0),0),
  manualReviewFlagged:results.filter(r=>r.requiresTesterChoice===true).length,
  errors:results.filter(r=>r.http!==200).map(r=>({id:r.id,http:r.http,error:r.error})),
  groundTruthValidated:0,
  warning:'Availability and candidates only. TOP1/TOP3 accuracy needs HUMAN verified labels for brand, exact variant and complete device.'
};
console.log('SAMPLE100_SUMMARY '+JSON.stringify(summary));
mkdirSync('benchmark-results',{recursive:true});
writeFileSync('benchmark-results/'+target+'-batch-'+batchArg+'.json',
  JSON.stringify({generatedAt:new Date().toISOString(),summary,results},null,2)+'\n');
if(ok!==items.length)process.exitCode=1;
