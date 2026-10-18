const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const fields={};
for(const id of [
  'productName','brand','model','category','parameters','asin','ean','lpn',
  'confidencePct','sumIdentification','confidenceBar',
  'eanLabel','eanRequirement','rEan','gpsrStatus','gpsrDetails','productFinderAsin'
]){
  fields[id]={value:'',textContent:'',dataset:{},style:{}};
}
fields.lpn.value='LPN-test';
fields.ean.value='';
let identified=false;
let saved=0;
let history=[];
const win={};
const confirmationDecisions=[];
const safe=x=>String(x??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
vm.runInNewContext(fs.readFileSync('catalog-lookup.js','utf8'),{
  window:win,
  document:{getElementById:id=>fields[id]||null},
  confirm:()=>confirmationDecisions.shift()===true,
  Date
});
const lookup=win.ProductIntakeCatalogLookup;
lookup.setup({
  safe,toast(){},
  setIdentified:value=>{identified=value},
  saveDraft(){saved++},
  addHistory:(event,message)=>{history.push({event,message})},
  quality(){}
});
const product={
  source:'amazon',
  asin:'B072MQ5BRX',id:'B072MQ5BRX',asinMatched:true,
  name:'Testowy telefon Amazon',brand:'Samsung',model:'SM-S921B',
  mpn:'SM-S921B',ean:'',category:'Telefony',
  image:'https://m.media-amazon.com/images/a.jpg',
  parameters:[{name:'Kolor',value:'czarny'}]
};
const result={
  source:'amazon',marketplace:'amazon.pl',provider:'serpapi-amazon-product',
  query:{asin:'B072MQ5BRX',domain:'amazon.pl'},
  best:product,confidence:null,requiresTesterChoice:true
};
assert.equal(lookup.acceptAsinResult(result),true);
assert.equal(identified,true);
assert.equal(saved,1);
assert.equal(fields.productName.value,'Testowy telefon Amazon');
assert.equal(fields.asin.value,'B072MQ5BRX');
assert.equal(fields.ean.value,'','Missing Amazon EAN cannot be fabricated');
assert.equal(fields.brand.value,'Samsung');
assert.equal(fields.model.value,'SM-S921B');
assert.equal(fields.confidencePct.textContent,'—','Unknown source confidence is not 0%');
assert.equal(lookup.getState().confidence,null);
const state=lookup.getState();
assert.equal(state.sourceSnapshot.amazon.asin,'B072MQ5BRX');
assert.equal(state.sourceSnapshot.amazon.provider,'serpapi-amazon-product');
assert.equal(state.sourceSnapshot.amazon.verifiedByTester,true);
assert.equal(state.sourceSnapshot.amazon.confidence,null);
assert.equal(state.sourceSnapshot.allegro,undefined,'Amazon must never be mislabelled Allegro');
assert.equal(history[0].event,'Tester potwierdził ASIN Amazon');
assert.equal(state.identification.selectedBy,'tester');

const savedBefore=saved;
assert.equal(lookup.acceptAsinResult({...result,best:{...product,asinMatched:false}}),false);
assert.equal(saved,savedBefore,'Unverified catalog ASIN must not be imported');
assert.equal(lookup.acceptAsinResult({...result,best:{...product,asin:'B072MQ5BRZ'}}),false);
assert.equal(saved,savedBefore);
assert.equal(lookup.acceptAsinResult({...result,source:'allegro'}),false);
const conflictRecord={
  ...product,
  name:'Amazon chce zmienić nazwę',
  brand:'Inna marka',
  model:'Inny model',
  category:'Inne kategorie'
};
fields.productName.value='Ręcznie zweryfikowana nazwa';
fields.brand.value='Zaufana marka';
fields.model.value='Ręczny model';
fields.category.value='Nasza kategoria';
fields.parameters.value='Waga: 1 kg';
confirmationDecisions.push(false,false,false,false,false);
assert.equal(lookup.acceptAsinResult({...result,best:conflictRecord}),true);
assert.equal(fields.productName.value,'Ręcznie zweryfikowana nazwa');
assert.equal(fields.brand.value,'Zaufana marka');
assert.equal(fields.model.value,'Ręczny model');
assert.equal(fields.category.value,'Nasza kategoria');
assert.equal(fields.parameters.value,'Waga: 1 kg');
assert.equal(lookup.getState().sourceSnapshot.amazon.name,'Amazon chce zmienić nazwę',
  'Original source data must remain intact even if tester keeps existing field');
assert.equal(lookup.getState().sourceSnapshot.amazon.fieldChoices.name.selected,'existing');
assert.equal(lookup.getState().sourceSnapshot.amazon.fieldChoices.parameters.selected,'existing');

confirmationDecisions.push(true,false,false,false,false);
assert.equal(lookup.acceptAsinResult({...result,best:conflictRecord}),true);
assert.equal(fields.productName.value,'Amazon chce zmienić nazwę',
  'Tester can explicitly choose Amazon value without losing other existing fields');
assert.equal(fields.brand.value,'Zaufana marka');
assert.equal(lookup.getState().sourceSnapshot.amazon.fieldChoices.name.selected,'amazon');
(async()=>{
  // The legacy "Sprawdź produkt" button must not route ASIN to EAN-only Allegro.
  let delegated=0;
  win.ProductIntakeProductFinder={runSearch:async({force})=>{
    assert.equal(force,true);
    delegated++;
  }};
  fields.ean.value='';
  fields.asin.value='B072MQ5BRX';
  await win.lookup();
  assert.equal(delegated,1);
  assert.equal(fields.productFinderAsin.value,'B072MQ5BRX');

  fields.productFinderAsin.value='';
  fields.asin.value='wrong';
  await win.lookup();
  assert.equal(delegated,1,'Invalid ASIN must never invoke search');
  console.log('PASS Amazon ASIN master: explicit tester acceptance, conflict controls, and legacy ASIN button route.');
})().catch(error=>{console.error(error);process.exitCode=1;});