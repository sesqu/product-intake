import { analyzeResearchCandidates } from '../worker/src/product-research.js';
import { buildModelQueryVariants } from '../worker/src/research-ranking-v3.js';

const base='https://product-intake.sesquu.workers.dev';
const cases=['DHP484','L3250','S8 MaxV Ultra','WH1000XM5','SM-S921B','DDF485'];

async function lookup(query){
  const r=await fetch(base+'/api/research',{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({query}),
    signal:AbortSignal.timeout(15000)
  });
  const data=await r.json();
  return data;
}

for(const query of cases){
  const baseRes=await lookup(query);
  const gathered=[...(baseRes.candidates||[])];
  const variants=buildModelQueryVariants({query},baseRes.candidates||[]);
  for(const variant of variants.slice(1,3)){
    const extra=await lookup(variant);
    gathered.push(...(extra.candidates||[]));
  }
  const seen=new Set();
  const unique=gathered.filter(x=>{
    const k=String(x?.id||x?.name||'');
    if(!k||seen.has(k)) return false;
    seen.add(k); return true;
  });
  const ranked=analyzeResearchCandidates(unique,{query});
  console.log('HARD_JSON '+JSON.stringify({
    query,
    variants,
    selected:{
      name:ranked.selected?.name||'',
      brand:ranked.selected?.brand||ranked.selected?.manufacturer||'',
      model:ranked.selected?.model||'',
      mpn:ranked.selected?.mpn||'',
      category:ranked.selected?.category||'',
      score:ranked.selected?.score||0,
      relation:ranked.selected?.relation||null
    },
    requiresTesterChoice:ranked.requiresTesterChoice,
    ambiguity:ranked.ambiguity,
    top:(ranked.ranked||[]).slice(0,8).map(x=>({
      name:x.name||'',
      brand:x.brand||x.manufacturer||'',
      model:x.model||'',
      mpn:x.mpn||'',
      category:x.category||'',
      score:x.score||0,
      relation:x.relation?.type||''
    }))
  }));
}
