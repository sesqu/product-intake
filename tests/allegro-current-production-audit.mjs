// Read-only baseline audit of CURRENT production Worker /api/research (v43).
// It intentionally does NOT claim to test the unpublished v44 ranking or its
// new query plan. It does not write products or modify Allegro catalog data.
const base = 'https://product-intake.sesquu.workers.dev';
const cases = [
  {query:'SM-S921B',type:'phone'},
  {query:'SM-S928B',type:'phone'},
  {query:'SM-A556B',type:'phone'},
  {query:'WH-1000XM5',type:'headphones'},
  {query:'GSR 18V-55',type:'drill'},
  {query:'DHP484',type:'drill'},
  {query:'L50 Ultra',type:'robot'},
  {query:'S8 MaxV Ultra',type:'robot'},
  {query:'Xiaomi 14T',type:'phone'},
  {query:'Philips EP2220/10',type:'coffee'}
];
const compact = str => String(str ?? '').replace(/\s+/g,' ').slice(0,190);
const rows = [];
for(const test of cases){
  const started = Date.now();
  try{
    const response=await fetch(base+'/api/research',{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({query:test.query}),
      signal:AbortSignal.timeout(16000)
    });
    const data=await response.json().catch(()=>({}));
    const ranked=Array.isArray(data.candidates)?data.candidates:[];
    const best=data.best || ranked[0] || null;
    const row={
      query:test.query,type:test.type,http:response.status,
      elapsedMs:Date.now()-started,
      top1:best ? {
        id:compact(best.id),name:compact(best.name),
        model:compact(best.model),mpn:compact(best.mpn),
        category:compact(best.category),score:best.score??data.confidence??null
      } : null,
      top5:ranked.slice(0,5).map(x=>({
        id:compact(x.id),name:compact(x.name),
        model:compact(x.model),mpn:compact(x.mpn),
        category:compact(x.category),score:x.score??null
      })),
      testerChoice:data.requiresTesterChoice??null,
      searchCallsReported:(data.searchAttempts||[]).length,
      error:response.ok?null:compact(data.error||data.message||'HTTP '+response.status)
    };
    rows.push(row);
    console.log('ALLEGRO_LIVE '+JSON.stringify(row));
  }catch(error){
    const row={query:test.query,type:test.type,http:null,elapsedMs:Date.now()-started,
      error:compact(error?.message||error),top1:null,top5:[]};
    rows.push(row);
    console.log('ALLEGRO_LIVE '+JSON.stringify(row));
  }
}
const ok=rows.filter(r=>r.http===200).length;
const summary={environment:'CURRENT production Worker, NOT PR #9',
  total:cases.length,ok,errors:cases.length-ok,
  retrievedCandidates:rows.reduce((a,r)=>a+r.top5.length,0)};
console.log('ALLEGRO_LIVE_SUMMARY '+JSON.stringify(summary));
// An outage must not appear as a successful Allegro quality evaluation.
if(ok<6) process.exitCode=1;
