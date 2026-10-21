// Differential analysis: rerank EXACT 50 published v43 catalog candidates
// collected live on Oct 18. This does not exercise PR9's retrieval strategy.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {analyzeResearchCandidates} from '../worker/src/product-research.js';
const snapshot=JSON.parse(readFileSync('tests/fixtures/allegro-live-v43-10.json','utf8'));
const accessory=/\bbateria\b|\bakumulator\b|\betui\b|futerał|pokrowiec|\bfiltr\b|uchwyt|złącze|buzzer|klapka|\bekran\b|wyświetlacz|szkło|folia|mop|szmatka|szczotka|worki|obudowa|spód|blok zaparzający|mocowanie|czujnik|przełącznik|wymiana ekranu|akcesori|części|\bczęść\b/i;
const device={
  phone:/smartfon|telefon|galaxy s24|galaxy a55|xiaomi 14t/i,
  headphones:/słuchawki (bezprzewodowe|nauszne|wokółuszne)/i,
  drill:/wiertarko|wkrętarka|drill driver/i,
  robot:/odkurzacz|robot sprzątający/i,
  coffee:/ekspres/i
};
const compact=s=>String(s||'').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g,'');
function exactIdentity(item,row){
  const fp=compact(row.query);
  return [item?.name,item?.model,item?.mpn].some(x=>compact(x).includes(fp));
}
function correct(item,row){
  const title=String(item?.name||'');
  if(!title || !exactIdentity(item,row) || accessory.test(title))return false;
  if(!device[row.type].test(title))return false;
  if(!compact(title).includes(compact(row.brand)))return false;
  if(row.query==='DHP484' && /\bzestaw\b|dlx2180/i.test(title))return false;
  if(/atrapa|eksponat|dummy|makieta|display unit/i.test(title))return false;
  return true;
}
// Guard against falsely counting coffee-maker spare parts or bundles as a
// complete machine. Ground truth is based on human-readable listing identity.
assert.equal(correct({name:'Spód obudowy ekspresu Philips EP2220/10'},snapshot.cases.find(x=>x.query==='Philips EP2220/10')),false);
assert.equal(correct({name:'Bosch GSR 18V-55 wiertarko-wkrętarka'},snapshot.cases.find(x=>x.query==='GSR 18V-55')),true);
assert.equal(correct({name:'Bosch DHP484 cordless drill driver'},snapshot.cases.find(x=>x.query==='DHP484')),false);
const rows=[];
for(const source of snapshot.cases){
  const candidates=source.returnedCandidates.map(x=>({...x,score:undefined}));
  const ranked=analyzeResearchCandidates(candidates,{query:source.query});
  const baseline=source.baselineTop1;
  const row={
    query:source.query,
    baselineTop1:baseline?.name||null,
    baselineCorrect:correct(baseline,source),
    v44Top1:ranked.selected?.name||null,
    v44Score:ranked.confidence,
    v44Relation:ranked.selected?.relation?.type||null,
    v44Top1Correct:correct(ranked.selected,source),
    v44Top5Correct:ranked.ranked.some(x=>correct(x,source)),
    v44Top5Names:ranked.ranked.slice(0,5).map(x=>x.name),
    requiresTesterChoice:ranked.requiresTesterChoice,
    ambiguity:ranked.ambiguity||null,
    v44Top1Warnings:(ranked.selected?.warnings||[]).map(x=>x.message||x).slice(0,3)
  };
  rows.push(row);
  console.log('RERANK_CASE '+JSON.stringify(row));
}
const summary={
  dataSource:'50 live production v43 TOP5 candidates (cached fixture)',
  validation:'local v44 ranking ONLY, NOT v44 MPN retrieval/page.id',
  cases:rows.length,
  baselineCorrect:rows.filter(r=>r.baselineCorrect).length,
  v44Correct:rows.filter(r=>r.v44Top1Correct).length,
  candidatesContainPrimary:rows.filter(r=>r.v44Top5Correct).length,
  v44RequiresTesterChoice:rows.filter(r=>r.requiresTesterChoice).length,
  regressions:rows.filter(r=>r.baselineCorrect&&!r.v44Top1Correct).map(r=>r.query),
  missed:rows.filter(r=>!r.v44Top1Correct).map(r=>({
    query:r.query,top1:r.v44Top1,score:r.v44Score,
    testerChoice:r.requiresTesterChoice
  })),
  unsafeConfident:rows.filter(r=>!r.v44Top1Correct&&!r.requiresTesterChoice)
    .map(r=>({query:r.query,top1:r.v44Top1,score:r.v44Score}))
};
console.log('RERANK_SUMMARY '+JSON.stringify(summary));
assert.equal(rows.length,10);
assert.equal(summary.regressions.length,0,'No previously correct TOP1 may become incorrect');
assert.equal(summary.unsafeConfident.length,0,'Wrong TOP1 must require tester verification');
