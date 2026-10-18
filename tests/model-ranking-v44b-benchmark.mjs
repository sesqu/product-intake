import assert from 'node:assert/strict';
import { analyzeResearchCandidates } from '../worker/src/product-research.js';
import { buildModelQueryVariants } from '../worker/src/research-ranking-v3.js';

const base='https://product-intake.sesquu.workers.dev';

const cases=[
  {query:'WH-1000XM5',brand:'Sony',primary:/słuchawk/i},
  {query:'WH1000XM5',brand:'Sony',primary:/słuchawk/i},
  {query:'WF-1000XM5',brand:'Sony',primary:/słuchawk/i},
  {query:'Flip 6',brand:'JBL',primary:/głośnik/i},
  {query:'Charge 5',brand:'JBL',primary:/głośnik/i},
  {query:'QC45',brand:'Bose',primary:/słuchawk/i},
  {query:'G502 X',brand:'Logitech',primary:/mysz|myszka|mouse/i},
  {query:'MX Master 3S',brand:'Logitech',primary:/mysz|myszka|mouse/i},
  {query:'G Pro X Superlight 2',brand:'Logitech',primary:/mysz|myszka|mouse/i},
  {query:'Archer AX55',brand:'TP-Link',primary:/router/i},
  {query:'Archer AX23',brand:'TP-Link',primary:/router/i},
  {query:'RT-AX58U',brand:'ASUS',primary:/router/i},
  {query:'UE55CU7172',brand:'Samsung',primary:/telewizor|\btv\b/i},
  {query:'QE55Q80C',brand:'Samsung',primary:/telewizor|\btv\b/i},
  {query:'OLED55C31LA',brand:'LG',primary:/telewizor|\btv\b|oled/i},
  {query:'55PUS8518',brand:'Philips',primary:/telewizor|\btv\b/i},
  {query:'55C745',brand:'TCL',primary:/telewizor|\btv\b/i},
  {query:'HL-L2402D',brand:'Brother',primary:/drukark/i},
  {query:'DCP-L2622DW',brand:'Brother',primary:/drukark|urządzenie wielofunkcyjne|\bmfp\b/i},
  {query:'LaserJet M110w',brand:'HP',primary:/drukark|laserjet/i},
  {query:'L3250',brand:'Epson',primary:/drukark|ecotank/i},
  {query:'TS3450',brand:'Canon',primary:/drukark|pixma|urządzenie wielofunkcyjne/i},
  {query:'EP2220/10',brand:'Philips',primary:/ekspres/i},
  {query:'EP5447/90',brand:'Philips',primary:/ekspres/i},
  {query:'ECAM290.61.B',brand:'DeLonghi',primary:/ekspres/i},
  {query:'V15 Detect',brand:'Dyson',primary:/odkurzacz/i},
  {query:'V12 Detect Slim',brand:'Dyson',primary:/odkurzacz/i},
  {query:'L50 Ultra',brand:'Dreame',primary:/odkurzacz|robot/i},
  {query:'S8 MaxV Ultra',brand:'Roborock',primary:/odkurzacz|robot/i},
  {query:'GSR 18V-55',brand:'Bosch',primary:/wiertarko|wkrętark/i},
  {query:'GSR18V55',brand:'Bosch',primary:/wiertarko|wkrętark/i},
  {query:'GSB 18V-55',brand:'Bosch',primary:/wiertarko|wkrętark/i},
  {query:'GWS 18V-10',brand:'Bosch',primary:/szlifierk/i},
  {query:'DDF485',brand:'Makita',primary:/wiertarko|wkrętark|drill driver|\btool\b/i},
  {query:'DHP484',brand:'Makita',primary:/wiertarko|wkrętark|drill driver|\btool\b/i},
  {query:'DGA504',brand:'Makita',primary:/szlifierk/i},
  {query:'DCD791',brand:'DeWalt',primary:/wiertarko|wkrętark|drill driver|wiertarka/i},
  {query:'DCD796',brand:'DeWalt',primary:/wiertarko|wkrętark|drill driver|wiertarka/i},
  {query:'SM-S921B',brand:'Samsung',primary:/telefon|smartfon|galaxy s24(?!\+)/i},
  {query:'SM-S928B',brand:'Samsung',primary:/telefon|smartfon|galaxy s24 ultra/i},
  {query:'SM-A556B',brand:'Samsung',primary:/telefon|smartfon|galaxy a55/i},
  {query:'14T',brand:'Xiaomi',primary:/telefon|smartfon|xiaomi 14t/i},
  {query:'HD9252/90',brand:'Philips',primary:/frytkown|airfryer|air fryer/i},
  {query:'AF400EU',brand:'Ninja',primary:/frytkown|airfryer|air fryer/i},
  {query:'EY505D15',brand:'Tefal',primary:/frytkown|airfryer|air fryer/i},
  {query:'MZ-V9P1T0BW',brand:'Samsung',primary:/dysk|ssd/i},
  {query:'SNV2S/1000G',brand:'Kingston',primary:/dysk|ssd/i},
  {query:'27GP850-B',brand:'LG',primary:/monitor/i},
  {query:'G2724D',brand:'Dell',primary:/monitor/i},
  {query:'S27AG550',brand:'Samsung',primary:/monitor/i}
];

