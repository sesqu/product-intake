import express from 'express';
import cors from 'cors';

const app = express();
const port = Number(process.env.PORT || 3000);
const allowedOrigin = process.env.ALLOWED_ORIGIN || 'https://sesqu.github.io';

app.use(cors({ origin: allowedOrigin }));
app.use(express.json({ limit: '1mb' }));

const tokenCache = {
  allegro: { token: null, refreshToken: null, expiresAt: 0 },
  amazon: { token: null, expiresAt: 0 }
};

const now = () => Date.now();
const clean = v => String(v ?? '').trim();
const norm = v => clean(v).toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const first = a => Array.isArray(a) && a.length ? a[0] : null;

async function exchangeAllegroToken(params) {
  const id = process.env.ALLEGRO_CLIENT_ID;
  const secret = process.env.ALLEGRO_CLIENT_SECRET;
  if (!id || !secret) throw new Error('Allegro credentials are not configured');

  const auth = Buffer.from(id + ':' + secret).toString('base64');
  const r = await fetch(process.env.ALLEGRO_TOKEN_URL || 'https://allegro.pl/auth/oauth/token', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + auth,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams(params)
  });
  const body = await r.json().catch(()=>({}));
  if (!r.ok || !body.access_token) {
    throw new Error('Allegro OAuth error: ' + (body.error_description || body.error || r.status));
  }

  tokenCache.allegro = {
    token: body.access_token,
    refreshToken: body.refresh_token || tokenCache.allegro.refreshToken || process.env.ALLEGRO_REFRESH_TOKEN || null,
    expiresAt: now() + Math.max(60, Number(body.expires_in || 3600)) * 1000
  };
  return body;
}

async function allegroToken() {
  if (tokenCache.allegro.token && tokenCache.allegro.expiresAt > now() + 60_000) {
    return tokenCache.allegro.token;
  }

  const refreshToken = tokenCache.allegro.refreshToken || process.env.ALLEGRO_REFRESH_TOKEN;
  if (!refreshToken) {
    throw new Error('Allegro account is not connected yet');
  }

  const body = await exchangeAllegroToken({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    redirect_uri: process.env.ALLEGRO_REDIRECT_URI || ''
  });
  return body.access_token;
}

function allegroParam(product, names) {
  const wanted = names.map(norm);
  for (const p of product?.parameters || []) {
    if (!wanted.includes(norm(p.name))) continue;
    const labels = p.valuesLabels || p.values || [];
    if (Array.isArray(labels) && labels.length) return clean(labels[0]);
  }
  return '';
}

function mapAllegro(product, searchedEan='') {
  if (!product) return null;
  return {
    source: 'allegro',
    status: 'znaleziono',
    id: product.id || '',
    name: product.name || '',
    ean: allegroParam(product, ['EAN','GTIN']) || searchedEan,
    asin: '',
    brand: allegroParam(product, ['Marka','Brand']),
    model: allegroParam(product, ['Model','Kod producenta','Manufacturer code','MPN']),
    category: product.category?.path?.at?.(-1)?.name || product.category?.name || product.category?.id || '',
    image: first(product.images)?.url || '',
    parameters: (product.parameters || []).slice(0,30).map(p => ({
      name: p.name || p.id,
      value: first(p.valuesLabels) || first(p.values) || ''
    }))
  };
}

async function searchAllegro(ean) {
  if (!ean) return null;
  const token = await allegroToken();
  const url = new URL((process.env.ALLEGRO_API_BASE || 'https://api.allegro.pl') + '/sale/products');
  url.searchParams.set('phrase', ean);
  url.searchParams.set('mode', 'GTIN');
  url.searchParams.set('language', 'pl-PL');
  const r = await fetch(url, {
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.allegro.public.v1+json',
      'Accept-Language': 'pl-PL'
    }
  });
  const body = await r.json().catch(()=>({}));
  if (!r.ok) throw new Error('Allegro API error: ' + (body?.errors?.[0]?.message || r.status));
  return mapAllegro(first(body.products), ean);
}

async function amazonToken() {
  if (tokenCache.amazon.token && tokenCache.amazon.expiresAt > now() + 60_000) return tokenCache.amazon.token;
  const id = process.env.AMAZON_LWA_CLIENT_ID;
  const secret = process.env.AMAZON_LWA_CLIENT_SECRET;
  const refresh = process.env.AMAZON_LWA_REFRESH_TOKEN;
  if (!id || !secret || !refresh) throw new Error('Amazon credentials are not configured');
  const r = await fetch('https://api.amazon.com/auth/o2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refresh,
      client_id: id,
      client_secret: secret
    })
  });
  const body = await r.json().catch(()=>({}));
  if (!r.ok || !body.access_token) throw new Error('Amazon LWA error: ' + (body.error_description || body.error || r.status));
  tokenCache.amazon = {
    token: body.access_token,
    expiresAt: now() + Math.max(60, Number(body.expires_in || 3600)) * 1000
  };
  return body.access_token;
}

