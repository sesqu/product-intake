import assert from 'node:assert/strict';
import {
  mapKeepaProduct,
  analyzeKeepaCandidates
} from '../worker/src/keepa.js';
import { compareAllegroKeepa } from '../worker/src/catalog-sources.js';

const raw = {
  asin:'B0KEEPATEST',
  domainId:3,
  title:'Example Drill X128',
  lastUpdate:7664520,
  images:[{
    l:'81example.jpg',
    m:'51example.jpg',
    variant:'MAIN'
  }],
  rootCategory:123,
  categoryTree:[
    {catId:1,name:'Tools'},
    {catId:123,name:'Drills'}
  ],
  eanList:['5901234567890'],
  gtinList:['05901234567890'],
  upcList:[],
  manufacturer:'Example Manufacturing',
  brand:'Example',
  type:'DRILL',
  partNumber:'PN-X128',
  model:'X128',
  color:'Black',
  features:['Feature one'],
  description:'Example description',
  aPlus:[{
    fromManufacturer:true,
    module:[{text:['Manufacturer content']}]
  }],
  videos:[{
    creator:'Brand',
    name:'Example'
  }]
};

const mapped = mapKeepaProduct(raw,{ean:'5901234567890'});
assert.equal(mapped.source,'keepa');
assert.equal(mapped.provider,'keepa');
assert.equal(mapped.catalog,'amazon');
assert.equal(mapped.asin,'B0KEEPATEST');
assert.equal(mapped.catalogEan,'5901234567890');
assert.equal(mapped.ean,'5901234567890');
assert.equal(mapped.brand,'Example');
assert.equal(mapped.manufacturer,'Example Manufacturing');
assert.equal(mapped.model,'X128');
assert.equal(mapped.partNumber,'PN-X128');
assert.equal(mapped.category,'Drills');
assert.equal(mapped.image,'https://m.media-amazon.com/images/I/81example.jpg');
assert.equal(mapped.aPlusFromManufacturer,true);
assert(mapped.videoCreatorTypes.includes('Brand'));
assert.equal(mapped.provenance.fieldAuthorKnown,false);

const byCode = analyzeKeepaCandidates([mapped],{ean:'5901234567890'});
assert.equal(byCode.selected.asin,'B0KEEPATEST');
assert.equal(byCode.selectedBy,'keepa-code');
assert(byCode.confidence >= 80);
assert.equal(byCode.requiresTesterChoice,false);

const direct = analyzeKeepaCandidates([mapped],{asin:'B0KEEPATEST',ean:'5901234567890'});
assert.equal(direct.selectedBy,'keepa-asin');
assert(direct.confidence >= 90);

const second = {
  ...mapped,
  id:'B0KEEPADIFF',
  asin:'B0KEEPADIFF',
  model:'X128 PRO',
  partNumber:'PN-X128-PRO',
  name:'Example Drill X128 Pro'
};
const ambiguous = analyzeKeepaCandidates([mapped,second],{ean:'5901234567890'});
assert.equal(ambiguous.requiresTesterChoice,true);
assert(ambiguous.conflicts.some(x => x.key === 'keepa:candidate'));

const selected = analyzeKeepaCandidates([mapped,second],{ean:'5901234567890'},'B0KEEPADIFF');
assert.equal(selected.requiresTesterChoice,false);
assert.equal(selected.selected.asin,'B0KEEPADIFF');
assert.equal(selected.selectedBy,'tester');

const mismatch = analyzeKeepaCandidates([
  {
    ...mapped,
    ean:'5909999999999',
    catalogEan:'5909999999999',
    eanList:['5909999999999'],
    gtinList:[],
    upcList:[]
  }
],{asin:'B0KEEPATEST',ean:'5901234567890'});
assert(mismatch.hardConflictDetails.some(x => x.key === 'keepa:ean'));
assert(mismatch.confidence <= 45);

const comparison = compareAllegroKeepa(
  {
    source:'allegro',
    catalogEan:'5901234567890',
    brand:'Example',
    model:'X128'
  },
  {
    ...mapped,
    model:'X128 PRO'
  }
);
assert(comparison.hardConflictDetails.some(x => x.field === 'model'));
const modelConflict = comparison.hardConflictDetails.find(x => x.field === 'model');
assert(modelConflict.options.some(x => x.choice === 'allegro'));
assert(modelConflict.options.some(x => x.choice === 'keepa'));

console.log('PASS Keepa mapping, scoring, ambiguity and Allegro comparison.');
