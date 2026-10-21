const url='https://product-intake-v44-search-staging.sesquu.workers.dev';
const key=process.env.V44_STAGE_KEY;
if(!key||key.length<32)throw Error('V44_STAGE_KEY required');
if(url.includes('product-intake.sesquu.workers.dev'))throw Error('Production URL is forbidden');
const health=await fetch(url+'/health',{signal:AbortSignal.timeout(15000)});
if(!health.ok)throw Error('Stage health failed: '+health.status);
const state=await health.json();
if(state.service!=='product-intake-api')throw Error('Wrong service');
if(!state.allegro?.connected)throw Error('Test Allegro OAuth not connected on isolated staging. Cannot claim a live search test.');
const cases=['SM-S921B','SM-S928B','SM-A556B','WH-1000XM5',
  'DHP484','GSR 18V-55','L50 Ultra','S8 MaxV Ultra','Xiaomi 14T','Philips EP2220/10'];
let successful=0;
for(const query of cases){
  let row={query};
  try{
    const response=await fetch(url+'/api/research',{
      method:'POST',
      headers:{'content-type':'application/json','x-v44-stage-key':key},
      body:JSON.stringify({query}),
      signal:AbortSignal.timeout(25000)
    });
    const body=await response.json();
    if(!response.ok)throw Error('HTTP '+response.status+': '+body.error);
    const attempts=body.searchAttempts||[];
    if(attempts.length>3)throw Error('More than 3 catalog requests');
    successful++;
    row={query,status:response.status,top1:body.best?.name||null,
      top3:(body.candidates||[]).slice(0,3).map(x=>x.name),
      requireReview:body.requiresTesterChoice,identifiedModel:body.identifiedModel,
      attempts:attempts.map(x=>({mode:x.mode,reason:x.reason,page:x.page,count:x.foundCount}))};
  }catch(e){row.error=String(e?.message||e);}
  console.log('V44_REAL_STAGE '+JSON.stringify(row));
}
console.log('V44_REAL_STAGE_SUMMARY '+JSON.stringify({
  provider:'real Allegro OAuth on ISOLATED v44 Worker',total:cases.length,
  successful,groundTruthVerified:false
}));
if(successful!==cases.length)process.exitCode=1;