const pickAttr = (attrs, names) => {
  if (!attrs) return '';
  for (const n of names) {
    const v = attrs[n];
    const item = Array.isArray(v) ? v[0] : v;
    if (item == null) continue;
    if (typeof item === 'string' || typeof item === 'number') return clean(item);
    if (item.value != null) return clean(item.value);
  }
  return '';
};

function amazonIdentifiers(item) {
  const groups = item?.identifiers || [];
  const out = {};
  for (const group of groups) {
    for (const id of group.identifiers || []) {
      const type = clean(id.identifierType).toUpperCase();
      if (type && id.identifier) out[type] = clean(id.identifier);
    }
  }
  return out;
}

function mapAmazon(item, searchedEan='', searchedAsin='') {
  if (!item) return null;
  const summary = first(item.summaries) || {};
  const attrs = item.attributes || {};
  const ids = amazonIdentifiers(item);
  return {
    source: 'amazon',
    status: 'znaleziono',
    id: item.asin || searchedAsin || '',
    asin: item.asin || searchedAsin || '',
    ean: ids.EAN || searchedEan || '',
    name: summary.itemName || pickAttr(attrs,['item_name','title']) || '',
    brand: summary.brand || summary.brandName || pickAttr(attrs,['brand','manufacturer']) || '',
    model: summary.modelNumber || pickAttr(attrs,['model_number','part_number','manufacturer_part_number']) || '',
    category: first(item.productTypes)?.productType || first(item.classifications)?.displayName || '',
    image: first(first(item.images)?.images)?.link || '',
    parameters: [
      ['Producent', pickAttr(attrs,['manufacturer'])],
      ['Numer części', pickAttr(attrs,['part_number','manufacturer_part_number'])],
      ['Kolor', pickAttr(attrs,['color'])],
      ['Rozmiar', pickAttr(attrs,['size'])]
    ].filter(([,v])=>v).map(([name,value])=>({name,value}))
  };
}

async function searchAmazon({ean, asin}) {
  if (!ean && !asin) return null;
  const marketplaceId = process.env.AMAZON_MARKETPLACE_ID;
  if (!marketplaceId) throw new Error('AMAZON_MARKETPLACE_ID is not configured');
  const token = await amazonToken();
  const base = process.env.AMAZON_SP_API_BASE || 'https://sellingpartnerapi-eu.amazon.com';
  let url;
  if (asin) {
    url = new URL(base + '/catalog/2022-04-01/items/' + encodeURIComponent(asin));
    url.searchParams.set('marketplaceIds', marketplaceId);
  } else {
    url = new URL(base + '/catalog/2022-04-01/items');
    url.searchParams.set('marketplaceIds', marketplaceId);
    url.searchParams.set('identifiers', ean);
    url.searchParams.set('identifiersType', 'EAN');
  }
  url.searchParams.set('includedData', 'attributes,identifiers,images,productTypes,summaries');
  const r = await fetch(url, {
    headers: {
      'x-amz-access-token': token,
      'x-amz-date': new Date().toISOString().replace(/[:-]|\.\d{3}/g,''),
      'user-agent': 'ProductIntake/0.1 (Language=JavaScript/Node.js)'
    }
  });
  const body = await r.json().catch(()=>({}));
  if (!r.ok) throw new Error('Amazon SP-API error: ' + (body?.errors?.[0]?.message || r.status));
  const item = asin ? body : first(body.items);
  return mapAmazon(item, ean, asin);
}

function tokenSimilarity(a,b) {
  const A = new Set(norm(a).split(' ').filter(Boolean));
  const B = new Set(norm(b).split(' ').filter(Boolean));
  if (!A.size || !B.size) return null;
  const same = [...A].filter(x=>B.has(x)).length;
  return same / new Set([...A,...B]).size;
}

function compare(allegro, amazon) {
  const checks = [];
  const hardConflicts = [];
  let score = 0, possible = 0;
  const add = (label, a, b, weight, hard=false) => {
    if (!a || !b) {
      checks.push({label, value: clean(a||b)||'brak', status:'warn', text:'jedno źródło'});
      return;
    }
    possible += weight;
    const ok = norm(a) === norm(b);
    if (ok) score += weight;
    else if (label === 'Nazwa') {
      const sim = tokenSimilarity(a,b) ?? 0;
      score += weight * sim;
      if (sim < .45 && hard) hardConflicts.push(label);
    } else if (hard) hardConflicts.push(label);
    checks.push({label, value: ok ? clean(a) : clean(a)+' ↔ '+clean(b), status: ok ? 'ok' : 'warn', text: ok ? 'zgodne' : 'sprawdź'});
  };
  if (allegro && amazon) {
    add('EAN', allegro.ean, amazon.ean, 30, true);
    add('Marka', allegro.brand, amazon.brand, 20, true);
    add('Model', allegro.model, amazon.model, 30, true);
    add('Nazwa', allegro.name, amazon.name, 20, false);
  } else {
    const only = allegro || amazon;
    checks.push({label:'Źródła',value:only?.source || 'brak',status:'warn',text:'tylko jedno'});
    score = only ? 65 : 0;
    possible = 100;
  }
  const confidence = possible ? Math.round((score/possible)*100) : 0;
  return { confidence, checks, hardConflicts:[...new Set(hardConflicts)] };
}

