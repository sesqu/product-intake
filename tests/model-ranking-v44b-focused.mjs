import { analyzeResearchCandidates } from '../worker/src/product-research.js';
import { buildModelQueryVariants } from '../worker/src/research-ranking-v3.js';

const base='https://product-intake.sesquu.workers.dev';
const cases=[
  {query:'WH1000XM5',brand:'Sony',primary:/słuchawk/i},
  {query:'L3250',brand:'Epson',primary:/drukark|ecotank/i},
  {query:'DDF485',brand:'Makita',primary:/makita/i},
  {query:'DHP484',brand:'Makita',primary:/makita/i},
  {query:'SM-S921B',brand:'Samsung',primary:/telefon|smartfon|galaxy s24/i},
  {query:'SM-A556B',brand:'Samsung',primary:/telefon|smartfon|galaxy a55/i},
  {query:'S8 MaxV Ultra',brand:'Roborock',primary:/odkurzacz|robot/i},
  {query:'L50 Ultra',brand:'Dreame',primary:/odkurzacz|robot/i}
];

function unique(items){
  const seen=new Set();
  return (items||[]).filter(item=>{
    const key=String(item?.id||item?.name||'');
    if(!key||seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
async function lookup(query){
  const response=await fetch(base+'/api/research',{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({query}),
    signal:AbortSignal.timeout(15000)
  });
  const text=await response.text();
  if(!response.ok) throw new Error('HTTP '+response.status+' '+text.slice(0,160));
  return JSON.parse(text);
}

for(const test of cases){
  const first=await lookup(test.query);
  const variants=buildModelQueryVariants({query:test.query},first.candidates||[]);
  const gathered=[...(first.candidates||[])];

  for(const variant of variants.slice(1,3)){
    const extra=await lookup(variant);
    gathered.push(...(extra.candidates||[]));
  }

  const result=analyzeResearchCandidates(unique(gathered),{query:test.query});
  console.log('FOCUS_JSON '+JSON.stringify({
    query:test.query,
    variants,
    selected:{
      name:result.selected?.name||'',
      brand:result.selected?.brand||result.selected?.manufacturer||'',
      score:result.confidence,
      relation:result.selected?.relation?.type||''
    },
    expectedLike:test.primary.test(result.selected?.name||''),
    testerChoice:result.requiresTesterChoice,
    ambiguity:result.ambiguity,
    top:(result.ranked||[]).slice(0,5).map(x=>({
      name:x.name||'',
      brand:x.brand||x.manufacturer||'',
      score:x.score,
      relation:x.relation?.type||''
    }))
  }));
}
