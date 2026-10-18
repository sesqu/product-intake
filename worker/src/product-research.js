import {
  rankResearchCandidate,
  modelFingerprint,
  extractContextualModelPhrases
} from './research-ranking-v3.js';
const clean = value => String(value ?? '').trim();

function norm(value) {
  return clean(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu,' ')
    .trim();
}

function first(values) {
  return Array.isArray(values) && values.length ? values[0] : '';
}

function stripHtml(value) {
  return clean(value)
    .replace(/<br\s*\/?>/gi,'\n')
    .replace(/<\/p>/gi,'\n')
    .replace(/<[^>]+>/g,' ')
    .replace(/&nbsp;/gi,' ')
    .replace(/&amp;/gi,'&')
    .replace(/\s+\n/g,'\n')
    .replace(/\n\s+/g,'\n')
    .replace(/[ \t]{2,}/g,' ')
    .trim();
}

function flattenDescription(description) {
  if (!description) return '';
  if (typeof description === 'string') return stripHtml(description);

  const chunks = [];
  for (const section of description.sections || []) {
    for (const item of section.items || []) {
      if (item?.content) chunks.push(stripHtml(item.content));
      if (item?.text) chunks.push(stripHtml(item.text));
    }
  }
  return chunks.filter(Boolean).join('\n\n').slice(0,12000);
}

function parameterItems(product) {
  return (product?.parameters || [])
    .map(parameter => ({
      id:clean(parameter?.id),
      name:clean(parameter?.name || parameter?.id),
      value:clean(first(parameter?.valuesLabels) || first(parameter?.values)),
      isTrusted:parameter?.options?.isTrusted === true
    }))
    .filter(item => item.name && item.value);
}

function findParameter(parameters, names) {
  const wanted = names.map(norm);
  return parameters.find(parameter => {
    const name = norm(parameter.name);
    return wanted.some(item => name === item || name.includes(item));
  }) || null;
}

function findExactParameter(parameters, names) {
  const wanted = new Set(names.map(norm));
  return parameters.find(parameter => wanted.has(norm(parameter.name))) || null;
}

function uniqueParameters(parameters) {
  const seen = new Set();
  const output = [];
  for (const parameter of parameters || []) {
    const key = norm(parameter.name) + '|' + norm(parameter.value);
    if (!parameter.value || seen.has(key)) continue;
    seen.add(key);
    output.push(parameter);
  }
  return output;
}

export function mapAllegroResearchProduct(product) {
  if (!product) return null;

  const parameters = parameterItems(product);
  const brandParam = findParameter(parameters,['marka','brand']);
  const manufacturerParam = findExactParameter(parameters,[
    'producent',
    'manufacturer',
    'nazwa producenta'
  ]);
  const modelParam = findParameter(parameters,['model']);
  const mpnParam = findParameter(parameters,[
    'kod producenta',
    'numer katalogowy',
    'numer katalogowy części',
    'manufacturer code',
    'manufacturer part number',
    'mpn'
  ]);
  const eanParam = findParameter(parameters,['ean','gtin']);

  return {
    source:'allegro',
    provider:'allegro-catalog',
    id:clean(product.id),
    name:clean(product.name),
    brand:clean(brandParam?.value || manufacturerParam?.value),
    manufacturer:clean(manufacturerParam?.value || brandParam?.value),
    model:clean(modelParam?.value || mpnParam?.value),
    mpn:clean(mpnParam?.value),
    ean:clean(eanParam?.value),
    category:clean(product?.category?.name || product?.category?.id),
    categoryId:clean(product?.category?.id),
    image:clean(product?.images?.[0]?.url),
    description:flattenDescription(product.description),
    parameters:uniqueParameters(parameters).slice(0,80),
    trust:{
      brand:Boolean(brandParam?.isTrusted || manufacturerParam?.isTrusted),
      manufacturer:Boolean(manufacturerParam?.isTrusted || brandParam?.isTrusted),
      model:Boolean(modelParam?.isTrusted),
      mpn:Boolean(mpnParam?.isTrusted),
      ean:Boolean(eanParam?.isTrusted)
    }
  };
}

