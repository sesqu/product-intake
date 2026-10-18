import { buildModelQueryVariants, extractContextualModelPhrases, inferProductTypeHint, modelFingerprint, normalizeText, rankResearchCandidate } from './research-ranking-v3.js';
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

// Pick a plausible manufacturer code from free text, not arbitrary memory
// sizes, quantities or the product's brand. Explicit MPN/model always wins.
export function inferMpnSearchPhrase(input = {}) {
  const explicit=clean(input.mpn || input.model);
  if(explicit) return explicit;
  const query=clean(input.query);
  if(!query || query.length>140) return '';

  const tokens=query.match(/[\p{L}\p{N}]+(?:[-_/][\p{L}\p{N}]+)*/gu) || [];
  const candidates=[];
  for(let i=0;i<tokens.length;i++){
    const raw=tokens[i];
    const compact=raw.replace(/[^A-Za-z0-9]/g,'');
    if(compact.length<4 || compact.length>28) continue;
    if(!/[A-Za-z]/.test(compact) || !/[0-9]/.test(compact)) continue;
    if(/^\d+(?:GB|TB|MB|KB|MHZ|GHZ|HZ|W|V|CM|MM|ML|KG)$/i.test(compact)) continue;

    let code=raw;
    // Bosch-style model in two tokens: GSR 18V-55, GSB 18V-55.
    if(/^\d/.test(raw) && /^[A-Z]{3}$/.test(tokens[i-1]||'')){
      code=tokens[i-1]+' '+raw;
    }
    const score=(raw.includes('-')?4:0)+(raw.includes('/')?2:0)+
      (/[A-Z]{2}/.test(raw)?2:0)+Math.min(3,compact.length/5);
    candidates.push({code,score,i});
  }
  candidates.sort((a,b)=>b.score-a.score || a.i-b.i);
  if(candidates.length) return candidates[0].code;

  // For model families such as "Dreame L50 Ultra", the entire short
  // phrase may still be a useful MPN lookup, though it is not exact identity.
  const compact=query.replace(/[^A-Za-z0-9]/g,'');
  const parts=query.split(/\s+/).filter(Boolean);
  const meaningfulNumber=parts.some(part=>{
    const code=part.replace(/[^A-Za-z0-9]/g,'');
    if(/^\d{1,2}$/.test(code)) return true; // e.g. Flip 6
    return /[A-Za-z]/.test(code) && /\d/.test(code) &&
      !/^\d+(?:GB|TB|MB|KB|MHZ|GHZ|HZ|W|V|CM|MM|ML|KG)$/i.test(code);
  });
  return parts.length<=3 && compact.length>=4 && compact.length<=28 &&
    meaningfulNumber ? query : '';
}

export function shouldTryMpnMode(input = {}) {
  return Boolean(inferMpnSearchPhrase(input));
}

