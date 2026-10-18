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
    brand:hintValue(product,['marka','brand','producent','manufacturer']),
    manufacturer:hintValue(product,['producent','manufacturer','marka','brand']),
    model:hintValue(product,['model']),
    mpn:hintValue(product,[
      'kod producenta',
      'numer katalogowy',
      'numer katalogowy części',
      'manufacturer code',
      'manufacturer part number',
      'mpn'
    ]),
    category:clean(product?.category?.name || product?.category?.id)
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

export function shouldTryMpnMode(input = {}) {
  const explicit = clean(input.mpn);
  if (explicit) return true;

  const value = clean(input.model || input.query);
  if (!value || value.length < 4 || value.length > 32) return false;

  const compact = value.replace(/[^A-Za-z0-9]/g,'');
  if (compact.length < 4 || compact.length > 28) return false;
  if (!/[A-Za-z]/.test(compact) || !/\d/.test(compact)) return false;

  const tokens = value.split(/\s+/).filter(Boolean);
  return tokens.length <= 3;
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

async function requestProducts(token, userAgent, phrase, mode = '') {
  const url = new URL(AAPI + '/sale/products');
  url.searchParams.set('phrase', phrase);
  if (mode) url.searchParams.set('mode', mode);
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
    const error = new Error(body?.errors?.[0]?.message || ('Allegro research HTTP ' + response.status));
    error.status = response.status;
    throw error;
  }

  return Array.isArray(body.products) ? body.products : [];
}

export async function searchAllegroForResearch({token,userAgent,input} = {}) {
  if (!token) throw new Error('Brak tokenu Allegro');

  const queries = buildAllegroResearchQueries(input);
  if (!queries.length) return {products:[],queriesUsed:[]};

  const queriesUsed = [];
  const searchAttempts = [];
  const products = [];
  const seen = new Set();
  const firstSeenById = {};
  const seenRequests = new Set();
  const maxAttempts = 3;

  async function runPhrase(phrase, mode = '', reason = 'phrase') {
    const phraseKey = norm(phrase);
    const requestKey = [mode || 'PHRASE', phraseKey].join('|');
    if (!phraseKey || seenRequests.has(requestKey) || searchAttempts.length >= maxAttempts) return;

    seenRequests.add(requestKey);
    queriesUsed.push(mode ? phrase + ' [' + mode + ']' : phrase);
    const attempt = {phrase,mode:mode || '',reason,foundCount:0,uniqueAdded:0};
    searchAttempts.push(attempt);

    let found = [];
    try {
      found = await requestProducts(token,userAgent,phrase,mode);
    } catch (error) {
      if (mode === 'MPN' && [400,422].includes(Number(error?.status))) {
        attempt.error = clean(error?.message || 'MPN search rejected');
        return;
      }
      throw error;
    }

    attempt.foundCount = found.length;
    for (const product of found) {
      const id = clean(product?.id);
      const productKey = id || norm(product?.name);
      if (!productKey || seen.has(productKey)) continue;
      seen.add(productKey);
      products.push(product);
      attempt.uniqueAdded += 1;
      if (id) firstSeenById[id] = {
        mode:mode || 'PHRASE',
        reason,
        attempt:searchAttempts.length
      };
    }
  }

  // First attempt stays backward compatible: ordinary catalog phrase search.
  if (queries[0]) {
    await runPhrase(queries[0],'','primary');
  }

  // Allegro officially supports mode=MPN. Use it only for model/code-like input.
  const mpnPhrase = clean(input?.mpn || input?.model || input?.query);
  if (mpnPhrase && shouldTryMpnMode(input)) {
    await runPhrase(mpnPhrase,'MPN','mpn');
  }

  // Structured brand+model input can still use the normal second phrase.
  if (queries[1] && searchAttempts.length < maxAttempts) {
    await runPhrase(queries[1],'','fallback');
  }

  // Generic finder input may recover the canonical spelling / brand context
  // from the first candidates, but never exceeds the 3-request budget.
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
    if (searchAttempts.length >= maxAttempts) break;
    await runPhrase(phrase,'','recovered');
  }

  return {
    // Allegro returns at most 30 catalog products per page by default.
    // Three attempts may each contribute a unique relevant product, so never
    // truncate to 40 before the combined ranking has inspected the results.
    products:products.slice(0,90),
    queriesUsed,
    searchAttempts,
    firstSeenById
  };
}
