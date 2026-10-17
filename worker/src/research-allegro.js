import { buildModelQueryVariants } from './research-ranking-v3.js';
const AAPI = 'https://api.allegro.pl';
const clean = value => String(value ?? '').trim();
const norm = value => clean(value).toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu,' ').trim();


function first(values) {
  return Array.isArray(values) && values.length ? values[0] : '';
}

function hintValue(product,names) {
  const wanted = names.map(norm);
  for (const parameter of product?.parameters || []) {
    const name = norm(parameter?.name || parameter?.id);
    if (!wanted.some(item => name === item || name.includes(item))) continue;
    const value = clean(first(parameter?.valuesLabels) || first(parameter?.values));
    if (value) return value;
  }
  return '';
}

function candidateHint(product) {
  return {
    name:clean(product?.name),
    model:hintValue(product,['model']),
    mpn:hintValue(product,[
      'kod producenta',
      'numer katalogowy',
      'numer katalogowy części',
      'manufacturer code',
      'manufacturer part number',
      'mpn'
    ])
  };
}

function unique(values) {
  const seen = new Set();
  return (values || []).map(clean).filter(Boolean).filter(value => {
    const key = norm(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildAllegroResearchQueries(input = {}) {
  const query = clean(input.query);
  const brand = clean(input.brand || input.manufacturer);
  const model = clean(input.model);
  const mpn = clean(input.mpn);
  const details = clean(input.details);

  return unique([
    query,
    mpn,
    [brand,model].filter(Boolean).join(' '),
    model,
    details ? [brand,details].filter(Boolean).join(' ') : ''
  ]).slice(0,2);
}

async function requestProducts(token, userAgent, phrase) {
  const url = new URL(AAPI + '/sale/products');
  url.searchParams.set('phrase', phrase);
  url.searchParams.set('language', 'pl-PL');

  const response = await fetch(url, {
    headers:{
      authorization:'Bearer ' + token,
      accept:'application/vnd.allegro.public.v1+json',
      'accept-language':'pl-PL',
      'user-agent':userAgent || 'Product-Intake/1.3 (+https://github.com/sesqu/product-intake)'
    }
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.errors?.[0]?.message || ('Allegro research HTTP ' + response.status));
  }

  return Array.isArray(body.products) ? body.products : [];
}

export async function searchAllegroForResearch({token,userAgent,input} = {}) {
  if (!token) throw new Error('Brak tokenu Allegro');

  const queries = buildAllegroResearchQueries(input);
  if (!queries.length) return {products:[],queriesUsed:[]};

  const queriesUsed = [];
  const products = [];
  const seen = new Set();
  const seenQueries = new Set();

  async function runPhrase(phrase) {
    const key = norm(phrase);
    if (!key || seenQueries.has(key) || queriesUsed.length >= 3) return;
    seenQueries.add(key);
    queriesUsed.push(phrase);

    const found = await requestProducts(token,userAgent,phrase);
    for (const product of found) {
      const id = clean(product?.id);
      const productKey = id || norm(product?.name);
      if (!productKey || seen.has(productKey)) continue;
      seen.add(productKey);
      products.push(product);
    }
  }

  for (const phrase of queries) {
    await runPhrase(phrase);
  }

  const recovered = (
    input?.query &&
    !input?.brand &&
    !input?.manufacturer &&
    !input?.model &&
    !input?.mpn
  )
    ? buildModelQueryVariants(input,products.map(candidateHint))
    : [];

  for (const phrase of recovered) {
    await runPhrase(phrase);
  }

  return {products:products.slice(0,40),queriesUsed};
}
