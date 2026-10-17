import assert from 'node:assert/strict';
import {
  mapAllegroResearchProduct,
  analyzeResearchCandidates,
  buildDescription,
  buildResearchResult
} from '../worker/src/product-research.js';
import {
  buildAllegroResearchQueries,
  searchAllegroForResearch
} from '../worker/src/research-allegro.js';

assert.deepEqual(
  buildAllegroResearchQueries({query:'Bosch GSR 18V-55'}),
  ['Bosch GSR 18V-55'],
  'Dowolna fraza powinna być pierwszym zapytaniem Research'
);
assert.deepEqual(
  buildAllegroResearchQueries({model:'GSR 18V-55'}),
  ['GSR 18V-55'],
  'Sam model powinien wystarczyć do jednego wyszukania'
);
assert.deepEqual(
  buildAllegroResearchQueries({brand:'Bosch',model:'GSR 18V-55'}),
  ['Bosch GSR 18V-55','GSR 18V-55'],
  'Marka + model powinny najpierw tworzyć precyzyjną frazę, a potem fallback po modelu'
);

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
assert.equal(mapped.manufacturer,'Bosch');
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

const modelOnly = buildResearchResult([mapped,second],{model:'GSR 18V-55'});
assert.equal(modelOnly.selected.id,'p1');
assert(modelOnly.confidence >= 80);
assert.equal(modelOnly.description.draft,false,'Dokładny, zaufany model może być mocnym wynikiem bez wymuszania draftu');

const manufacturerOnlyRaw = {
  ...raw,
  id:'p3',
  parameters:raw.parameters.map(parameter =>
    parameter.name === 'Marka'
      ? {...parameter,name:'Producent',valuesLabels:['Robert Bosch GmbH']}
      : parameter
  )
};
const manufacturerMapped = mapAllegroResearchProduct(manufacturerOnlyRaw);
assert.equal(manufacturerMapped.manufacturer,'Robert Bosch GmbH');
assert.equal(manufacturerMapped.brand,'Robert Bosch GmbH');

const queryResult = buildResearchResult([mapped,second],{query:'Bosch GSR 18V-55'});
assert.equal(queryResult.selected.id,'p1');
assert(queryResult.confidence >= 35);

const originalFetch = globalThis.fetch;
globalThis.fetch = async url => {
  const phrase = new URL(String(url)).searchParams.get('phrase');
  const products =
    phrase === 'Bosch GSR 18V-55'
      ? [raw,{...raw,id:'p2a',name:'Bosch GSR 18V-55 zestaw'}]
      : phrase === 'GSR 18V-55'
        ? [raw,{...raw,id:'p3a',name:'Bosch GSR 18V-55 solo'}]
        : [];
  return {
    ok:true,
    async json(){ return {products}; }
  };
};

const aggregated = await searchAllegroForResearch({
  token:'test',
  userAgent:'test',
  input:{brand:'Bosch',model:'GSR 18V-55'}
});
assert.deepEqual(aggregated.queriesUsed,['Bosch GSR 18V-55','GSR 18V-55']);
assert.equal(aggregated.products.length,3,'Research powinien łączyć kandydatów z kolejnych prób i usuwać duplikaty');
globalThis.fetch = originalFetch;

const result = buildResearchResult([mapped],{brand:'Bosch',model:'GSR 18V-55'});
assert.equal(result.confidenceMethod,'product-research-v3');
assert(result.description.title.includes('Bosch'));

console.log('PASS product research v3 integration: generic query, aggregation, model-only, manufacturer and trusted scoring.');
