const base = 'https://product-intake.sesquu.workers.dev';

const cases = [
  {label:'Sony headphones', query:'WH-1000XM5', expectedBrand:'Sony', expectedModel:'WH-1000XM5'},
  {label:'Sony compact model', query:'WH1000XM5', expectedBrand:'Sony', expectedModel:'WH-1000XM5'},
  {label:'Bosch drill', query:'GSR 18V-55', expectedBrand:'Bosch', expectedModel:'GSR 18V-55'},
  {label:'Bosch compact model', query:'GSR18V55', expectedBrand:'Bosch', expectedModel:'GSR 18V-55'},
  {label:'Samsung TV', query:'UE55CU7172', expectedBrand:'Samsung', expectedModel:'UE55CU7172'},
  {label:'JBL speaker', query:'Flip 6', expectedBrand:'JBL', expectedModel:'Flip 6'},
  {label:'Philips coffee machine', query:'EP2220/10', expectedBrand:'Philips', expectedModel:'EP2220/10'},
  {label:'Logitech mouse', query:'G502 X', expectedBrand:'Logitech', expectedModel:'G502 X'},
  {label:'Brother printer', query:'HL-L2402D', expectedBrand:'Brother', expectedModel:'HL-L2402D'},
  {label:'TP-Link router', query:'Archer AX55', expectedBrand:'TP-Link', expectedModel:'Archer AX55'},
  {label:'Dyson vacuum', query:'V15 Detect', expectedBrand:'Dyson', expectedModel:'V15 Detect'},
  {label:'Samsung phone code', query:'SM-S921B', expectedBrand:'Samsung', expectedModel:'SM-S921B'}
];

const clean = value => String(value ?? '').trim();
const compact = value => clean(value).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'');

function scoreMatch(candidate, test) {
  if (!candidate) return {brand:false, model:false, name:false};
  const brandText = [candidate.brand,candidate.manufacturer,candidate.name].filter(Boolean).join(' ');
  const modelText = [candidate.model,candidate.mpn,candidate.name].filter(Boolean).join(' ');
  return {
    brand: compact(brandText).includes(compact(test.expectedBrand)),
    model: compact(modelText).includes(compact(test.expectedModel)),
    name: compact(candidate.name).includes(compact(test.query))
  };
}

const results = [];
for (const test of cases) {
  const started = Date.now();
  let data = null;
  let error = '';
  try {
    const response = await fetch(base + '/api/research', {
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({query:test.query})
    });
    const text = await response.text();
    if (!response.ok) {
      error = 'HTTP ' + response.status + ' ' + text.slice(0,300);
    } else {
      data = JSON.parse(text);
    }
  } catch (e) {
    error = e.message || String(e);
  }

  const best = data?.best || null;
  const match = scoreMatch(best,test);
  const top = (data?.candidates || []).slice(0,5).map(candidate => ({
    name:candidate.name || '',
    brand:candidate.brand || candidate.manufacturer || '',
    model:candidate.model || '',
    mpn:candidate.mpn || '',
    score:candidate.score ?? null,
    evidence:candidate.evidence || [],
    warnings:candidate.warnings || []
  }));

  const row = {
    label:test.label,
    query:test.query,
    expectedBrand:test.expectedBrand,
    expectedModel:test.expectedModel,
    ms:Date.now()-started,
    error,
    confidence:data?.confidence ?? null,
    requiresTesterChoice:Boolean(data?.requiresTesterChoice),
    queriesUsed:data?.queriesUsed || [],
    best:best ? {
      id:best.id || '',
      name:best.name || '',
      brand:best.brand || best.manufacturer || '',
      model:best.model || '',
      mpn:best.mpn || '',
      score:best.score ?? null,
      evidence:best.evidence || [],
      warnings:best.warnings || []
    } : null,
    match,
    top
  };
  results.push(row);
  console.log('CASE_JSON ' + JSON.stringify(row));
}

const summary = {
  total:results.length,
  withResult:results.filter(x=>x.best).length,
  expectedBrandMatch:results.filter(x=>x.match.brand).length,
  expectedModelMatch:results.filter(x=>x.match.model).length,
  exactBoth:results.filter(x=>x.match.brand && x.match.model).length,
  noResult:results.filter(x=>!x.best).map(x=>x.query),
  wrongOrWeak:results.filter(x=>x.best && !(x.match.brand && x.match.model)).map(x=>({
    query:x.query,
    best:x.best?.name || '',
    confidence:x.confidence,
    brandMatch:x.match.brand,
    modelMatch:x.match.model
  })),
  testerChoice:results.filter(x=>x.requiresTesterChoice).map(x=>x.query),
  averageConfidence:Math.round(
    results.filter(x=>Number.isFinite(Number(x.confidence)))
      .reduce((sum,x)=>sum+Number(x.confidence),0) /
    Math.max(1,results.filter(x=>Number.isFinite(Number(x.confidence))).length)
  )
};
console.log('SUMMARY_JSON ' + JSON.stringify(summary));