function exact(a,b) {
  return Boolean(clean(a) && clean(b) && norm(a) === norm(b));
}

function tokenOverlap(needle, haystack) {
  const a = norm(needle).split(' ').filter(token => token.length >= 2);
  const b = new Set(norm(haystack).split(' ').filter(Boolean));
  if (!a.length) return 0;
  return a.filter(token => b.has(token)).length / a.length;
}

function scoreCandidate(candidate, input = {}) {
  let score = 0;
  const evidence = [];
  const warnings = [];

  const query = clean(input.query);
  const brand = clean(input.brand || input.manufacturer);
  const model = clean(input.model);
  const mpn = clean(input.mpn);
  const details = clean(input.details);


  if (query) {
    const identity = [
      candidate.name,
      candidate.brand,
      candidate.manufacturer,
      candidate.model,
      candidate.mpn,
      candidate.ean
    ].filter(Boolean).join(' ');

    if (
      exact(query,candidate.model) ||
      exact(query,candidate.mpn) ||
      exact(query,candidate.ean) ||
      exact(query,candidate.name)
    ) {
      score += 45;
      evidence.push({
        field:'query',
        label:'Wpisana fraza',
        status:'match',
        points:45,
        trusted:false,
        value:query
      });
    } else {
      const overlap = tokenOverlap(query,identity);
      if (overlap >= .8) {
        const points = overlap === 1 ? 38 : 32;
        score += points;
        evidence.push({
          field:'query',
          label:'Wpisana fraza',
          status:'partial',
          points,
          trusted:false,
          value:query
        });
      } else if (overlap >= .5) {
        score += 16;
        evidence.push({
          field:'query',
          label:'Wpisana fraza',
          status:'supporting',
          points:16,
          trusted:false,
          value:query
        });
      }
    }
  }

  if (mpn) {
    if (exact(mpn,candidate.mpn) || exact(mpn,candidate.model)) {
      const points = 45 + (candidate.trust?.mpn ? 5 : 0);
      score += points;
      evidence.push({field:'mpn',label:'Kod / MPN',status:'match',points,trusted:Boolean(candidate.trust?.mpn),value:candidate.mpn || candidate.model});
    } else if (candidate.mpn) {
      score -= 35;
      warnings.push({field:'mpn',severity:'critical',message:'Kod / MPN z katalogu różni się od wpisanego.',input:mpn,catalog:candidate.mpn});
    }
  }

  if (model) {
    if (exact(model,candidate.model)) {
      const points = 30 + (candidate.trust?.model ? 5 : 0);
      score += points;
      evidence.push({field:'model',label:'Model',status:'match',points,trusted:Boolean(candidate.trust?.model),value:candidate.model});
    } else {
      const overlap = tokenOverlap(model,[candidate.model,candidate.name,candidate.mpn].filter(Boolean).join(' '));
      if (overlap >= .8) {
        score += 22;
        evidence.push({field:'model',label:'Model',status:'partial',points:22,trusted:Boolean(candidate.trust?.model),value:candidate.model || candidate.name});
      } else if (candidate.model) {
        score -= 22;
        warnings.push({field:'model',severity:'warning',message:'Model katalogowy nie zgadza się dokładnie z wpisanym.',input:model,catalog:candidate.model});
      }
    }
  }

  if (brand) {
    if (
      exact(brand,candidate.brand) ||
      exact(brand,candidate.manufacturer) ||
      tokenOverlap(brand,candidate.name) === 1
    ) {
      const points = 15 + (candidate.trust?.brand ? 5 : 0);
      score += points;
      evidence.push({field:'brand',label:'Marka / producent',status:'match',points,trusted:Boolean(candidate.trust?.brand || candidate.trust?.manufacturer),value:candidate.brand || candidate.manufacturer || brand});
    } else if (candidate.brand || candidate.manufacturer) {
      score -= 18;
      warnings.push({field:'brand',severity:'warning',message:'Marka / producent w katalogu różni się od wpisanej.',input:brand,catalog:candidate.brand || candidate.manufacturer});
    }
  }

  if (details) {
    const corpus = [
      candidate.name,
      candidate.brand,
      candidate.manufacturer,
      candidate.model,
      candidate.mpn,
      ...candidate.parameters.map(item => item.value)
    ].filter(Boolean).join(' ');
    const overlap = tokenOverlap(details,corpus);
    const points = Math.round(overlap * 10);
    score += points;
    if (points) evidence.push({field:'details',label:'Dodatkowe dane',status:'supporting',points,trusted:false,value:details});
  }

  if (candidate.name) score += 3;
  if (candidate.category) score += 2;

  return {
    score:Math.max(0,Math.min(100,Math.round(score))),
    evidence,
    warnings
  };
}

