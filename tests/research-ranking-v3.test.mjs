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


const servicePart = {
  id:'dewalt-motor',
  name:'DEWALT NA067843 SILNIK Z WYŁĄCZNIKIEM DO DCD791 DCD796',
  brand:'DeWalt',
  manufacturer:'DeWalt',
  model:'NA067843',
  mpn:'NA067843',
  category:'Części zamienne do elektronarzędzi',
  parameters:[],
  trust:{brand:true,manufacturer:true,model:true,mpn:true}
};
assert.equal(
  classifyCandidateRelation(servicePart,{query:'DCD791'}).type,
  'accessory',
  'Silnik / wyłącznik do konkretnego modelu nie może konkurować jak produkt główny'
);

const robotMop = {
  id:'roborock-mop',
  name:'Oryginalny Mop Szmatka główna do Roborock S8 MaxV Ultra 2 szt.',
  brand:'Roborock',
  manufacturer:'Roborock',
  model:'Mop',
  mpn:'MOP-S8',
  category:'Akcesoria do robotów sprzątających',
  parameters:[],
  trust:{brand:true,manufacturer:true,model:false,mpn:false}
};
assert.equal(
  classifyCandidateRelation(robotMop,{query:'S8 MaxV Ultra'}).type,
  'accessory',
  'Mop do robota powinien być częścią / akcesorium'
);


const robotAccessoryKit = {
  id:'roborock-kit',
  name:'Zestaw akcesoriów Roborock S8 MaxV Ultra, 2x szczotka, 2x filtr',
  brand:'Roborock',
  manufacturer:'Roborock',
  model:'S8 MaxV Ultra',
  mpn:'S8 MaxV Ultra',
  category:'Akcesoria',
  parameters:[],
  trust:{brand:true,manufacturer:true,model:false,mpn:false}
};
assert.equal(
  classifyCandidateRelation(robotAccessoryKit,{query:'S8 MaxV Ultra'}).type,
  'accessory',
  'Twardy sygnał akcesoriów ma wygrać nawet gdy katalog błędnie wpisuje model urządzenia'
);

const printerBundle = {
  id:'brother-main',
  name:'MFP laserowe Brother DCP-L2622DW Duplex WiFi Kabel USB',
  brand:'Brother',
  manufacturer:'Brother',
  model:'DCP-L2622DW',
  mpn:'DCP-L2622DW',
  category:'Urządzenia wielofunkcyjne',
  parameters:[],
  trust:{brand:true,manufacturer:true,model:true,mpn:true}
};
assert.equal(
  classifyCandidateRelation(printerBundle,{query:'DCP-L2622DW'}).type,
  'product',
  'Produkt główny z kablem w zestawie nie może zostać uznany za samo akcesorium'
);

const makita = {
  id:'makita-dhp484',
  name:'Wiertarko-wkrętarka Makita DHP484 18V',
  brand:'Makita',
  manufacturer:'Makita',
  model:'DHP484',
  mpn:'DHP484',
  category:'Wiertarko-wkrętarki',
  parameters:[],
  trust:{brand:true,manufacturer:true,model:true,mpn:true}
};
const wrongBrandSameModel = {
  ...makita,
  id:'bosch-dhp484',
  name:'Bosch DHP484 cordless drill driver',
  brand:'Bosch',
  manufacturer:'Bosch',
  trust:{brand:true,manufacturer:true,model:true,mpn:true}
};
const brandCollision = analyzeResearchCandidates(
  [wrongBrandSameModel,makita],
  {query:'DHP484'}
);
assert.equal(
  brandCollision.requiresTesterChoice,
  true,
  'Ten sam dokładny model występujący pod różnymi markami musi wymagać wyboru testera'
);
assert.equal(brandCollision.ambiguity.brandCollision,true);

const titleOnlyWrongBrand = {
  ...wrongBrandSameModel,
  id:'bosch-title-only',
  brand:'bez marki',
  manufacturer:'bez marki'
};
const makitaBundle = {
  ...makita,
  id:'makita-bundle',
  name:'MAKITA DLX2180TJ DTD153 DHP484 MAKPAC 2x5.0Ah',
  model:'DLX2180TJ',
  mpn:'DLX2180TJ'
};
const inferredBrandCollision = analyzeResearchCandidates(
  [titleOnlyWrongBrand,makitaBundle],
  {query:'DHP484'}
);
assert.equal(
  inferredBrandCollision.requiresTesterChoice,
  true,
  'Marka z tytułu ma zabezpieczyć model, gdy katalog ma pole marka=bez marki'
);
assert.equal(inferredBrandCollision.ambiguity.brandCollision,true);


const sharedCodeNoise = [
  {
    id:'ferodo',
    name:'Ferodo DDF485 Tarcza hamulcowa',
    brand:'',
    manufacturer:'',
    model:'DDF485',
    mpn:'DDF485',
    category:'Tarcze hamulcowe',
    parameters:[],
    trust:{}
  },
  {
    id:'makita-tool',
    name:'Makita DDF485 Tool',
    brand:'bez marki',
    manufacturer:'bez marki',
    model:'DDF485',
    mpn:'DDF485',
    category:'Wiertarko-wkrętarki',
    parameters:[],
    trust:{}
  },
  {
    id:'makita-part-1',
    name:'MAKITA KONTROLER DO DDF485',
    brand:'Makita',
    manufacturer:'Makita',
    model:'620964-8',
    mpn:'620964-8',
    category:'Części',
    parameters:[],
    trust:{brand:true}
  },
  {
    id:'makita-part-2',
    name:'MAKITA STOJAN DO DDF485',
    brand:'Makita',
    manufacturer:'Makita',
    model:'629372-0',
    mpn:'629372-0',
    category:'Części',
    parameters:[],
    trust:{brand:true}
  }
];
const sharedRanked = analyzeResearchCandidates(sharedCodeNoise,{query:'DDF485'});
assert.equal(sharedRanked.selected.id,'makita-tool','Powtarzający się kontekst marki powinien przebić samotny obcy produkt z tym samym kodem');
assert.equal(sharedRanked.ambiguity.brandConsensus?.brand,'Makita');

const phoneVariants = buildModelQueryVariants(
  {query:'SM-S921B'},
  [
    {name:'Bateria do Samsung SM-S921B Galaxy S24',brand:'bez marki',model:'Galaxy S24',category:'Baterie'},
    {name:'Etui do Samsung SM-S921B Galaxy S24',brand:'bez marki',model:'Galaxy S24',category:'Etui'},
    {name:'Buzzer do Samsung Galaxy S24 (SM-S921B)',brand:'Samsung',model:'Galaxy S24',category:'Części'}
  ]
);
assert(
  phoneVariants.includes('Samsung Galaxy S24'),
  'Powtarzający się alias modelu w akcesoriach powinien tworzyć bezpieczne zapytanie marka + alias'
);

console.log('PASS Research ranking v3: model fingerprint, primary-product ranking, accessory penalties, brand handling and query recovery.');
