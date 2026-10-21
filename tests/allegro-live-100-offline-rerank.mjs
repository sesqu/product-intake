// Differential evaluation: v44 ranking on EXACT v43 catalog candidates.
// This DOES NOT test v44's new MPN queries, pagination or real staging.
// All "apparent accessory" flags are textual heuristics, not manual truth.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {analyzeResearchCandidates} from '../worker/src/product-research.js';

const record=JSON.parse(readFileSync('tests/fixtures/allegro-live-v43-100-2026-10-21.json','utf8'));
const categories=new Set(record.results.map(x=>x.category));
assert.equal(record.results.length,100);
assert.equal(categories.size,10);
const obviousAccessory=/^(?:\d+[x× ]*)?(?:bateria|akumulator|etui|futerał|pokrowiec|szkło|folia|case |filtr|mop |szczotk|obudowa|ładowarka|powerbank|złącze|port usb|przełącznik|taśma|chłodzenie|inwerter|worki|głośnik buzzer|buzzer|klapka|mocowanie|głowica szczotk|backlight|elektronika moduł|styki ładowania|blaszka|kratka|mata|szybka|silikonowa|spód|płyta podstawa|oryginalny mop|torba fotograficzna|6pack pancerne szkło|5x port usb|2x akumulator)/i;
const risks=[],changes=[],misses=[];
let review=0,changed=0,selected=0,stillAccessories=0,unsafeAccessory=0;
for(const row of record.results){
  const pool=row.top5.map(x=>({...x,score:undefined}));
  const result=analyzeResearchCandidates(pool,{
    query:row.query,
    model:row.expectedModel,
    brand:row.expectedBrand
  });
  const first=result.selected||null;
  // Two failures discovered only after scaling up to 100 REAL catalog
  // samples. A stand must never replace a matching Dell monitor, and
  // a switch must never replace a Bosch drill already in the pool.
  if(row.query==='Dell P2422H')
    assert(/monitor/i.test(first?.name||''),
      'A Dell monitor stand was incorrectly promoted ahead of a full P2422H monitor');
  if(row.query==='GBH 2-26')
    assert(/młotowiertarka/i.test(first?.name||''),
      'A replacement drill switch was incorrectly promoted ahead of a Bosch power tool');
  selected+=Number(Boolean(first));
  review+=Number(Boolean(result.requiresTesterChoice));
  if(first?.name!==row.top1?.name){
    changed++;
    changes.push({id:row.id,query:row.query,
      before:row.top1?.name||null,after:first?.name||null,
      needReview:result.requiresTesterChoice});
  }
  if(!pool.length)misses.push(row.query);
  const likelyAccessory=Boolean(first && obviousAccessory.test(first.name));
  if(likelyAccessory)stillAccessories++;
  if(likelyAccessory && !result.requiresTesterChoice){
    unsafeAccessory++;
    risks.push({id:row.id,query:row.query,top1:first.name,
      score:result.confidence,brand:row.expectedBrand});
  }
  console.log('SAMPLE100_RERANK '+JSON.stringify({
    id:row.id,category:row.category,query:row.query,
    oldTop1:row.top1?.name||null,newTop1:first?.name||null,
    score:result.confidence,review:result.requiresTesterChoice,
    apparentAccessory:likelyAccessory
  }));
}
const summary={
  sourceRun:record.sourceRun,
  evaluation:'local v44 ranking of unchanged live v43 top5, NOT v44 live retrieval',
  total:record.results.length,
  recordsWithoutCandidates:misses,
  nonemptyV44:selected,changedTop1:changed,
  reviewRequested:review,
  top1ApparentAccessory:stillAccessories,
  unsafeAccessoryAutoChoices:unsafeAccessory,
  unsafeExamples:risks.slice(0,30),
  caveat:'Names-only heuristic; real correctness requires manual product/variant verification.'
};
console.log('SAMPLE100_RERANK_SUMMARY '+JSON.stringify(summary));
assert.equal(record.results.length,100);
if(unsafeAccessory>0) process.exitCode=1;