function identitySignature(candidate) {
  return [candidate.brand,candidate.manufacturer,candidate.model,candidate.mpn]
    .map(norm)
    .filter(Boolean)
    .join('|');
}


function explicitBrand(candidate) {
  const value = clean(candidate?.brand || candidate?.manufacturer);
  const key = norm(value).replace(/\s+/g,'');
  if (!value || ['bezmarki','nieznanyproducent','unknown','unbranded','other'].includes(key)) return '';
  return value;
}

function exactTargetIdentity(candidate,input = {}) {
  const target = modelFingerprint(input.model || input.mpn || input.query);
  if (!target) return false;

  const direct = [candidate?.model,candidate?.mpn]
    .map(modelFingerprint)
    .filter(Boolean);

  if (direct.includes(target)) return true;

  const title = modelFingerprint(candidate?.name);
  return Boolean(title && title.includes(target));
}

function inferredTargetBrand(candidate,input = {}) {
  const target = clean(input.model || input.mpn || input.query);
  if (!target) return '';
  const phrases = extractContextualModelPhrases(candidate?.name || '',target);
  const first = clean(phrases?.[0]);
  if (!first) return '';
  return clean(first.split(/\s+/)[0]);
}

function hasBrandCollision(ranked,input = {}) {
  const brands = new Set();
  for (const candidate of ranked || []) {
    if (candidate?.relation?.type === 'accessory') continue;
    if (!exactTargetIdentity(candidate,input)) continue;

    const brand = explicitBrand(candidate) || inferredTargetBrand(candidate,input);
    if (!brand) continue;

    const key = norm(brand);
    if (!key || ['router','monitor','telewizor','drukarka','smartfon','telefon'].includes(key)) continue;

    brands.add(key);
    if (brands.size >= 2) return true;
  }
  return false;
}


function candidateTargetBrand(candidate,input = {}) {
  const explicit = explicitBrand(candidate);
  if (candidate?.relation?.type !== 'accessory' && explicit) return explicit;

  const contextual = inferredTargetBrand(candidate,input);
  if (contextual) return contextual;

  if (
    candidate?.relation?.type === 'accessory' &&
    explicit &&
    norm(candidate?.name).includes(norm(explicit))
  ) {
    return explicit;
  }

  return candidate?.relation?.type !== 'accessory' ? explicit : '';
}

function inferBrandConsensus(ranked,input = {}) {
  if (clean(input.brand || input.manufacturer)) return null;

  const support = new Map();
  for (const candidate of ranked || []) {
    if (!exactTargetIdentity(candidate,input)) continue;

    const brand = candidateTargetBrand(candidate,input);
    const key = norm(brand);
    if (!key) continue;
    if (['router','monitor','telewizor','drukarka','smartfon','telefon'].includes(key)) continue;

    let weight = candidate?.relation?.type === 'accessory' ? 1 : 2;
    if (candidate?.trust?.brand === true || candidate?.trust?.manufacturer === true) weight += 1;

    const current = support.get(key) || {brand,weight:0,count:0};
    current.weight += weight;
    current.count += 1;
    support.set(key,current);
  }

  const rankedBrands = [...support.values()]
    .sort((a,b) => b.weight - a.weight || b.count - a.count || a.brand.localeCompare(b.brand,'pl'));

  const first = rankedBrands[0];
  const second = rankedBrands[1];
  if (!first || first.weight < 4) return null;

  const secondWeight = Number(second?.weight || 0);
  if (secondWeight && first.weight < secondWeight * 1.6) return null;
  if (secondWeight && first.weight - secondWeight < 2) return null;

  return {
    brand:first.brand,
    key:norm(first.brand),
    weight:first.weight,
    count:first.count,
    runnerUp:second ? {brand:second.brand,weight:second.weight,count:second.count} : null
  };
}

