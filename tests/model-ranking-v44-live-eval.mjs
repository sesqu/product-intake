import {
  analyzeResearchCandidates
} from '../worker/src/product-research.js';
import {
  buildModelQueryVariants
} from '../worker/src/research-ranking-v3.js';

const base='https://product-intake.sesquu.workers.dev';

const cases=[
  {label:'Sony exact',query:'WH-1000XM5',primary:/sony.*słuchawk|słuchawk.*sony/i},
  {label:'Sony compact',query:'WH1000XM5',primary:/sony.*słuchawk|słuchawk.*sony/i},
  {label:'Bosch exact',query:'GSR 18V-55',primary:/bosch.*(wiertarko|wkrętark)|(wiertarko|wkrętark).*bosch/i},
  {label:'Bosch compact',query:'GSR18V55',primary:/bosch.*(wiertarko|wkrętark)|(wiertarko|wkrętark).*bosch/i},
  {label:'Samsung TV',query:'UE55CU7172',primary:/samsung.*telewizor|telewizor.*samsung/i},
  {label:'JBL speaker',query:'Flip 6',primary:/jbl.*głośnik|głośnik.*jbl/i},
  {label:'Philips coffee',query:'EP2220/10',primary:/philips.*ekspres|ekspres.*philips/i},
  {label:'Logitech mouse',query:'G502 X',primary:/logitech.*mysz|mysz.*logitech/i},
  {label:'Brother printer',query:'HL-L2402D',primary:/brother.*drukark|drukark.*brother/i},
  {label:'TP-Link router',query:'Archer AX55',primary:/tp-link.*router|router.*tp-link/i},
  {label:'Dyson vacuum',query:'V15 Detect',primary:/dyson.*odkurzacz|odkurzacz.*dyson/i},
  {label:'Samsung phone',query:'SM-S921B',primary:/samsung.*galaxy s24|galaxy s24.*samsung/i}
];

async function lookup(query){
  const r=await fetch(base+'/api/research',{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({query})
  });
  const text=await r.text();
  if(!r.ok) throw new Error('HTTP '+r.status+' '+text.slice(0,300));
  return JSON.parse(text);
}

function uniqueCandidates(items){
  const seen=new Set();
  return items.filter(item=>{
    const key=String(item?.id||item?.name||'');
    if(!key||seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const rows=[];
for(const test of cases){
  const baseline=await lookup(test.query);
  const initial=baseline.candidates||[];
  const variants=buildModelQueryVariants({query:test.query},initial);
  const gathered=[...initial];

  for(const variant of variants.slice(1,3)){
    const extra=await lookup(variant);
    gathered.push(...(extra.candidates||[]));
  }

  const candidates=uniqueCandidates(gathered);
  const v44=analyzeResearchCandidates(candidates,{query:test.query});
  const baselineName=baseline.best?.name||'';
  const v44Name=v44.selected?.name||'';
  const baselineRelation=(baseline.best?.relation?.type)||'unknown';
  const baselineNegative=/bateria|akumulator|etui|futerał|pokrowiec|filtr|uchwyt|toner|bęben|chip|złącze|złącza|płytka|płyta główna|mocowanie|osłona|wyświetlacz|ekran|klapka|część|obudowa|czujnik/i.test(baselineName);
  const v44Relation=v44.selected?.relation?.type||'unknown';
  const v44Negative=/bateria|akumulator|etui|futerał|pokrowiec|filtr|uchwyt|toner|bęben|chip|złącze|złącza|płytka|płyta główna|mocowanie|osłona|wyświetlacz|ekran|klapka|część|obudowa|czujnik/i.test(v44Name);

  const row={
    label:test.label,
    query:test.query,
    variants,
    baseline:{
      name:baselineName,
      score:baseline.confidence??null,
      primary:test.primary.test(baselineName)&&!baselineNegative
    },
    v44:{
      name:v44Name,
      score:v44.confidence??null,
      primary:test.primary.test(v44Name)&&!v44Negative&&v44Relation!=='accessory',
      relation:v44.selected?.relation||null,
      testerChoice:v44.requiresTesterChoice,
      top:(v44.ranked||[]).slice(0,5).map(x=>({
        name:x.name,
        score:x.score,
        relation:x.relation?.type||'',
        warnings:x.warnings||[]
      }))
    }
  };
  rows.push(row);
  console.log('COMPARE_JSON '+JSON.stringify(row));
}

const summary={
  total:rows.length,
  baselinePrimary:rows.filter(x=>x.baseline.primary).length,
  v44Primary:rows.filter(x=>x.v44.primary).length,
  improved:rows.filter(x=>!x.baseline.primary&&x.v44.primary).map(x=>x.query),
  regressed:rows.filter(x=>x.baseline.primary&&!x.v44.primary).map(x=>x.query),
  stillWrong:rows.filter(x=>!x.v44.primary).map(x=>({query:x.query,name:x.v44.name,score:x.v44.score})),
  averageBaseline:Math.round(rows.reduce((s,x)=>s+Number(x.baseline.score||0),0)/rows.length),
  averageV44:Math.round(rows.reduce((s,x)=>s+Number(x.v44.score||0),0)/rows.length)
};
console.log('SUMMARY_JSON '+JSON.stringify(summary));
