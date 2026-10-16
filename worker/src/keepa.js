const DEFAULT_KEEPA_API_BASE = 'https://api.keepa.com';
const DEFAULT_DOMAIN_ID = 3; // Amazon.de

const clean = value => String(value ?? '').trim();

function first(list) {
  return Array.isArray(list) && list.length ? list[0] : '';
}

function unique(values) {
  return [...new Set((values || []).map(clean).filter(Boolean))];
}

function normalizeText(value) {
  return clean(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function normalizeCode(value) {
  const digits = clean(value).replace(/\D/g, '');
  if (!digits) return '';
  return digits.replace(/^0+(?=\d{8,}$)/, '');
}

function sameCode(a, b) {
  const aa = normalizeCode(a);
  const bb = normalizeCode(b);
  return Boolean(aa && bb && aa === bb);
}

function keepaTimeToIso(value) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes <= 0) return '';
  return new Date((minutes + 21564000) * 60000).toISOString();
}

function imageUrl(product) {
  const images = Array.isArray(product?.images) ? product.images : [];
  const image = images.find(item => clean(item?.variant).toUpperCase() === 'MAIN') || images[0];
  const filename = clean(image?.l || image?.m);
  return filename ? 'https://m.media-amazon.com/images/I/' + filename : '';
}

function categoryName(product) {
  const tree = Array.isArray(product?.categoryTree) ? product.categoryTree : [];
  const last = tree.length ? tree[tree.length - 1] : null;
  return clean(last?.name || product?.binding || product?.type);
}

function allCodes(product) {
  return unique([
    ...(Array.isArray(product?.eanList) ? product.eanList : []),
    ...(Array.isArray(product?.gtinList) ? product.gtinList : []),
    ...(Array.isArray(product?.upcList) ? product.upcList : [])
  ]);
}

function readableParameters(product) {
  const values = [
    ['Producent', product?.manufacturer],
    ['Numer części', product?.partNumber],
    ['Model', product?.model],
    ['Kolor', product?.color],
    ['Rozmiar', product?.size],
    ['Typ produktu', product?.type],
    ['Zawartość zestawu', product?.includedComponents]
  ];

  return values
    .map(([name, value]) => ({name, value:clean(value)}))
    .filter(item => item.value);
}

function completeness(product) {
  const checks = [
    Boolean(clean(product?.name)),
    Boolean(clean(product?.brand)),
    Boolean(clean(product?.manufacturer)),
    Boolean(clean(product?.model)),
    Boolean(clean(product?.partNumber)),
    Boolean(clean(product?.category)),
    Boolean(clean(product?.image)),
    Boolean(clean(product?.catalogEan || first(product?.gtinList) || first(product?.upcList)))
  ];
  return Math.round(checks.filter(Boolean).length / checks.length * 100);
}

function criticalSignature(product) {
  return [
    normalizeText(product?.model),
    normalizeText(product?.partNumber)
  ].join('|');
}

function ambiguityConflict(products) {
  const candidates = Array.isArray(products) ? products : [];
  if (candidates.length < 2) return null;

  const signatures = unique(candidates.map(criticalSignature).filter(value => value !== '|'));
  if (signatures.length <= 1) return null;

  return {
    key:'keepa:candidate',
    field:'asin',
    label:'Wiele kart Amazon dla tego samego kodu',
    severity:'critical',
    type:'candidate-disagreement',
    values:candidates.slice(0,5).map(item =>
      [item.asin, item.brand, item.model || item.partNumber, item.name]
        .filter(Boolean)
        .join(' • ')
    ),
    message:'Keepa zwróciła kilka kart Amazon różniących się modelem lub numerem części. Tester musi wybrać właściwy ASIN.'
  };
}

export function mapKeepaProduct(product, query = {}) {
  if (!product) return null;

  const eanList = unique(product.eanList);
  const gtinList = unique(product.gtinList);
  const upcList = unique(product.upcList);
  const queryEan = clean(query.ean);
  const matchedCode = allCodes(product).find(value => sameCode(value, queryEan)) || '';
  const aPlus = Array.isArray(product.aPlus) ? product.aPlus : [];
  const videos = Array.isArray(product.videos) ? product.videos : [];

  return {
    source:'keepa',
    provider:'keepa',
    catalog:'amazon',
    status:'znaleziono',
    id:clean(product.asin),
    asin:clean(product.asin),
    ean:matchedCode || first(eanList) || queryEan,
    catalogEan:first(eanList),
    eanList,
    gtinList,
    upcList,
    name:clean(product.title),
    brand:clean(product.brand),
    manufacturer:clean(product.manufacturer),
    model:clean(product.model),
    partNumber:clean(product.partNumber),
    category:categoryName(product),
    categoryId:clean(product.rootCategory),
    image:imageUrl(product),
    description:clean(product.description || product.shortDescription),
    features:Array.isArray(product.features) ? product.features.map(clean).filter(Boolean) : [],
    parameters:readableParameters(product),
    domainId:Number(product.domainId || 0) || null,
    rawProductType:clean(product.type),
    lastUpdateKeepa:Number(product.lastUpdate || 0) || null,
    lastUpdateAt:keepaTimeToIso(product.lastUpdate),
    aPlusFromManufacturer:aPlus.some(item => item?.fromManufacturer === true),
    aPlusCount:aPlus.length,
    videoCreatorTypes:unique(videos.map(item => item?.creator)),
    provenance:{
      catalog:'Amazon marketplace data via Keepa',
      fieldAuthorKnown:false,
      manufacturerVerifiedFields:[],
      manufacturerContentAvailable:aPlus.some(item => item?.fromManufacturer === true)
    }
  };
}