const accessory=/\bbateria\b|\bakumulator\b|\betui\b|futerał|pokrowiec|\bfiltr\b|uchwyt|toner|bęben|chip|złącze|złącza|płytka|płyta główna|mocowanie|osłona|wyświetlacz|ekran|klapka|część|obudowa|czujnik|adapter|ładowark|szkło|folia|pilot|mop|szmatk|szczotk|worki|worek|akcesori|silnik|wyłącznik|przełącznik|pierścień|koło zębate|grzałka|kosz|głośnik rozmów|nausznik|nakładk|łącznik|stojak|noga|głowica|korpus|charging board|wymiana ekranu|głośnik.*galaxy|galaxy.*głośnik/i;

function normalize(value=''){
  return String(value).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/ł/g,'l');
}
function brandMatch(candidate,brand){
  const explicit=normalize(candidate?.brand||candidate?.manufacturer||'').replace(/[^a-z0-9]+/g,'');
  const expected=normalize(brand).replace(/[^a-z0-9]+/g,'');
  if (!expected) return true;
  if (explicit && !['bezmarki','nieznanyproducent','unknown','unbranded'].includes(explicit)) {
    return explicit.includes(expected) || expected.includes(explicit);
  }
  const text=normalize(candidate?.name||'').replace(/[^a-z0-9]+/g,'');
  return text.includes(expected);
}
const nonFunctional=/\batrapa\b|\beksponat\b|\bprezenter\b|\bdummy\b|display dummy|display unit|nonfunctional/i;
function isPrimary(candidate,test){
  const name=String(candidate?.name||'');
  const corpus=[name,candidate?.category||''].filter(Boolean).join(' ');
  const compact=value=>normalize(value).replace(/[^a-z0-9]+/g,'');
  const nameCompact=compact(name);
  const queryCompact=compact(test.query);
  const structured=[candidate?.model,candidate?.mpn].map(compact).filter(Boolean);
  const exactStructured=structured.includes(queryCompact);
  const identityInName=Boolean(queryCompact && nameCompact.includes(queryCompact));
  const conflictingStructured=Boolean(
    structured.length && !exactStructured &&
    structured.every(value=>!value.includes(queryCompact) && !queryCompact.includes(value))
  );
  const hasIdentity=exactStructured || (identityInName && !conflictingStructured);
  return Boolean(
    name && hasIdentity &&
    (test.primary.test(corpus) || exactStructured) &&
    brandMatch(candidate,test.brand) &&
    !accessory.test(name) &&
    !nonFunctional.test(name) &&
    candidate?.relation?.type!=='accessory'
  );
}


const groundTruthTraps = [
  {
    query:'14T',brand:'Xiaomi',primary:/smartfon/i,
    candidate:{name:'Atrapa eksponat prezenter smartfon XIAOMI 14T',brand:'Xiaomi',model:'14T'},
    expected:false
  },
  {
    query:'DHP484',brand:'Makita',primary:/wiertark|wkrętark/i,
    candidate:{name:'Makita DLX2180TJ DTD153 DHP484 zestaw wkrętarek',brand:'Makita',model:'DLX2180TJ'},
    expected:false
  },
  {
    query:'GWS 18V-10',brand:'Bosch',primary:/szlifierk/i,
    candidate:{name:'Szlifierka Bosch 1000 W 18 V',brand:'Bosch',model:'inne'},
    expected:false
  },
  {
    query:'GSR 18V-55',brand:'Bosch',primary:/wiertark|wkrętark/i,
    candidate:{name:'Bosch GSR 18V-55 wiertarko-wkrętarka',brand:'Bosch',model:'GSR 18V-55'},
    expected:true
  }
];
for (const item of groundTruthTraps) {
  assert.equal(isPrimary(item.candidate,item),item.expected,'Ground-truth evaluator: '+item.query);
}

