import assert from 'node:assert/strict';
import {
  mapAllegroResearchProduct,
  analyzeResearchCandidates,
  buildDescription,
  buildResearchResult
} from '../worker/src/product-research.js';

const raw = {
  id:'p1',
  name:'Bosch Professional GSR 18V-55',
  category:{id:'1',name:'Wiertarko-wkrętarki'},
  images:[{url:'https://example.test/a.jpg'}],
  parameters:[
    {id:'brand',name:'Marka',valuesLabels:['Bosch'],options:{isTrusted:true}},
    {id:'model',name:'Model',valuesLabels:['GSR 18V-55'],options:{isTrusted:true}},
    {id:'mpn',name:'Kod producenta',valuesLabels:['06019H5200'],options:{isTrusted:true}},
    {id:'voltage',name:'Napięcie',valuesLabels:['18 V'],options:{isTrusted:false}},
    {id:'torque',name:'Maksymalny moment obrotowy',valuesLabels:['55 Nm'],options:{isTrusted:false}}
  ]
};

const mapped = mapAllegroResearchProduct(raw);
assert.equal(mapped.brand,'Bosch');
assert.equal(mapped.model,'GSR 18V-55');
assert.equal(mapped.mpn,'06019H5200');
assert.equal(mapped.trust.model,true);

const analysis = analyzeResearchCandidates([mapped],{
  brand:'Bosch',
  model:'GSR 18V-55',
  mpn:'06019H5200'
});
assert.equal(analysis.selected.id,'p1');
assert(analysis.confidence >= 90);
assert.equal(analysis.requiresTesterChoice,false);

const desc = buildDescription(mapped,{},analysis);
assert(desc.fullDescription.includes('Napięcie: 18 V'));
assert(desc.fullDescription.includes('Maksymalny moment obrotowy: 55 Nm'));
assert.equal(desc.draft,false);

const second = {
  ...mapped,
  id:'p2',
  model:'GSR 18V-60',
  mpn:'06019H5300',
  name:'Bosch Professional GSR 18V-60',
  trust:{...mapped.trust,model:false,mpn:false}
};
const ambiguous = analyzeResearchCandidates([mapped,second],{brand:'Bosch',details:'18 V'});
assert.equal(ambiguous.requiresTesterChoice,true);

const result = buildResearchResult([mapped],{brand:'Bosch',model:'GSR 18V-55'});
assert.equal(result.confidenceMethod,'product-research-v1');
assert(result.description.title.includes('Bosch'));

console.log('PASS product research scoring, trusted fields and description generation.');