export function keepaConfigured(env) {
  return Boolean(clean(env.KEEPA_API_KEY));
}

export function keepaStatus(env) {
  const domainId = Number(env.KEEPA_DOMAIN_ID || DEFAULT_DOMAIN_ID) || DEFAULT_DOMAIN_ID;
  const localeByDomain = {
    1:'amazon.com',
    2:'amazon.co.uk',
    3:'amazon.de',
    4:'amazon.fr',
    5:'amazon.co.jp',
    6:'amazon.ca',
    8:'amazon.it',
    9:'amazon.es',
    10:'amazon.in',
    11:'amazon.com.mx',
    12:'amazon.com.br'
  };

  return {
    configured:keepaConfigured(env),
    provider:'keepa',
    catalog:'amazon',
    domainId,
    marketplace:localeByDomain[domainId] || ('domain ' + domainId),
    endpoint:clean(env.KEEPA_API_BASE || DEFAULT_KEEPA_API_BASE)
  };
}

async function keepaRequest(env, query = {}) {
  if (!keepaConfigured(env)) {
    throw new Error('Keepa API nie jest jeszcze skonfigurowane');
  }

  const base = clean(env.KEEPA_API_BASE || DEFAULT_KEEPA_API_BASE).replace(/\/$/, '');
  const domain = String(Number(env.KEEPA_DOMAIN_ID || DEFAULT_DOMAIN_ID) || DEFAULT_DOMAIN_ID);
  const url = new URL(base + '/product');

  url.searchParams.set('key', clean(env.KEEPA_API_KEY));
  url.searchParams.set('domain', domain);
  url.searchParams.set('history', '0');
  url.searchParams.set('aplus', '1');
  url.searchParams.set('videos', '1');

  if (query.asin) {
    url.searchParams.set('asin', clean(query.asin).toUpperCase());
  } else if (query.ean) {
    url.searchParams.set('code', clean(query.ean));
    url.searchParams.set('code-limit', '5');
  } else {
    return {products:[], tokenStatus:null};
  }

  const response = await fetch(url, {
    headers:{'accept':'application/json','accept-encoding':'gzip'}
  });
  const body = await response.json().catch(() => ({}));

  const tokenStatus = {
    tokensLeft:Number(body.tokensLeft ?? 0),
    tokensConsumed:Number(body.tokensConsumed ?? 0),
    refillRate:Number(body.refillRate ?? 0),
    refillIn:Number(body.refillIn ?? 0),
    processingTimeInMs:Number(body.processingTimeInMs ?? 0)
  };

  if (!response.ok || body?.error) {
    const message =
      body?.error?.message ||
      body?.error?.type ||
      ('Keepa HTTP ' + response.status);
    const error = new Error(message);
    error.keepa = tokenStatus;
    throw error;
  }

  return {
    products:Array.isArray(body.products) ? body.products : [],
    tokenStatus
  };
}

export async function searchKeepaCatalog(env, {asin = '', ean = ''} = {}) {
  const cleanAsin = clean(asin).toUpperCase();
  const cleanEan = clean(ean);

  if (!cleanAsin && !cleanEan) {
    return {products:[], query:{asin:'',ean:''}, tokenStatus:null};
  }

  const response = await keepaRequest(env, cleanAsin
    ? {asin:cleanAsin}
    : {ean:cleanEan}
  );

  return {
    query:{asin:cleanAsin,ean:cleanEan},
    products:response.products
      .map(product => mapKeepaProduct(product,{asin:cleanAsin,ean:cleanEan}))
      .filter(Boolean),
    tokenStatus:response.tokenStatus
  };
}

