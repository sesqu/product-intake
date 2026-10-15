import assert from 'node:assert/strict';
import {
  mapAmazonItem,
  analyzeAmazonCandidate
} from '../worker/src/amazon.js';
import {
  compareCatalogSources
} from '../worker/src/catalog-sources.js';

const raw = {
  asin:'B0TEST1234',
  summaries:[{
    marketplaceId:'TEST-MARKET',
    itemName:'Example Phone X 128 GB',
    brand:'Example',
    modelNumber:'X128'
  }],
  identifiers:[{
    marketplaceId:'TEST-MARKET',
    identifiers:[
      {identifierType:'EAN',identifier:'5901234567890'},
      {identifierType:'UPC',identifier:'012345678905'}
    ]
  }],
  images:[{
    marketplaceId:'TEST-MARKET',
    images:[
      {variant:'MAIN',link:'https://example.test/main.jpg'}
    ]
  }],
  classifications:[{
    marketplaceId:'TEST-MARKET',
    classifications:[
      {classificationId:'1',displayName:'Smartphones'}
    ]
  }],
  productTypes:[{
    marketplaceId:'TEST-MARKET',
    productType:'CELLULAR_PHONE'
  }],
  attributes:{
    manufacturer:[{value:'Example Manufacturing'}],
    color:[{value:'Black'}],
    part_number:[{value:'PN-X128'}]
  }
};

const mapped = mapAmazonItem(raw,{asin:'B0TEST1234'});
assert.equal(mapped.asin,'B0TEST1234');
assert.equal(mapped.catalogEan,'5901234567890');
assert.equal(mapped.ean,'5901234567890');
assert.equal(mapped.brand,'Example');
assert.equal(mapped.model,'X128');
assert.equal(mapped.category,'Smartphones');
assert.equal(mapped.image,'https://example.test/main.jpg');
assert(mapped.parameters.some(x => x.name === 'Producent' && x.value === 'Example Manufacturing'));

const direct = analyzeAmazonCandidate(mapped,{asin:'B0TEST1234',ean:'5901234567890'});
assert.equal(direct.confidenceMethod,'amazon-catalog-identification-v1');
assert(direct.confidence >= 90);
assert.equal(direct.hardConflictDetails.length,0);

const mismatch = analyzeAmazonCandidate(mapped,{asin:'B0TEST1234',ean:'5900000000000'});
assert(mismatch.hardConflictDetails.some(x => x.key === 'amazon:ean'));
assert(mismatch.confidence <= 45);
assert(mismatch.hardConflictDetails[0].options.some(x => x.choice === 'amazon'));
assert(mismatch.hardConflictDetails[0].options.some(x => x.choice === 'query'));

const allegro = {
  source:'allegro',
  ean:'5901234567890',
  brand:'Example',
  model:'X128'
};
const amazon = {
  ...mapped,
  model:'X128 Pro'
};

const comparison = compareCatalogSources(allegro,amazon);
assert(comparison.hardConflictDetails.some(x => x.key === 'source:model'));
const modelConflict = comparison.hardConflictDetails.find(x => x.key === 'source:model');
assert(modelConflict.options.some(x => x.choice === 'allegro'));
assert(modelConflict.options.some(x => x.choice === 'amazon'));

console.log('PASS Amazon Catalog mapping, confidence and tester conflict choices.');
