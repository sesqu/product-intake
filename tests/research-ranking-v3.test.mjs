import assert from 'node:assert/strict';
import {
  modelFingerprint,
  classifyCandidateRelation,
  rankResearchCandidate,
  buildModelQueryVariants,
  extractEquivalentModelPhrases,
  extractContextualModelPhrases
} from '../worker/src/research-ranking-v3.js';
import { analyzeResearchCandidates } from '../worker/src/product-research.js';

assert.equal(modelFingerprint('WH-1000XM5'),'wh1000xm5');
assert.equal(modelFingerprint('WH1000XM5'),'wh1000xm5');
assert.equal(modelFingerprint('GSR 18V-55'),'gsr18v55');
assert.equal(modelFingerprint('GSR18V55'),'gsr18v55');

const sonyHeadphones = {
  id:'sony-main',
  name:'Słuchawki bezprzewodowe Sony WH-1000XM5 ANC',
  brand:'Sony',
  manufacturer:'Sony',
  model:'WH-1000XM5',
  mpn:'WH1000XM5B',
  category:'Słuchawki bezprzewodowe',
  parameters:[],
  trust:{brand:true,manufacturer:true,model:true,mpn:false}
};

const sonyBattery = {
  id:'sony-battery',
  name:'BATERIA AKUMULATOR SP723741 DO SŁUCHAWEK SONY WH-1000XM5',
  brand:'Cameron Sino',
  manufacturer:'Cameron Sino',
  model:'WH-1000XM5',
  mpn:'WH-1000XM5',
  category:'Baterie do słuchawek',
  parameters:[],
  trust:{brand:false,manufacturer:false,model:false,mpn:false}
};

const sonyCase = {
  id:'sony-case',
  name:'Etui Futerał do słuchawek Sony WH-1000XM5 Pokrowiec',
  brand:'bez marki',
  manufacturer:'bez marki',
  model:'WH-1000XM5',
  mpn:'000003',
  category:'Etui i pokrowce',
  parameters:[],
  trust:{brand:false,manufacturer:false,model:false,mpn:false}
};

assert.equal(classifyCandidateRelation(sonyBattery,{query:'WH1000XM5'}).type,'accessory');
assert.equal(classifyCandidateRelation(sonyCase,{query:'WH1000XM5'}).type,'accessory');
assert.equal(classifyCandidateRelation(sonyHeadphones,{query:'WH1000XM5'}).type,'product');

const sonyRanked = analyzeResearchCandidates(
  [sonyBattery,sonyCase,sonyHeadphones],
  {query:'WH1000XM5'}
);
assert.equal(sonyRanked.selected.id,'sony-main');
assert(sonyRanked.selected.score >= 80,'Główny produkt powinien mieć mocny wynik');
assert(sonyRanked.ranked.find(x=>x.id==='sony-battery').score < sonyRanked.selected.score - 25);

const philipsMachine = {
  id:'philips-main',
  name:'Philips Series 2200 EP2220/10 Automatyczny ekspres ciśnieniowy',
  brand:'Philips',
  manufacturer:'Philips',
  model:'EP2220/10',
  mpn:'EP2220/10',
  category:'Ekspresy automatyczne',
  parameters:[],
  trust:{brand:true,manufacturer:true,model:true,mpn:true}
};
const philipsPart = {
  id:'philips-part',
  name:'Mocowanie złącza dyszy pary do ekspresu Philips EP2220/10',
  brand:'bez marki',
  manufacturer:'bez marki',
  model:'EP2220/10',
  mpn:'EP2220/10',
  category:'Części do ekspresów',
  parameters:[],
  trust:{brand:false,manufacturer:false,model:false,mpn:false}
};
const philipsRanked = analyzeResearchCandidates(
  [philipsPart,philipsMachine],
  {query:'EP2220/10'}
);
assert.equal(philipsRanked.selected.id,'philips-main');

const explicitWrongBrand = rankResearchCandidate(
  sonyBattery,
  {query:'WH-1000XM5',brand:'Sony'}
);
assert(
  explicitWrongBrand.evidence.every(x => x.field !== 'brand' || x.value !== 'Cameron Sino'),
  'Cameron Sino nie może być uznane za zgodną markę Sony tylko dlatego, że Sony jest w tytule'
);
assert(
  explicitWrongBrand.warnings.some(x => x.field === 'brand'),
  'Jawnie inna marka produktu powinna dać ostrzeżenie'
);

const proVariant = {
  ...sonyHeadphones,
  id:'router-pro',
  name:'Router TP-Link Archer AX55 Pro',
  brand:'TP-Link',
  manufacturer:'TP-Link',
  model:'Archer AX55 Pro',
  mpn:'ARCHER AX55 PRO',
  category:'Routery',
  trust:{brand:true,manufacturer:true,model:true,mpn:true}
};
const baseRouter = {
  ...sonyHeadphones,
  id:'router-base',
  name:'Router TP-Link Archer AX55 Wi-Fi 6',
  brand:'TP-Link',
  manufacturer:'TP-Link',
  model:'Archer AX55',
  mpn:'ARCHER AX55',
  category:'Routery',
  trust:{brand:true,manufacturer:true,model:true,mpn:true}
};
const routerRanked = analyzeResearchCandidates([proVariant,baseRouter],{query:'Archer AX55'});
assert.equal(routerRanked.selected.id,'router-base');
assert(routerRanked.ranked.find(x=>x.id==='router-pro').warnings.some(x=>x.field==='model'));

assert.deepEqual(
  extractEquivalentModelPhrases('Sony WH-1000XM5 srebrne','WH1000XM5'),
  ['WH-1000XM5']
);
assert.deepEqual(
  extractContextualModelPhrases('Etui do Sony WH-1000XM5','WH1000XM5'),
  ['Sony WH-1000XM5']
);
assert(
  buildModelQueryVariants(
    {query:'WH1000XM5'},
    [{name:'Etui do Sony WH-1000XM5',model:'WH-1000XM5'}]
  ).includes('Sony WH-1000XM5')
);

console.log('PASS Research ranking v3: model fingerprint, primary-product ranking, accessory penalties, brand handling and query recovery.');