function scoreKeepaCandidate(product, query = {}) {
  const queryAsin = clean(query.asin).toUpperCase();
  const queryEan = clean(query.ean);
  const evidence = [];
  const conflicts = [];
  const hardConflictDetails = [];
  let score = 0;

  if (queryAsin && clean(product?.asin).toUpperCase() === queryAsin) {
    score += 70;
    evidence.push({
      key:'asin',
      label:'ASIN',
      status:'strong',
      points:70,
      text:'ASIN znaleziony bezpośrednio w bazie Keepa dla katalogu Amazon'
    });
  }

  const codes = unique([
    ...(product?.eanList || []),
    ...(product?.gtinList || []),
    ...(product?.upcList || [])
  ]);
  const hasCodeMatch = Boolean(queryEan && codes.some(value => sameCode(value, queryEan)));

  if (hasCodeMatch) {
    score += queryAsin ? 10 : 60;
    evidence.push({
      key:'ean',
      label:'EAN / GTIN',
      status:'strong',
      points:queryAsin ? 10 : 60,
      text:'Zeskanowany kod występuje przy tej karcie produktu w danych Keepa'
    });
  } else if (queryEan && codes.length) {
    const conflict = {
      key:'keepa:ean',
      field:'ean',
      label:'EAN / GTIN — skan vs Keepa',
      severity:'critical',
      type:'value-mismatch',
      expected:queryEan,
      actual:codes[0],
      values:['Skan: ' + queryEan, 'Keepa: ' + codes.join(', ')],
      options:[
        {choice:'query',source:'scan',label:'Zostaw zeskanowane',value:queryEan},
        {choice:'keepa',source:'keepa',label:'Użyj Keepa',value:codes[0]}
      ],
      message:'Kod zapisany przy produkcie w Keepa różni się od zeskanowanego kodu.'
    };
    conflicts.push(conflict);
    hardConflictDetails.push(conflict);
  }

  if (product?.model) {
    score += 10;
    evidence.push({key:'model',label:'Model',status:'strong',points:10,text:'Model jest dostępny'});
  }
  if (product?.partNumber) {
    score += 8;
    evidence.push({key:'partNumber',label:'Numer części',status:'strong',points:8,text:'Numer części jest dostępny'});
  }
  if (product?.brand) {
    score += 6;
    evidence.push({key:'brand',label:'Marka',status:'strong',points:6,text:'Marka jest dostępna'});
  }
  if (product?.name) {
    score += 3;
    evidence.push({key:'name',label:'Nazwa',status:'supporting',points:3,text:'Nazwa katalogowa jest dostępna'});
  }
  if (product?.category) {
    score += 3;
    evidence.push({key:'category',label:'Kategoria',status:'supporting',points:3,text:'Kategoria jest dostępna'});
  }

  if (hardConflictDetails.length) score = Math.min(score, 45);

  return {
    score:Math.max(0, Math.min(100, Math.round(score))),
    completeness:completeness(product),
    evidence,
    conflicts,
    hardConflictDetails
  };
}

export function analyzeKeepaCandidates(products, query = {}, selectedId = '') {
  const candidates = (Array.isArray(products) ? products : []).filter(Boolean);

  if (!candidates.length) {
    return {
      selected:null,
      ranked:[],
      confidence:0,
      completeness:0,
      evidence:[],
      conflicts:[],
      hardConflictDetails:[],
      requiresTesterChoice:false,
      selectedBy:'',
      confidenceMethod:'keepa-amazon-identification-v1'
    };
  }

  const ranked = candidates
    .map(product => {
      const analysis = scoreKeepaCandidate(product, query);
      return {
        ...product,
        score:analysis.score,
        completeness:analysis.completeness,
        identificationEvidence:analysis.evidence
      };
    })
    .sort((a,b) =>
      b.score - a.score ||
      b.completeness - a.completeness ||
      clean(a.asin).localeCompare(clean(b.asin))
    );

  const requested = clean(selectedId);
  const selected =
    (requested && ranked.find(item => clean(item.id) === requested)) ||
    ranked[0];

  const selectedAnalysis = scoreKeepaCandidate(selected, query);
  const ambiguity = ambiguityConflict(ranked);
  const requiresTesterChoice = Boolean(!requested && ambiguity);

  return {
    selected,
    ranked,
    confidence:requiresTesterChoice
      ? Math.min(selectedAnalysis.score, 65)
      : selectedAnalysis.score,
    completeness:selectedAnalysis.completeness,
    evidence:selectedAnalysis.evidence,
    conflicts:[
      ...(selectedAnalysis.conflicts || []),
      ...(ambiguity ? [ambiguity] : [])
    ],
    hardConflictDetails:[
      ...(selectedAnalysis.hardConflictDetails || [])
    ],
    requiresTesterChoice,
    selectedBy:requested ? 'tester' : (query.asin ? 'keepa-asin' : 'keepa-code'),
    confidenceMethod:'keepa-amazon-identification-v1'
  };
}
