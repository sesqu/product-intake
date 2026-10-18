// Read-only real catalog experiment: fetch candidate pools from CURRENT v43
// research API, then apply PR9's v44 ranking locally. This is NOT live v44
// retrieval and never changes stored products or the catalog.
import {analyzeResearchCandidates} from '../worker/src/product-research.js';

const cases=[
  {query:'Samsung Galaxy S24 smartfon',model:'SM-S921B',expected:'Smartfon Samsung Galaxy S24'},
  {query:'Makita DHP484 wiertarko-wkrętarka',model:'DHP484',expected:'Makita DHP484'},
  {query:'Roborock S8 MaxV Ultra robot odkurzający',model:'S8 MaxV Ultra',expected:'Roborock S8 MaxV Ultra'},
  {query:'Sony WH-1000XM5 nauszne',model:'WH-1000XM5',expected:'Sony WH-1000XM5'},
  {query:'telefon SM-S921B',model:'SM-S921B',expected:'Samsung Galaxy S24'},
  {query:'Dreame L50 Ultra robot odkurzający',model:'L50 Ultra',expected:'Dreame L50 Ultra'},
  {query:'Samsung Galaxy A55 smartfon',model:'SM-A556B',expected:'Samsung Galaxy A55'},
  {query:'Xiaomi 14T smartfon',model:'14T',expected:'Xiaomi 14T'}
];
const results=[];
for(const test of cases){
  try{
    const res=await fetch('https://product-intake.sesquu.workers.dev/api/research',{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({query:test.query}),
      signal:AbortSignal.timeout(20000)
    });
    const data=await res.json().catch(()=>({}));
    const pool=(data.candidates||[]).slice(0,5);
    const ranked=pool.length
      ? analyzeResearchCandidates(pool.map(x=>({...x,score:undefined})),{model:test.model})
      : null;
    const row={
      query:test.query,
      expected:test.expected,
      status:res.status,
      candidatesReturned:pool.length,
      oldTop1:data.best?.name||pool[0]?.name||null,
      v44RerankedTop1:ranked?.selected?.name||null,
      v44Score:ranked?.confidence??null,
      v44RequiresTesterChoice:ranked?.requiresTesterChoice??true,
      oldTop5:pool.map(x=>x.name),
      v44Top5:ranked?.ranked?.map(x=>({name:x.name,score:x.score,relation:x.relation?.type}))||[],
      error:res.ok?null:data.error||'HTTP '+res.status
    };
    results.push(row);
    console.log('LIVE_ENRICHED_RERANK '+JSON.stringify(row));
  }catch(e){
    const row={query:test.query,error:String(e?.message||e)};
    results.push(row);console.log('LIVE_ENRICHED_RERANK '+JSON.stringify(row));
  }
}
const success=results.filter(x=>x.status===200);
const count=success.filter(x=>x.candidatesReturned>0).length;
const summary={
  label:'real CURRENT v43 retrieval plus LOCAL v44 reranking (NOT end-to-end v44)',
  checked:results.length,reachable:success.length,withCandidates:count
};
console.log('LIVE_ENRICHED_RERANK_SUMMARY '+JSON.stringify(summary));
if(success.length<6)process.exitCode=1;