function unique(items){
  const seen=new Set();
  return (items||[]).filter(item=>{
    const key=String(item?.id||item?.name||'');
    if(!key||seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
async function lookup(body){
  const response=await fetch(base+'/api/research',{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify(body),
    signal:AbortSignal.timeout(15000)
  });
  const text=await response.text();
  if(!response.ok) return {error:'HTTP '+response.status+' '+text.slice(0,160),candidates:[]};
  return JSON.parse(text);
}

const rows=[];
for(let i=0;i<cases.length;i++){
  const test=cases[i];
  const baseline=await lookup({query:test.query});
  const initial=baseline.candidates||[];
  const variants=buildModelQueryVariants({query:test.query},initial);
  const gathered=[...initial];

  for(const variant of variants.slice(1,2)){
    const extra=await lookup({query:variant});
    gathered.push(...(extra.candidates||[]));
  }

  const candidates=unique(gathered);
  const local=analyzeResearchCandidates(candidates,{query:test.query});
  const baselineName=baseline.best?.name||'';
  const localName=local.selected?.name||'';
  const top3=(local.ranked||[]).slice(0,3);

  const row={
    index:i+1,
    query:test.query,
    brand:test.brand,
    baseline:{
      name:baselineName,
      score:baseline.confidence??0,
      correct:isPrimary(baseline.best||{},test),
      accessory:accessory.test(baselineName)
    },
    v44b:{
      name:localName,
      score:local.confidence??0,
      correct:isPrimary(local.selected||{},test),
      top3Correct:top3.some(item=>isPrimary(item,test)),
      accessory:local.selected?.relation?.type==='accessory'||accessory.test(localName),
      testerChoice:Boolean(local.requiresTesterChoice),
      top3:top3.map(item=>({name:item.name||'',score:item.score??0,relation:item.relation?.type||''}))
    },
    variants
  };
  rows.push(row);
  console.log('BENCH_JSON '+JSON.stringify(row));
}

const summary={
  benchmarkSource:'production-v43-candidates+local-v44b-ranking',
  validatesLiveMpn:false,
  exactIdentityTesterGate:true,
  primaryProductBundleGuard:true,
  commit:process.env.GITHUB_SHA || 'local',
  total:rows.length,
  baselineTop1:rows.filter(x=>x.baseline.correct).length,
  v44bTop1:rows.filter(x=>x.v44b.correct).length,
  v44bTop3:rows.filter(x=>x.v44b.top3Correct).length,
  baselineAccessoryTop1:rows.filter(x=>x.baseline.accessory).length,
  v44bAccessoryTop1:rows.filter(x=>x.v44b.accessory).length,
  v44bTesterChoice:rows.filter(x=>x.v44b.testerChoice).length,
  improved:rows.filter(x=>!x.baseline.correct&&x.v44b.correct).map(x=>x.query),
  regressed:rows.filter(x=>x.baseline.correct&&!x.v44b.correct).map(x=>x.query),
  falseConfident:rows.filter(x=>!x.v44b.correct&&x.v44b.score>=55&&!x.v44b.testerChoice).map(x=>({query:x.query,name:x.v44b.name,score:x.v44b.score})),
  missingTop3:rows.filter(x=>!x.v44b.top3Correct).map(x=>({query:x.query,name:x.v44b.name,score:x.v44b.score,testerChoice:x.v44b.testerChoice}))
};
console.log('SUMMARY_JSON '+JSON.stringify(summary));
if (summary.regressed.length || summary.falseConfident.length) {
  console.error('BENCH_GATE_FAIL '+JSON.stringify({
    regressions:summary.regressed,
    falseConfident:summary.falseConfident
  }));
  process.exitCode = 1;
}
