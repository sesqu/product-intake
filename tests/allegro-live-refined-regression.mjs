import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {analyzeResearchCandidates} from '../worker/src/product-research.js';

const fixture=JSON.parse(readFileSync('tests/fixtures/allegro-live-refined-8.json','utf8'));
const notDevice=/atrapa|eksponat|prezenter|dummy|etui|pokrowiec|folia|bateria|szkło|szybka|taśma|część|wyświetlacz|mop|filtr|szczotk|obudowa|buzzer/i;
let tested=0,wholeDevices=0,manualReview=0;
for(const item of fixture.items){
  const result=analyzeResearchCandidates(item.candidates,{model:item.model});
  const top=result.selected?.name||null;
  assert.equal(top,item.observedV44Top1,'Reranking changed for '+item.query);
  assert.equal(result.ranked.length,item.candidates.length);
  if(item.expectMainDevice){
    assert(result.selected,'Expected primary candidate for '+item.query);
    assert.equal(result.selected.relation.type,'product',
      'No accessory should win for '+item.query);
    assert(!notDevice.test(top),'A display dummy or spare part won for '+item.query+': '+top);
    wholeDevices++;
  }
  if(item.expectManualReview){
    assert.equal(result.requiresTesterChoice,true,
      'Wrong/no primary must require manual review: '+item.query);
    manualReview++;
  }
  if(!item.candidates.length){
    assert.equal(result.selected,null,'No candidate must not become fabricated device');
  }
  tested++;
}
console.log('PASS real candidate regression: '+JSON.stringify({
  source:fixture.sourceRun,
  testType:'offline replay of real v43 candidate pools; NOT live v44 retrieval',
  cases:tested,wholeDeviceCases:wholeDevices,manualReviewProtected:manualReview
}));
