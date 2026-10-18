import {readFileSync} from 'node:fs';
import {buildModelQueryVariants,inferProductTypeHint} from '../worker/src/research-ranking-v3.js';
const saved=JSON.parse(readFileSync('tests/fixtures/allegro-live-v43-10.json','utf8'));
for(const row of saved.cases){
 const input={query:row.query};
 const candidates=row.returnedCandidates;
 const type=inferProductTypeHint(candidates);
 const variants=buildModelQueryVariants(input,candidates);
 console.log('REAL_SUGGESTIONS '+JSON.stringify({query:row.query,detectedType:type,variants}));
}
