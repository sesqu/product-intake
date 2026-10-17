const clean = value => String(value ?? '').trim();

export function normalizeText(value) {
  return clean(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9]+/g,' ')
    .trim();
}

export function modelFingerprint(value) {
  return normalizeText(value).replace(/[^a-z0-9]/g,'');
}

function words(value) {
  return normalizeText(value).split(' ').filter(Boolean);
}

function hasLettersAndDigits(value) {
  const normalized = modelFingerprint(value);
  return /[a-z]/.test(normalized) && /\d/.test(normalized) && normalized.length >= 4;
}

export function isProbableModelQuery(input = {}) {
  const value = clean(input.model || input.mpn || input.query);
  return hasLettersAndDigits(value);
}

function exactFingerprint(a,b) {
  const left = modelFingerprint(a);
  const right = modelFingerprint(b);
  return Boolean(left && right && left === right);
}

function tokenOverlap(needle,haystack) {
  const wanted = words(needle).filter(token => token.length >= 2);
  const available = new Set(words(haystack));
  if (!wanted.length) return 0;
  return wanted.filter(token => available.has(token)).length / wanted.length;
}

const GENERIC_BRANDS = new Set([
  '',
  'bezmarki',
  'nieznanyproducent',
  'unknown',
  'unbranded',
  'other'
]);

function genericBrand(value) {
  return GENERIC_BRANDS.has(modelFingerprint(value));
}

function titleContainsBrand(candidate) {
  const brand = clean(candidate?.brand || candidate?.manufacturer);
  if (!brand || genericBrand(brand)) return false;
  return normalizeText(candidate?.name).includes(normalizeText(brand));
}

const ACCESSORY_NOUNS = [
  'bateria','akumulator','etui','futeral','pokrowiec','filtr','uchwyt',
  'zasilacz','plyta glowna','zlacze','buzzer','klapka','wyswietlacz',
  'mocowanie','front','oslona','toner','beben','chip','slizgacze',
  'kabel','przewod','adapter','ladowarka','szklo','case','cover',
  'replacement','zamienny','zamienna','zamienne','kompatybilny','kompatybilna'
];

const RELATION_WORDS = [
  ' do ',' dla ',' kompatybilny z ',' kompatybilna z ',' kompatybilne z ',
  ' pasuje do ',' przeznaczony do ',' przeznaczona do ',' for '
];

const ACCESSORY_CATEGORY_WORDS = [
  'akcesoria','czesci','baterie','akumulatory','etui','pokrowce','filtry',
  'uchwyty','zasilacze','tonery','bebny','kable','ladowarki','wyswietlacze'
];

export function classifyCandidateRelation(candidate,input = {}) {
  const name = ' ' + normalizeText(candidate?.name) + ' ';
  const category = normalizeText(candidate?.category);
  const target = clean(input.model || input.mpn || input.query);
  const targetFp = modelFingerprint(target);
  const nameFp = modelFingerprint(candidate?.name);

  const noun = ACCESSORY_NOUNS.find(word => name.includes(' ' + word + ' ')) || '';
  const relationWord = RELATION_WORDS.find(word => name.includes(word)) || '';
  const accessoryCategory = ACCESSORY_CATEGORY_WORDS.find(word => category.includes(word)) || '';
  const targetMentioned = Boolean(targetFp && nameFp.includes(targetFp));

  if (targetMentioned && noun && (relationWord || accessoryCategory)) {
    return {
      type:'accessory',
      confidence:'strong',
      reason:[noun,relationWord.trim(),accessoryCategory].filter(Boolean).join(' • ')
    };
  }

  if (targetMentioned && accessoryCategory) {
    return {
      type:'accessory',
      confidence:'medium',
      reason:'kategoria: ' + accessoryCategory
    };
  }

  if (targetMentioned && noun && ['mocowanie','front','oslona','toner','beben','chip','zlacze','buzzer','klapka'].includes(noun)) {
    return {
      type:'accessory',
      confidence:'medium',
      reason:noun
    };
  }

  return {type:'product',confidence:'unknown',reason:''};
}

