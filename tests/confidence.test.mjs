import assert from 'node:assert/strict';
import { analyzeIdentification } from '../worker/src/confidence.js';

const base = {
  source:'allegro',
  id:'A1',
  name:'Telefon Example X 128 GB',
  ean:'5901234567890',
  catalogEan:'5901234567890',
  brand:'Example',
  model:'X',
  category:'Smartfony',
  image:'https://example.test/x.jpg',
  parameters:[
    {name:'Pojemność pamięci',value:'128 GB'},
    {name:'Wariant',value:'EU'},
    {name:'Kolor',value:'Czarny'}
  ]
};

{
  const result = analyzeIdentification([base], '5901234567890');
  assert.equal(result.requiresTesterChoice, false);
  assert.equal(result.hardConflicts.length, 0);
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.confidence, 100);
  assert.equal(result.completeness, 100);
  assert.equal(result.confidenceMethod, 'weighted-identification-v2');
}

{
  const otherModel = {
    ...base,
    id:'A2',
    name:'Telefon Example Y 128 GB',
    model:'Y'
  };
  const result = analyzeIdentification(
    [base, otherModel],
    '5901234567890'
  );
  assert.equal(result.requiresTesterChoice, true);
  assert(result.conflicts.some(x =>
    x.key === 'model' && x.severity === 'critical'
  ));
  assert(result.confidence <= 69);
}

{
  const otherCapacity = {
    ...base,
    id:'A3',
    name:'Telefon Example X 256 GB',
    parameters:[
      {name:'Pojemność pamięci',value:'256 GB'},
      {name:'Wariant',value:'EU'},
      {name:'Kolor',value:'Czarny'}
    ]
  };
  const result = analyzeIdentification(
    [base, otherCapacity],
    '5901234567890'
  );
  assert.equal(result.requiresTesterChoice, true);
  assert(result.conflicts.some(x =>
    x.key === 'capacity' && x.severity === 'critical'
  ));
}

{
  const otherVariant = {
    ...base,
    id:'A4',
    parameters:[
      {name:'Pojemność pamięci',value:'128 GB'},
      {name:'Wariant',value:'US'},
      {name:'Kolor',value:'Czarny'}
    ]
  };
  const result = analyzeIdentification(
    [base, otherVariant],
    '5901234567890'
  );
  assert.equal(result.requiresTesterChoice, true);
  assert(result.conflicts.some(x =>
    x.key === 'variant' && x.severity === 'critical'
  ));
}

{
  const otherModel = {...base,id:'A2',model:'Y'};
  const result = analyzeIdentification(
    [base, otherModel],
    '5901234567890',
    'A2'
  );
  assert.equal(result.requiresTesterChoice, false);
  assert.equal(result.selected.id, 'A2');
  assert.equal(result.selectedBy, 'tester');
}

{
  const mismatch = {
    ...base,
    catalogEan:'5900000000000',
    ean:'5900000000000'
  };
  const result = analyzeIdentification(
    [mismatch],
    '5901234567890'
  );
  assert(result.hardConflicts.some(x => x.key === 'ean'));
  assert(result.confidence <= 25);
}

{
  const fallback = {
    ...base,
    catalogEan:'',
    ean:'5901234567890'
  };
  const result = analyzeIdentification(
    [fallback],
    '5901234567890'
  );
  assert(result.confidence < 100);
  assert(result.confidence >= 80);
}

console.log('PASS confidence v2: scoring, conflicts and tester selection.');
