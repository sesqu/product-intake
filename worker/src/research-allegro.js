const AAPI = 'https://api.allegro.pl';
const clean = value => String(value ?? '').trim();
const norm = value => clean(value).toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu,' ').trim();

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
  const brand = clean(input.brand || input.manufacturer);
  const model = clean(input.model);
  const mpn = clean(input.mpn);
  const details = clean(input.details);

  return unique([
    mpn,
    [brand,model].filter(Boolean).join(' '),
    model,
    [brand,details].filter(Boolean).join(' ')
  ]).slice(0,3);
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
  for (const phrase of queries) {
    queriesUsed.push(phrase);
    const products = await requestProducts(token,userAgent,phrase);
    if (products.length) {
      return {products,queriesUsed};
    }
  }

  return {products:[],queriesUsed};
}