function brandEvidence(candidate,input,evidence,warnings) {
  const requested = clean(input.brand || input.manufacturer);
  const candidateBrand = clean(candidate?.brand || candidate?.manufacturer);
  const explicitCandidate = candidateBrand && !genericBrand(candidateBrand);

  if (requested) {
    if (explicitCandidate && exactFingerprint(requested,candidateBrand)) {
      const trusted = Boolean(candidate?.trust?.brand || candidate?.trust?.manufacturer);
      const points = trusted ? 20 : 16;
      evidence.push({
        field:'brand',
        label:'Marka / producent',
        status:'match',
        points,
        trusted,
        value:candidateBrand
      });
      return points;
    }

    if (explicitCandidate) {
      warnings.push({
        field:'brand',
        severity:'warning',
        message:'Marka produktu różni się od wpisanej.',
        input:requested,
        catalog:candidateBrand
      });
      return -22;
    }

    if (normalizeText(candidate?.name).includes(normalizeText(requested))) {
      evidence.push({
        field:'brand-title',
        label:'Marka tylko w nazwie',
        status:'supporting',
        points:4,
        trusted:false,
        value:requested
      });
      return 4;
    }

    return 0;
  }

  if (titleContainsBrand(candidate)) {
    const trusted = Boolean(candidate?.trust?.brand || candidate?.trust?.manufacturer);
    const points = trusted ? 14 : 10;
    evidence.push({
      field:'catalog-brand',
      label:'Marka produktu zgodna z nazwą',
      status:'supporting',
      points,
      trusted,
      value:candidateBrand
    });
    return points;
  }

  return 0;
}

function modelEvidence(candidate,input,evidence,warnings) {
  const query = clean(input.model || input.mpn || input.query);
  if (!query || !isProbableModelQuery(input)) return 0;

  const queryFp = modelFingerprint(query);
  const model = clean(candidate?.model);
  const mpn = clean(candidate?.mpn);
  const modelFp = modelFingerprint(model);
  const mpnFp = modelFingerprint(mpn);
  const nameFp = modelFingerprint(candidate?.name);

  if (queryFp && (queryFp === modelFp || queryFp === mpnFp)) {
    const trusted =
      (queryFp === modelFp && candidate?.trust?.model === true) ||
      (queryFp === mpnFp && candidate?.trust?.mpn === true);
    const points = trusted ? 66 : 60;
    evidence.push({
      field:'model-fingerprint',
      label:'Model / MPN',
      status:'match',
      points,
      trusted,
      value:model || mpn
    });
    return points;
  }

  if (
    queryFp &&
    (
      (modelFp && (modelFp.startsWith(queryFp) || queryFp.startsWith(modelFp))) ||
      (mpnFp && (mpnFp.startsWith(queryFp) || queryFp.startsWith(mpnFp)))
    )
  ) {
    evidence.push({
      field:'model-variant',
      label:'Model podobny / wariant',
      status:'partial',
      points:32,
      trusted:false,
      value:model || mpn
    });
    warnings.push({
      field:'model',
      severity:'warning',
      message:'Model jest podobny, ale zawiera dodatkowe lub brakujące oznaczenie.',
      input:query,
      catalog:model || mpn
    });
    return 32;
  }

  if (queryFp && nameFp.includes(queryFp)) {
    evidence.push({
      field:'model-title',
      label:'Model występuje w nazwie',
      status:'supporting',
      points:18,
      trusted:false,
      value:query
    });
    return 18;
  }

  const overlap = tokenOverlap(query,[candidate?.name,model,mpn].filter(Boolean).join(' '));
  if (overlap >= .8) {
    evidence.push({
      field:'model-text',
      label:'Silna zgodność tekstowa modelu',
      status:'partial',
      points:16,
      trusted:false,
      value:query
    });
    return 16;
  }

  return 0;
}

function detailsEvidence(candidate,input,evidence) {
  const details = clean(input.details);
  if (!details) return 0;
  const corpus = [
    candidate?.name,
    candidate?.brand,
    candidate?.manufacturer,
    candidate?.model,
    candidate?.mpn,
    ...(candidate?.parameters || []).map(item => item?.value)
  ].filter(Boolean).join(' ');
  const overlap = tokenOverlap(details,corpus);
  const points = Math.round(overlap * 10);
  if (points) {
    evidence.push({
      field:'details',
      label:'Dodatkowe dane',
      status:'supporting',
      points,
      trusted:false,
      value:details
    });
  }
  return points;
}