function applyBrandConsensus(ranked,input = {}) {
  const consensus = inferBrandConsensus(ranked,input);
  if (!consensus) return {ranked,consensus:null};

  const adjusted = ranked.map(candidate => {
    const brand = candidateTargetBrand(candidate,input);
    const key = norm(brand);
    if (!key) return candidate;

    let delta = 0;
    if (key === consensus.key) {
      delta = candidate?.relation?.type === 'accessory' ? 4 : 18;
    } else if (exactTargetIdentity(candidate,input) && candidate?.relation?.type !== 'accessory') {
      delta = -18;
    }

    if (!delta) return candidate;

    return {
      ...candidate,
      score:Math.max(0,Math.min(100,Math.round(candidate.score + delta))),
      evidence:[
        ...(candidate.evidence || []),
        {
          field:'brand-consensus',
          label:'Marka wspierana przez wiele wyników',
          status:delta > 0 ? 'supporting' : 'conflict',
          points:delta,
          trusted:false,
          value:consensus.brand
        }
      ],
      warnings:delta < 0
        ? [
            ...(candidate.warnings || []),
            {
              field:'brand-consensus',
              severity:'warning',
              message:'Inne wyniki dla tego modelu częściej wskazują markę ' + consensus.brand + '.'
            }
          ]
        : (candidate.warnings || [])
    };
  }).sort((a,b) => b.score - a.score || clean(a.name).localeCompare(clean(b.name)));

  return {ranked:adjusted,consensus};
}

export function analyzeResearchCandidates(products, input = {}, selectedId = '') {
  const initiallyRanked = (Array.isArray(products) ? products : [])
    .filter(Boolean)
    .map(product => {
      const analysis = rankResearchCandidate(product,input);
      return {
        ...product,
        score:analysis.score,
        evidence:analysis.evidence,
        warnings:analysis.warnings,
        relation:analysis.relation
      };
    })
    .sort((a,b) => b.score - a.score || clean(a.name).localeCompare(clean(b.name)));

  const brandAdjusted = applyBrandConsensus(initiallyRanked,input);
  const ranked = brandAdjusted.ranked;

  if (!ranked.length) {
    return {
      selected:null,
      ranked:[],
      confidence:0,
      requiresTesterChoice:false,
      selectedBy:'',
      warnings:[]
    };
  }

  const requested = clean(selectedId);
  const selected = requested
    ? ranked.find(item => clean(item.id) === requested) || ranked[0]
    : ranked[0];

  const runnerUp = ranked.find(item => item.id !== selected.id);
  const closeCompetition = Boolean(
    !requested &&
    runnerUp &&
    selected.score - runnerUp.score <= 8 &&
    identitySignature(selected) !== identitySignature(runnerUp)
  );

  const brandCollision = !requested && hasBrandCollision(ranked,input);
  // Short alphanumeric models (e.g. L3250, QC45) may be shared across
  // manufacturers. Keep the ranking but require tester confirmation when
  // the brand was not supplied.
  const queryFingerprint = modelFingerprint(input.model || input.mpn || input.query);
  const shortModelAmbiguity = Boolean(
    !requested &&
    !clean(input.brand || input.manufacturer) &&
    queryFingerprint.length >= 3 &&
    queryFingerprint.length <= 5 &&
    /[a-z]/.test(queryFingerprint) &&
    /[0-9]/.test(queryFingerprint)
  );
  const selectedAccessory = selected?.relation?.type === 'accessory';
  // Exact catalog model/MPN identity is required before a code-like query
  // can be treated as unambiguous. A product-family title or a code prefix
  // alone is not enough to silently accept a particular physical variant.
  const exactCatalogIdentity = Boolean(
    queryFingerprint &&
    [selected?.model,selected?.mpn]
      .map(modelFingerprint)
      .some(value => value && value === queryFingerprint)
  );
  const identityNeedsReview = Boolean(
    !requested &&
    queryFingerprint.length >= 4 &&
    /[a-z]/.test(queryFingerprint) &&
    /[0-9]/.test(queryFingerprint) &&
    !exactCatalogIdentity
  );
  const strongestPrimary = ranked.find(item => item?.relation?.type !== 'accessory') || null;
  const noConfidentProduct = Boolean(
    selectedAccessory ||
    selected.score < 35 ||
    (!strongestPrimary && ranked.length)
  );

  return {
    selected,
    ranked,
    confidence:selected.score,
    requiresTesterChoice:Boolean(
      closeCompetition ||
      brandCollision ||
      shortModelAmbiguity ||
      identityNeedsReview ||
      selectedAccessory ||
      selected.score < 55
    ),
    selectedBy:requested ? 'tester' : 'ranking',
    warnings:selected.warnings || [],
    ambiguity:{
      closeCompetition,
      brandCollision,
      shortModelAmbiguity,
      identityNeedsReview,
      selectedAccessory,
      noConfidentProduct,
      strongestPrimaryScore:strongestPrimary?.score ?? null,
      brandConsensus:brandAdjusted.consensus
    }
  };
}

