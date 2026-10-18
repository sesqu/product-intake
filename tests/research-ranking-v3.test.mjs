import assert from 'node:assert/strict';
import {
  modelFingerprint,
  classifyCandidateRelation,
  rankResearchCandidate,
  buildModelQueryVariants,
  inferProductTypeHint,
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


const epsonPrinterRelation = classifyCandidateRelation({
  name:'Drukarka wielofunkcyjna atramentowa Epson EcoTank L3250',
  brand:'Epson',
  model:'EcoTank L3250',
  category:'Drukarki atramentowe'
},{query:'L3250'});
assert.equal(
  epsonPrinterRelation.type,
  'product',
  'Słowo atramentowa nie może być mylone z materiałem eksploatacyjnym atrament'
);

const splitModelCaseRelation = classifyCandidateRelation({
  name:'Etui Case do Motorola Edge 50 Ultra - L50',
  brand:'bez marki',
  model:'Edge 50 Ultra',
  mpn:'ETUI MOTOROLA EDGE 50 ULTRA L50',
  category:'Etui'
},{query:'L50 Ultra'});
assert.equal(
  splitModelCaseRelation.type,
  'accessory',
  'Etui z rozdzielonymi tokenami modelu powinno pozostać akcesorium'
);


const aliasAccessoryRelation = classifyCandidateRelation({
  name:'Etui z klapką do Samsung Galaxy S24 czarne',
  brand:'bez marki',
  model:'Galaxy S24',
  category:'Etui'
},{query:'SM-S921B'});
assert.equal(
  aliasAccessoryRelation.type,
  'accessory',
  'Oczywiste akcesorium z wyszukania po aliasie nie może stać się produktem głównym'
);


const phoneAccessorySet = [
  {
    name:'Etui do Samsung Galaxy S24 SM-S921B',
    brand:'bez marki',
    model:'Galaxy S24',
    category:'Etui do telefonów'
  },
  {
    name:'Bateria do Samsung Galaxy S24 SM-S921B',
    brand:'bez marki',
    model:'Galaxy S24',
    category:'Części do telefonów'
  },
  {
    name:'Buzzer do Samsung Galaxy S24 (SM-S921B)',
    brand:'Samsung',
    model:'Galaxy S24',
    category:'Części do telefonów'
  }
];
assert.equal(inferProductTypeHint(phoneAccessorySet),'smartfon');
const phoneRecovery = buildModelQueryVariants({query:'SM-S921B'},phoneAccessorySet);
assert(
  phoneRecovery.some(value => /samsung galaxy s24 smartfon/i.test(value)),
  'Accessory-heavy phone results should generate a product-type enriched query'
);

const robotAccessorySet = [
  {
    name:'Mop do Roborock S8 MaxV Ultra',
    brand:'Roborock',
    model:'S8 MaxV Ultra',
    category:'Akcesoria do robotów sprzątających'
  },
  {
    name:'Filtr do robota sprzątającego Roborock S8 MaxV Ultra',
    brand:'Roborock',
    model:'S8 MaxV Ultra',
    category:'Akcesoria do robotów sprzątających'
  }
];
assert(
  inferProductTypeHint(robotAccessorySet).includes('robot'),
  'Robot accessories should infer the target as a cleaning robot'
);

const dummyPhone = classifyCandidateRelation({
  name:'Atrapa eksponat smartfon Samsung Galaxy S24',
  brand:'Samsung',
  model:'Galaxy S24',
  category:'Telefony'
},{query:'Galaxy S24'});
assert.equal(dummyPhone.type,'accessory','Display dummy must not rank as the real phone');


 
// v44b regression: an included consumable/tool accessory must not turn a
// full product into an accessory, even if the catalog adds a brand to model.
const primaryBundleFixtures = [
  {
    name:'MFP laserowe Brother DCP-L2622DW Duplex WiFi Kabel USB',
    brand:'Brother',model:'Brother DCP-L2622DW',
    category:'Urządzenia wielofunkcyjne',
    query:'DCP-L2622DW'
  },
  {
    name:'Drukarka Epson EcoTank L3250 + zapasowy tusz',
    brand:'Epson',model:'EcoTank L3250',
    category:'Drukarki atramentowe',
    query:'L3250'
  },
  {
    name:'Wiertarko-wkrętarka Makita DHP484 z akumulatorem',
    brand:'Makita',model:'Makita DHP484',
    category:'Wiertarko-wkrętarki',
    query:'DHP484'
  },
  {
    name:'Robot odkurzający Dreame L50 Ultra ze szczotką',
    brand:'Dreame',model:'Dreame L50 Ultra',
    category:'Odkurzacze automatyczne',
    query:'L50 Ultra'
  }
];
for (const fixture of primaryBundleFixtures) {
  assert.equal(
    classifyCandidateRelation(fixture,{query:fixture.query}).type,
    'product',
    'Full device bundle should be product: ' + fixture.name
  );
}
const accessoryNotBundles = [
  {name:'Toner do drukarki Brother DCP-L2622DW',
    model:'Brother DCP-L2622DW',category:'Tonery i bębny',query:'DCP-L2622DW'},
  {name:'Silnik do odkurzacza Dreame L50 Ultra',
    model:'Dreame L50 Ultra',category:'Części do odkurzaczy',query:'L50 Ultra'},
  {name:'Smartfon Samsung Galaxy S24 SM-S921B wyświetlacz zamienny',
    model:'Samsung SM-S921B',category:'Telefony',query:'SM-S921B'},
  {name:'Bateria do wiertarko-wkrętarki Makita DHP484',
    model:'Makita DHP484',category:'Akumulatory',query:'DHP484'}
];
for (const fixture of accessoryNotBundles) {
  assert.equal(
    classifyCandidateRelation(fixture,{query:fixture.query}).type,
    'accessory',
    'Spare part must stay accessory: ' + fixture.name
  );
}


// English accessories and categories must behave like their Polish names.
const englishAccessories = [
  {name:'Replacement Battery for Sony WH-1000XM5',category:'Batteries',model:'WH-1000XM5',query:'WH1000XM5'},
  {name:'Charging port for Samsung SM-S921B',category:'Spare Parts',model:'SM-S921B',query:'SM-S921B'},
  {name:'Screen protector for Samsung SM-S921B',category:'Accessories',model:'SM-S921B',query:'SM-S921B'},
  {name:'Replacement screen for Samsung Galaxy S24 SM-S921B',category:'Replacement Parts',model:'Galaxy S24',query:'SM-S921B'}
];
for (const item of englishAccessories) {
  assert.equal(classifyCandidateRelation(item,{query:item.query}).type,'accessory',item.name);
}
const shortCodeMain = {
  id:'epson-l3250',
  name:'Epson EcoTank L3250 drukarka',
  category:'Drukarki atramentowe',
  brand:'Epson',
  model:'L3250',
  trust:{model:true,brand:true}
};
const shortCodeNoBrand = analyzeResearchCandidates([shortCodeMain],{query:'L3250'});
assert.equal(shortCodeNoBrand.selected.id,'epson-l3250');
assert.equal(shortCodeNoBrand.requiresTesterChoice,true,'Short code without brand needs tester choice');
assert.equal(shortCodeNoBrand.ambiguity.shortModelAmbiguity,true);
const shortCodeWithBrand = analyzeResearchCandidates([shortCodeMain],{query:'L3250',brand:'Epson'});
assert.equal(shortCodeWithBrand.ambiguity.shortModelAmbiguity,false);
const shortCodeConfirmed = analyzeResearchCandidates([shortCodeMain],{query:'L3250'},'epson-l3250');
assert.equal(shortCodeConfirmed.ambiguity.shortModelAmbiguity,false);

console.log('PASS Research ranking v3: model fingerprint, primary-product ranking, accessory penalties, brand handling and query recovery.');