export function rankResearchCandidate(candidate,input = {}) {
  let score = 0;
  const evidence = [];
  const warnings = [];

  score += modelEvidence(candidate,input,evidence,warnings);
  score += brandEvidence(candidate,input,evidence,warnings);
  score += detailsEvidence(candidate,input,evidence);

  const relation = classifyCandidateRelation(candidate,input);
  if (relation.type === 'accessory') {
    const penalty = relation.confidence === 'strong' ? -48 : -34;
    score += penalty;
    evidence.push({
      field:'relation',
      label:'Część / akcesorium do modelu',
      status:'conflict',
      points:penalty,
      trusted:false,
      value:relation.reason
    });
    warnings.push({
      field:'relation',
      severity:'warning',
      message:'Kandydat wygląda na część lub akcesorium przeznaczone do szukanego modelu.'
    });
  } else if (isProbableModelQuery(input)) {
    score += 12;
    evidence.push({
      field:'relation',
      label:'Wygląda na produkt główny',
      status:'supporting',
      points:12,
      trusted:false,
      value:''
    });
  }

  if (candidate?.category) score += 2;
  if (candidate?.name) score += 2;

  return {
    score:Math.max(0,Math.min(100,Math.round(score))),
    evidence,
    warnings,
    relation
  };
}

export function extractEquivalentModelPhrases(value,target) {
  const targetFp = modelFingerprint(target);
  if (!targetFp) return [];

  const tokens = clean(value)
    .replace(/[^\p{L}\p{N}\-_/]+/gu,' ')
    .split(/\s+/)
    .filter(Boolean);

  const output = [];
  const seen = new Set();

  for (let start=0; start<tokens.length; start++) {
    for (let length=1; length<=4 && start+length<=tokens.length; length++) {
      const phrase = tokens.slice(start,start+length).join(' ');
      if (modelFingerprint(phrase) !== targetFp) continue;
      const key = normalizeText(phrase);
      if (!seen.has(key)) {
        seen.add(key);
        output.push(phrase);
      }
    }
  }

  return output;
}


const CONTEXT_STOPWORDS = new Set([
  'do','dla','na','z','ze','od','for','with','compatible','kompatybilny',
  'kompatybilna','bateria','akumulator','etui','futeral','pokrowiec','filtr',
  'uchwyt','toner','beben','chip','zlacze','mocowanie','oslona','front'
]);

export function extractContextualModelPhrases(value,target) {
  const targetFp = modelFingerprint(target);
  if (!targetFp) return [];

  const tokens = clean(value)
    .replace(/[^\p{L}\p{N}\-_/]+/gu,' ')
    .split(/\s+/)
    .filter(Boolean);

  const output = [];
  const seen = new Set();

  for (let start=0; start<tokens.length; start++) {
    for (let length=1; length<=4 && start+length<=tokens.length; length++) {
      const modelPhrase = tokens.slice(start,start+length).join(' ');
      if (modelFingerprint(modelPhrase) !== targetFp) continue;

      const previous = tokens[start-1] || '';
      const previousNorm = normalizeText(previous);
      if (
        previous &&
        /^[\p{L}][\p{L}\p{N}\-]{1,}$/u.test(previous) &&
        !CONTEXT_STOPWORDS.has(previousNorm)
      ) {
        const phrase = previous + ' ' + modelPhrase;
        const key = normalizeText(phrase);
        if (!seen.has(key)) {
          seen.add(key);
          output.push(phrase);
        }
      }
    }
  }

  return output;
}

export function buildModelQueryVariants(input = {}, candidates = []) {
  const original = clean(input.model || input.mpn || input.query);
  if (!original) return [];

  const variants = [original];
  const fingerprint = modelFingerprint(original);

  for (const candidate of candidates || []) {
    for (const phrase of extractContextualModelPhrases(candidate?.name,original)) {
      variants.push(phrase);
    }
  }

  for (const candidate of candidates || []) {
    for (const value of [candidate?.model,candidate?.mpn,candidate?.name]) {
      for (const phrase of extractEquivalentModelPhrases(value,original)) {
        variants.push(phrase);
      }
    }
  }

  const spaced = original
    .replace(/[_/\-]+/g,' ')
    .replace(/([a-zA-Z])(?=\d)/g,'$1 ')
    .replace(/(\d)(?=[a-zA-Z])/g,'$1 ')
    .replace(/\s+/g,' ')
    .trim();

  if (spaced && modelFingerprint(spaced) === fingerprint) variants.push(spaced);

  const seen = new Set();
  return variants.filter(value => {
    const key = normalizeText(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0,3);
}