function preferredFacts(product) {
  const priority = [
    'producent','marka','model','kod producenta','numer katalogowy',
    'numer katalogowy części','mpn','typ','rodzaj','moc','napięcie',
    'pojemność','kolor','rozmiar','wymiary','waga','materiał'
  ];

  const scored = (product?.parameters || []).map((parameter,index) => {
    const name = norm(parameter.name);
    const priorityIndex = priority.findIndex(key => name === key || name.includes(key));
    return {
      ...parameter,
      order:priorityIndex === -1 ? 100 + index : priorityIndex
    };
  });

  return uniqueParameters(scored)
    .sort((a,b) => a.order - b.order)
    .slice(0,14)
    .map(({order,...item}) => item);
}

export function buildDescription(product, input = {}, analysis = {}) {
  if (!product) return null;

  const title = clean(product.name) ||
    [product.brand || product.manufacturer || input.brand || input.manufacturer, product.model || input.model || input.query, product.mpn || input.mpn]
      .filter(Boolean)
      .join(' ');

  const facts = preferredFacts(product);
  const identity = [
    (product.brand || product.manufacturer) ? 'Marka / producent: ' + (product.brand || product.manufacturer) : '',
    product.model ? 'Model: ' + product.model : '',
    product.mpn ? 'Kod / MPN: ' + product.mpn : ''
  ].filter(Boolean);

  const bulletLines = facts.map(item => item.name + ': ' + item.value);
  const introParts = [];
  if (title) introParts.push(title + '.');
  if (product.category) introParts.push('Produkt z kategorii ' + product.category + '.');
  if (identity.length) introParts.push(identity.join(' • ') + '.');

  const shortDescription = introParts.join(' ');
  const fullDescription = [
    shortDescription,
    bulletLines.length ? 'Najważniejsze informacje:\n' + bulletLines.map(line => '• ' + line).join('\n') : '',
    'Opis przygotowano wyłącznie na podstawie danych znalezionych w źródłach katalogowych. Stan konkretnej sztuki i zawartość zestawu należy uzupełnić osobno.'
  ].filter(Boolean).join('\n\n');

  return {
    title,
    shortDescription,
    fullDescription,
    bullets:bulletLines,
    facts,
    draft:Boolean(analysis.requiresTesterChoice || (analysis.confidence ?? 0) < 55)
  };
}

export function buildResearchResult(products, input = {}, selectedId = '') {
  const analysis = analyzeResearchCandidates(products,input,selectedId);
  return {
    ...analysis,
    description:buildDescription(analysis.selected,input,analysis),
    confidenceMethod:'product-research-v3'
  };
}
