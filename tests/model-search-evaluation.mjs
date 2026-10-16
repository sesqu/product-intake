const base = 'https://product-intake.sesquu.workers.dev';

const cases = [
  {label:'Sony model+brand', query:'WH-1000XM5', brand:'Sony'},
  {label:'Philips model+brand', query:'EP2220/10', brand:'Philips'},
  {label:'Dyson model+brand', query:'V15 Detect', brand:'Dyson'},
  {label:'Samsung phone model+brand', query:'SM-S921B', brand:'Samsung'},
  {label:'Bosch compact+brand', query:'GSR18V55', brand:'Bosch'},
  {label:'JBL model+brand', query:'Flip 6', brand:'JBL'}
];

for (const test of cases) {
  const response = await fetch(base + '/api/research', {
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({query:test.query,brand:test.brand})
  });
  const data = await response.json().catch(()=>({}));
  const out = {
    label:test.label,
    input:{query:test.query,brand:test.brand},
    status:response.status,
    confidence:data.confidence ?? null,
    requiresTesterChoice:Boolean(data.requiresTesterChoice),
    best:data.best ? {
      name:data.best.name || '',
      brand:data.best.brand || data.best.manufacturer || '',
      model:data.best.model || '',
      mpn:data.best.mpn || '',
      score:data.best.score ?? null,
      evidence:data.best.evidence || [],
      warnings:data.best.warnings || []
    } : null,
    top:(data.candidates || []).slice(0,5).map(x=>({
      name:x.name || '',
      brand:x.brand || x.manufacturer || '',
      model:x.model || '',
      score:x.score ?? null,
      evidence:x.evidence || [],
      warnings:x.warnings || []
    }))
  };
  console.log('BRAND_CASE_JSON ' + JSON.stringify(out));
}