// Search text ("telefon SM-S921B") is useful for Allegro retrieval,
// but identity scoring must compare the actual manufacturer model code.
// Preserve the exact user phrase for network requests and trace history.
export function scoringInputForQuery(input = {}) {
  const original=clean(input.query);
  if(clean(input.model || input.mpn) || !original) return input;
  const code=inferMpnSearchPhrase(input);
  if(!code || code.toLowerCase()===original.toLowerCase() ||
     !original.toLowerCase().includes(code.toLowerCase()))return input;
  return {...input,model:code};
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

async function requestProducts(token, userAgent, phrase, mode = '', pageId = '') {
  const url = new URL(AAPI + '/sale/products');
  url.searchParams.set('phrase', phrase);
  if (mode) url.searchParams.set('mode', mode);
  if (pageId) url.searchParams.set('page.id',pageId);
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

  return {
    products:Array.isArray(body.products) ? body.products : [],
    nextPageId:clean(body?.nextPage?.id).slice(0,1024)
  };
}

export async function searchAllegroForResearch({token,userAgent,input} = {}) {
  if (!token) throw new Error('Brak tokenu Allegro');

  const queries = buildAllegroResearchQueries(input);
  const rankingInput=scoringInputForQuery(input);
  if (!queries.length) return {products:[],queriesUsed:[]};

  const queriesUsed = [];
  const searchAttempts = [];
  const products = [];
  const seen = new Set();
  const firstSeenById = Object.create(null);
  const foundModesById = Object.create(null);
  const seenRequests = new Set();
  const nextPageByMode = new Map();
  const maxAttempts = 3;
  // An isolated whole-device result can be misbranded in the Allegro
  // catalog. If two distinct exact-model accessories explicitly refer to
  // another brand, use the remaining request to check that brand instead
  // of prematurely accepting the lone device. This is a *lead* for a search,
  // never automatic proof of the correct manufacturer.
  function disputedBrandLead(selected) {
    if (clean(input?.brand || input?.manufacturer) || !selected) return null;
    const identity=clean(rankingInput?.model || rankingInput?.mpn || rankingInput?.query);
    const target=modelFingerprint(identity);
    if(target.length<4 || !/[a-z]/.test(target) || !/\\d/.test(target))return null;
    const selectedInfo=candidateHint(selected);
    const selectedBrand=normalizeText(selectedInfo.brand || selectedInfo.manufacturer ||
      clean(selectedInfo.name).split(/\\s+/)[0]);
    if(!selectedBrand || ['bez marki','unknown','other'].includes(selectedBrand))return null;
    const support=new Map();
    for(const raw of products){
      if(raw===selected)continue;
      const hint=candidateHint(raw);
      if(!modelFingerprint(hint.name).includes(target))continue;
      if(rankResearchCandidate(hint,rankingInput).relation?.type!=='accessory')continue;
      const contexts=extractContextualModelPhrases(hint.name,identity);
      const rawBrand=clean(contexts[0]?.split(/\\s+/)[0]);
      const key=normalizeText(rawBrand);
      if(!key || key===selectedBrand || key.length<3 ||
         ['telefon','smartfon','model','oryginal','original','czesci','kabel'].includes(key))continue;
      if(!support.has(key))support.set(key,{brand:rawBrand,ids:new Set()});
      support.get(key).ids.add(clean(raw?.id) || hint.name);
    }
    return [...support.values()].filter(x=>x.ids.size>=2)
      .sort((a,b)=>b.ids.size-a.ids.size)[0] || null;
  }

  function primaryAndBrandDispute() {
    const target=modelFingerprint(rankingInput?.mpn || rankingInput?.model || rankingInput?.query);
    const codeLike=target.length>=4 && /[a-z]/.test(target) && /\\d/.test(target);
    const primary=products.find(product=>{
      const candidate=candidateHint(product);
      const ranked=rankResearchCandidate(candidate,rankingInput);
      if(ranked.relation?.type==='accessory' || ranked.score<55)return false;
      if(!codeLike)return true;
      return [candidate.model,candidate.mpn].map(modelFingerprint).includes(target) ||
        modelFingerprint(candidate.name).includes(target);
    }) || null;
    return {
      primary,
      dispute:primary ? disputedBrandLead(primary) : null
    };
  }

  function hasStrongPrimary() {
    const found=primaryAndBrandDispute();
    return Boolean(found.primary && !found.dispute);
  }

  async function runPhrase(phrase, mode = '', reason = 'phrase', pageId = '') {
    const phraseKey = norm(phrase);
    const requestKey = [mode || 'PHRASE', phraseKey, pageId].join('|');
    if (!phraseKey || seenRequests.has(requestKey) || searchAttempts.length >= maxAttempts) return;

    seenRequests.add(requestKey);
    queriesUsed.push(mode ? phrase + ' [' + mode + ']' : phrase);
    const attempt = {
      phrase,mode:mode || '',reason,
      page:pageId ? 2 : 1,
      foundCount:0,uniqueAdded:0
    };
    searchAttempts.push(attempt);

    let found = [];
    try {
      found = await requestProducts(token,userAgent,phrase,mode,pageId);
    } catch (error) {
      if (mode === 'MPN' && [400,422].includes(Number(error?.status))) {
        attempt.error = clean(error?.message || 'MPN search rejected');
        return;
      }
      throw error;
    }

    attempt.foundCount = found.products.length;
    if(found.nextPageId && !pageId){
      nextPageByMode.set(mode || 'PHRASE',{
        phrase,mode,cursor:found.nextPageId
      });
    }
    for (const product of found.products) {
      const id = clean(product?.id);
      const productKey = id || norm(product?.name);
      if (!productKey) continue;
      if (id) {
        if (!foundModesById[id]) foundModesById[id] = [];
        const modeTag = mode === 'MPN' ? 'MPN' : 'PHRASE';
        if (!foundModesById[id].includes(modeTag)) foundModesById[id].push(modeTag);
      }
      if (seen.has(productKey)) continue;
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
  const mpnPhrase = inferMpnSearchPhrase(input);
  if (mpnPhrase && shouldTryMpnMode(input)) {
    await runPhrase(mpnPhrase,'MPN','mpn');
  }

  // Before generic family recovery, challenge a brand contradiction using
  // the actual code and inferred device type. E.g. an isolated "Bosch DHP484"
  // alongside several Makita DHP484 parts should try "Makita DHP484
  // wiertarko-wkrętarka" instead of concluding the Bosch is correct.
  if(searchAttempts.length<maxAttempts){
    const context=primaryAndBrandDispute();
    if(context.dispute){
      const target=clean(rankingInput.model || rankingInput.mpn ||
        inferMpnSearchPhrase(input));
      const type=inferProductTypeHint(products.map(candidateHint));
      const localizedType={
        'wiertarko-wkretarka':'wiertarko-wkrętarka',
        sluchawki:'słuchawki',
        'robot odkurzajacy':'robot odkurzający'
      }[type] || type;
      const phrase=[context.dispute.brand,target,localizedType].filter(Boolean).join(' ');
      if(target) await runPhrase(phrase,'','brand-review');
    }
  }

  // A device-family alias repeatedly reported by accessories may recover
  // the actual main product more effectively than another MPN page.
  // Example: accessories mention "Samsung Galaxy S24" for SM-S921B.
  // Do not simply prepend "telefon": live checks showed that can produce
  // only spare parts or no results. Require a distinct corroborated family
  // alias AND an inferred device type; otherwise retain MPN pagination.
  if(searchAttempts.length < maxAttempts && !hasStrongPrimary()){
    const candidateHints=products.map(candidateHint);
    const typeHints=inferProductTypeHint(candidateHints);
    if(typeHints){
      const target=modelFingerprint(rankingInput.model || rankingInput.mpn || rankingInput.query);
      const suggestions=buildModelQueryVariants(rankingInput,candidateHints);
      const familyPhrase=suggestions.slice(1).find(phrase=>{
        const fp=modelFingerprint(phrase);
        const normalized=norm(phrase);
        return normalized.includes(norm(typeHints)) &&
          target && !fp.includes(target) &&
          phrase.trim().split(' ').filter(Boolean).length>=3;
      });
      if(familyPhrase) await runPhrase(familyPhrase,'','device-family');
    }
  }

  // When an exact manufacturer-code search returned only accessories, a
  // second MPN page is more useful than spending the last request repeating
  // a shortened phrase. This matters especially for brand+model form input,
  // whose third attempt previously always consumed the pagination budget.
  // The next-page cursor is valid only for the same original phrase + mode.
  const mpnPage=nextPageByMode.get('MPN');
  if(mpnPage && searchAttempts.length < maxAttempts && !hasStrongPrimary()){
    await runPhrase(mpnPage.phrase,'MPN','mpn-page',mpnPage.cursor);
  }

  // Structured brand+model input can still use the shorter phrase when no
  // MPN page is available or the previous search has been sufficient.
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
    ? buildModelQueryVariants(rankingInput,products.map(candidateHint))
    : [];

  for (const phrase of recovered) {
    if (searchAttempts.length >= maxAttempts) break;
    await runPhrase(phrase,'','recovered');
  }

  // If the recovered query did not use the remaining budget, try page 2 of
  // the primary phrase before concluding that only accessories exist.
  const phrasePage=nextPageByMode.get('PHRASE');
  if(phrasePage && searchAttempts.length < maxAttempts && !hasStrongPrimary()){
    await runPhrase(phrasePage.phrase,'','phrase-page',phrasePage.cursor);
  }

  return {
    // Allegro returns at most 30 catalog products per page by default.
    // Three attempts may each contribute a unique relevant product, so never
    // truncate to 40 before the combined ranking has inspected the results.
    products:products.slice(0,90),
    queriesUsed,
    searchAttempts,
    firstSeenById,
    foundModesById
  };
}
