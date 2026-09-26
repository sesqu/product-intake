const base = 'https://product-intake.sesquu.workers.dev';
const workspace = 'LIVE_TEST_' + 'A'.repeat(40);
const headers = {'content-type':'application/json','x-workspace-key':workspace};

async function waitForApi() {
  for (let i=0;i<18;i++) {
    const r = await fetch(base + '/api/products', {headers:{'x-workspace-key':workspace}});
    if (r.status !== 404) return;
    await new Promise(r => setTimeout(r, 10000));
  }
  throw new Error('Nowy endpoint /api/products nie został wdrożony na czas');
}

await waitForApi();

const realEans = [
  '195949544026',
  '4548736132580',
  '6925281994258'
];

for (const ean of realEans) {
  const r = await fetch(base + '/api/search?ean=' + encodeURIComponent(ean));
  if (!r.ok) throw new Error('SEARCH ' + ean + ': ' + r.status + ' ' + await r.text());
  const body = await r.json();
  if (!body.best?.name) throw new Error('SEARCH ' + ean + ': brak rozpoznanego produktu');
  if (body.confidenceMethod !== 'weighted-identification-v2') {
    throw new Error('SEARCH ' + ean + ': Worker nie używa confidence v2');
  }
  if (!Array.isArray(body.confidenceEvidence) || !body.confidenceEvidence.length) {
    throw new Error('SEARCH ' + ean + ': brak evidence dla confidence v2');
  }
  if (body.requiresTesterChoice && (!Array.isArray(body.candidates) || body.candidates.length < 2)) {
    throw new Error('SEARCH ' + ean + ': wybór testera bez kandydatów');
  }
  console.log('CATALOG', ean, '=>', body.best.name, '| brand=', body.best.brand || '', '| model=', body.best.model || '', '| category=', body.categoryMeta?.categoryName || body.best.category || '', '| confidence=', body.confidence, '| method=', body.confidenceMethod);
}





const fixtures = [
  {lpn:'LIVE-TEST-001',productName:'Live test 1',loc:'CLOUD-A1',description:'DETAIL-CHECK-001',parameterItems:[{name:'TestParam',value:'TestValue'}]},
  {lpn:'LIVE-TEST-002',productName:'Live test 2',loc:'CLOUD-A2'},
  {lpn:'LIVE-TEST-003',productName:'Live test 3',loc:'CLOUD-A3'}
];

try {
  for (const product of fixtures) {
    const r = await fetch(base + '/api/products', {
      method:'POST', headers, body:JSON.stringify({product})
    });
    if (!r.ok) throw new Error('POST ' + product.lpn + ': ' + r.status + ' ' + await r.text());
  }

  let body = null;
  for (let attempt = 0; attempt < 15; attempt++) {
    const read = await fetch(base + '/api/products', {
      headers:{'x-workspace-key':workspace}
    });
    if (!read.ok) throw new Error('GET: ' + read.status + ' ' + await read.text());
    body = await read.json();

    const lpns = new Set((body.products || []).map(p => p.lpn));
    if (fixtures.every(p => lpns.has(p.lpn))) break;

    if (attempt === 14) {
      throw new Error('Po oczekiwaniu nadal brakuje produktów: ' + fixtures.filter(p => !lpns.has(p.lpn)).map(p => p.lpn).join(', '));
    }
    await new Promise(r => setTimeout(r, 5000));
  }

  let detail = null;
  for (let attempt = 0; attempt < 18; attempt++) {
    const readDetail = await fetch(base + '/api/products?lpn=' + encodeURIComponent('LIVE-TEST-001'), {
      headers:{'x-workspace-key':workspace}
    });
    if (readDetail.ok) {
      const detailBody = await readDetail.json().catch(() => ({}));
      if (detailBody.product?.description === 'DETAIL-CHECK-001') {
        detail = detailBody.product;
        break;
      }
    }
    await new Promise(r => setTimeout(r, 10000));
  }
  if (!detail) throw new Error('DETAIL GET: pełny rekord po LPN nie został wdrożony lub nie zachował pól');
  if (!Array.isArray(detail.parameterItems) || detail.parameterItems[0]?.value !== 'TestValue') {
    throw new Error('DETAIL GET: brak parameterItems w pełnym rekordzie');
  }
  console.log('DETAIL GET PASS:', detail.lpn, detail.description);

    console.log('PASS LIVE:', fixtures.map(x=>x.lpn).join(', '), 'count=', body.count);
} finally {
  for (const product of fixtures) {
    await fetch(base + '/api/products?lpn=' + encodeURIComponent(product.lpn), {
      method:'DELETE', headers:{'x-workspace-key':workspace}
    }).catch(()=>{});
  }
}