function chooseBest(allegro, amazon) {
  const a = allegro || amazon;
  const b = amazon || allegro;
  if (!a) return null;
  return {
    name: a.name || b?.name || '',
    brand: a.brand || b?.brand || '',
    model: a.model || b?.model || '',
    category: a.category || b?.category || '',
    ean: a.ean || b?.ean || '',
    asin: amazon?.asin || '',
    image: a.image || b?.image || '',
    parameters: a.parameters?.length ? a.parameters : (b?.parameters || [])
  };
}

app.get('/api/allegro/auth-url', (req,res) => {
  const clientId = process.env.ALLEGRO_CLIENT_ID;
  const redirectUri = process.env.ALLEGRO_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    return res.status(500).json({error:'ALLEGRO_CLIENT_ID or ALLEGRO_REDIRECT_URI is not configured'});
  }
  const url = new URL('https://allegro.pl/auth/oauth/authorize');
  url.searchParams.set('response_type','code');
  url.searchParams.set('client_id',clientId);
  url.searchParams.set('redirect_uri',redirectUri);
  res.json({url:url.toString()});
});

app.post('/api/allegro/exchange', async (req,res) => {
  try {
    const code = clean(req.body?.code);
    if (!code) return res.status(400).json({error:'Missing authorization code'});
    const body = await exchangeAllegroToken({
      grant_type:'authorization_code',
      code,
      redirect_uri: process.env.ALLEGRO_REDIRECT_URI || ''
    });
    res.json({
      ok:true,
      expiresIn:body.expires_in,
      hasRefreshToken:Boolean(body.refresh_token)
    });
  } catch (e) {
    res.status(502).json({error:e.message});
  }
});

app.get('/api/allegro/status', async (req,res) => {
  const hasRefresh = Boolean(tokenCache.allegro.refreshToken || process.env.ALLEGRO_REFRESH_TOKEN);
  res.json({
    configured:Boolean(process.env.ALLEGRO_CLIENT_ID && process.env.ALLEGRO_CLIENT_SECRET && process.env.ALLEGRO_REDIRECT_URI),
    connected:hasRefresh
  });
});

app.get('/health', (req,res) => {
  res.json({
    status:'ok',
    version:'0.1.0',
    integrations:{
      allegro:Boolean(process.env.ALLEGRO_CLIENT_ID && process.env.ALLEGRO_CLIENT_SECRET && process.env.ALLEGRO_REDIRECT_URI),
      amazon:Boolean(process.env.AMAZON_LWA_CLIENT_ID && process.env.AMAZON_LWA_CLIENT_SECRET && process.env.AMAZON_LWA_REFRESH_TOKEN && process.env.AMAZON_MARKETPLACE_ID)
    }
  });
});

app.get('/api/search', async (req,res) => {
  const ean = clean(req.query.ean);
  const asin = clean(req.query.asin).toUpperCase();
  if (!ean && !asin) return res.status(400).json({error:'Podaj ean lub asin'});
  const results = await Promise.allSettled([
    ean ? searchAllegro(ean) : Promise.resolve(null),
    searchAmazon({ean,asin})
  ]);
  const allegro = results[0].status === 'fulfilled' ? results[0].value : null;
  const amazon = results[1].status === 'fulfilled' ? results[1].value : null;
  const errors = [];
  if (results[0].status === 'rejected') errors.push({source:'allegro',message:results[0].reason.message});
  if (results[1].status === 'rejected') errors.push({source:'amazon',message:results[1].reason.message});
  if (!allegro && !amazon && errors.length) return res.status(502).json({error:'Żadne źródło nie odpowiedziało poprawnie',errors});
  const cmp = compare(allegro, amazon);
  res.json({
    query:{ean,asin},
    sources:{allegro,amazon},
    best:chooseBest(allegro,amazon),
    ...cmp,
    errors
  });
});

app.use((err,req,res,next) => {
  console.error(err);
  res.status(500).json({error:'Internal server error'});
});

app.listen(port, () => console.log('Product Intake API listening on :' + port));
