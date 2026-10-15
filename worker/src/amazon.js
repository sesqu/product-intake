const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';
const DEFAULT_SP_API_BASE = 'https://sellingpartnerapi-eu.amazon.com';

const clean = value => String(value ?? '').trim();
const first = value => Array.isArray(value) && value.length ? value[0] : null;

function attrValue(attributes, names) {
  if (!attributes || typeof attributes !== 'object') return '';

  for (const name of names) {
    const raw = attributes[name];
    const item = Array.isArray(raw) ? raw[0] : raw;
    if (item == null) continue;
    if (typeof item === 'string' || typeof item === 'number') return clean(item);
    if (item.value != null) return clean(item.value);
  }

  return '';
}

function identifierMap(item) {
  const output = {};

  for (const group of item?.identifiers || []) {
    for (const identifier of group?.identifiers || []) {
      const type = clean(identifier?.identifierType).toUpperCase();
      const value = clean(identifier?.identifier);
      if (type && value && !output[type]) output[type] = value;
    }
  }

  return output;
}

function mainImage(item) {
  for (const group of item?.images || []) {
    const images = Array.isArray(group?.images) ? group.images : [];
    const main = images.find(image => clean(image?.variant).toUpperCase() === 'MAIN') || images[0];
    if (main?.link) return clean(main.link);
  }
  return '';
}

function classificationName(item) {
  for (const group of item?.classifications || []) {
    const classification = first(group?.classifications);
    if (classification?.displayName) return clean(classification.displayName);
  }

  return clean(first(item?.productTypes)?.productType);
}

function readableParameters(attributes) {
  const definitions = [
    ['Producent', ['manufacturer']],
    ['Numer części', ['part_number','manufacturer_part_number']],
    ['Model', ['model_number','item_model_number']],
    ['Kolor', ['color']],
    ['Rozmiar', ['size']],
    ['Pojemność', ['capacity','storage_capacity','memory_storage_capacity']],
    ['Wariant', ['style','variation_theme']]
  ];

  return definitions
    .map(([name, aliases]) => ({ name, value: attrValue(attributes, aliases) }))
    .filter(item => item.value);
}

function candidateCompleteness(product) {
  const checks = [
    Boolean(clean(product?.name)),
    Boolean(clean(product?.brand)),
    Boolean(clean(product?.model)),
    Boolean(clean(product?.category)),
    Boolean(clean(product?.image)),
    Array.isArray(product?.parameters) && product.parameters.length > 0
  ];

  return Math.round(checks.filter(Boolean).length / checks.length * 100);
}

function normalizeIdentity(value) {
  return clean(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function mapAmazonItem(item, query = {}) {
  if (!item) return null;

  const summary = first(item.summaries) || {};
  const attributes = item.attributes || {};
  const identifiers = identifierMap(item);

  return {
    source:'amazon',
    status:'znaleziono',
    id:clean(item.asin || query.asin),
    asin:clean(item.asin || query.asin),
    ean:clean(identifiers.EAN || query.ean),
    catalogEan:clean(identifiers.EAN),
    upc:clean(identifiers.UPC),
    name:clean(summary.itemName || attrValue(attributes,['item_name','title'])),
    brand:clean(summary.brand || summary.brandName || attrValue(attributes,['brand','manufacturer'])),
    model:clean(summary.modelNumber || attrValue(attributes,['model_number','item_model_number','part_number','manufacturer_part_number'])),
    category:classificationName(item),
    categoryId:'',
    image:mainImage(item),
    description:'',
    parameters:readableParameters(attributes),
    amazonMarketplaceId:clean(first(item.summaries)?.marketplaceId || ''),
    rawProductType:clean(first(item.productTypes)?.productType || '')
  };
}

export function amazonConfigured(env) {
  return Boolean(
    env.AMAZON_LWA_CLIENT_ID &&
    env.AMAZON_LWA_CLIENT_SECRET &&
    env.AMAZON_LWA_REFRESH_TOKEN &&
    env.AMAZON_MARKETPLACE_ID
  );
}

export function amazonStatus(env) {
  return {
    configured:amazonConfigured(env),
    marketplaceId:clean(env.AMAZON_MARKETPLACE_ID),
    endpoint:clean(env.AMAZON_SP_API_BASE || DEFAULT_SP_API_BASE)
  };
}

async function storeAccessToken(env, body) {
  if (!body?.access_token) throw new Error('Amazon LWA nie zwrócił access_token');

  const expiresAt = Date.now() + Math.max(60, Number(body.expires_in || 3600)) * 1000;

  if (env.AUTH) {
    await Promise.all([
      env.AUTH.put('amazon:access_token', body.access_token),
      env.AUTH.put('amazon:expires_at', String(expiresAt))
    ]);
  }

  return {accessToken:body.access_token, expiresAt};
}

async function refreshAccessToken(env) {
  if (!amazonConfigured(env)) {
    throw new Error('Amazon SP-API nie jest jeszcze skonfigurowane');
  }

  const response = await fetch(LWA_TOKEN_URL, {
    method:'POST',
    headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
    body:new URLSearchParams({
      grant_type:'refresh_token',
      refresh_token:env.AMAZON_LWA_REFRESH_TOKEN,
      client_id:env.AMAZON_LWA_CLIENT_ID,
      client_secret:env.AMAZON_LWA_CLIENT_SECRET
    })
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok || !body.access_token) {
    throw new Error(
      body.error_description ||
      body.error ||
      ('Amazon LWA HTTP ' + response.status)
    );
  }

  return storeAccessToken(env, body);
}

async function accessToken(env) {
  if (!amazonConfigured(env)) {
    throw new Error('Amazon SP-API nie jest jeszcze skonfigurowane');
  }

  if (env.AUTH) {
    const [token, expiresRaw] = await Promise.all([
      env.AUTH.get('amazon:access_token'),
      env.AUTH.get('amazon:expires_at')
    ]);

    const expiresAt = Number(expiresRaw || 0);
    if (token && expiresAt > Date.now() + 120000) return token;
  }

  return (await refreshAccessToken(env)).accessToken;
}

function spApiDate() {
  return new Date().toISOString().replace(/[:-]|\.\d{3}/g,'');
}

async function catalogRequest(env, url) {
  const token = await accessToken(env);

  const response = await fetch(url, {
    headers:{
      'x-amz-access-token':token,
      'x-amz-date':spApiDate(),
      'user-agent':env.AMAZON_USER_AGENT || 'Product-Intake/1.2 (Language=JavaScript)'
    }
  });

  const body = await response.json().catch(() => ({}));

  if (response.status === 401 && env.AUTH) {
    await Promise.all([
      env.AUTH.delete('amazon:access_token'),
      env.AUTH.delete('amazon:expires_at')
    ]);
  }

  if (!response.ok) {
    throw new Error(
      body?.errors?.[0]?.message ||
      body?.message ||
      ('Amazon SP-API HTTP ' + response.status)
    );
  }

  return body;
}

export async function searchAmazonCatalog(env, {asin = '', ean = ''} = {}) {
  const cleanAsin = clean(asin).toUpperCase();
  const cleanEan = clean(ean);

  if (!cleanAsin && !cleanEan) return {products:[], query:{asin:'',ean:''}};
  if (!amazonConfigured(env)) {
    throw new Error('Amazon SP-API nie jest jeszcze skonfigurowane');
  }

  const base = clean(env.AMAZON_SP_API_BASE || DEFAULT_SP_API_BASE).replace(/\/$/,'');
  const marketplaceId = clean(env.AMAZON_MARKETPLACE_ID);
  const includedData = 'attributes,classifications,identifiers,images,productTypes,relationships,summaries';

  let body;

  if (cleanAsin) {
    const url = new URL(base + '/catalog/2022-04-01/items/' + encodeURIComponent(cleanAsin));
    url.searchParams.set('marketplaceIds', marketplaceId);
    url.searchParams.set('includedData', includedData);
    body = await catalogRequest(env, url);

    return {
      query:{asin:cleanAsin,ean:cleanEan},
      products:[mapAmazonItem(body,{asin:cleanAsin,ean:cleanEan})].filter(Boolean)
    };
  }

  const url = new URL(base + '/catalog/2022-04-01/items');
  url.searchParams.set('marketplaceIds', marketplaceId);
  url.searchParams.set('identifiers', cleanEan);
  url.searchParams.set('identifiersType', 'EAN');
  url.searchParams.set('includedData', includedData);
  body = await catalogRequest(env, url);

  return {
    query:{asin:'',ean:cleanEan},
    products:(body.items || []).map(item => mapAmazonItem(item,{ean:cleanEan})).filter(Boolean)
  };
}

export function analyzeAmazonCandidate(product, query = {}) {
  if (!product) {
    return {
      confidence:0,
      completeness:0,
      evidence:[],
      confidenceMethod:'amazon-catalog-identification-v1'
    };
  }

  const evidence = [];
  let score = 0;

  const queryAsin = clean(query.asin).toUpperCase();
  const queryEan = clean(query.ean);

  if (queryAsin && clean(product.asin).toUpperCase() === queryAsin) {
    score += 70;
    evidence.push({key:'asin',label:'ASIN',status:'strong',points:70,text:'ASIN potwierdzony bezpośrednio w katalogu Amazon'});
  } else if (queryEan && product.catalogEan && normalizeIdentity(product.catalogEan) === normalizeIdentity(queryEan)) {
    score += 60;
    evidence.push({key:'ean',label:'EAN / GTIN',status:'strong',points:60,text:'EAN potwierdzony w katalogu Amazon'});
  } else {
    evidence.push({key:'identifier',label:'Identyfikator',status:'medium',points:0,text:'Produkt wymaga ręcznej weryfikacji identyfikatora'});
  }

  if (product.model) {
    score += 12;
    evidence.push({key:'model',label:'Model',status:'strong',points:12,text:'Model jest określony'});
  }
  if (product.brand) {
    score += 8;
    evidence.push({key:'brand',label:'Marka',status:'strong',points:8,text:'Marka jest określona'});
  }
  if (product.name) {
    score += 5;
    evidence.push({key:'name',label:'Nazwa',status:'supporting',points:5,text:'Nazwa katalogowa jest dostępna'});
  }
  if (product.category) {
    score += 5;
    evidence.push({key:'category',label:'Kategoria',status:'supporting',points:5,text:'Kategoria jest określona'});
  }

  return {
    confidence:Math.max(0,Math.min(100,Math.round(score))),
    completeness:candidateCompleteness(product),
    evidence,
    confidenceMethod:'amazon-catalog-identification-v1'
  };
}
