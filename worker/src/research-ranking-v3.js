const clean = value => String(value ?? '').trim();

export function normalizeText(value) {
  return clean(value)
    .toLowerCase()
    .replace(/ł/g,'l')
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

const STEM_ACCESSORY_TERMS = new Set([
  'wyswietl','obudow','szmatk','szczotk','akcesori','nakladk',
  'zlacz','wklad','ekran'
]);

function hasNormalizedTerm(text,term) {
  const value = normalizeText(text);
  const needle = normalizeText(term);
  if (!value || !needle) return false;
  if (STEM_ACCESSORY_TERMS.has(needle)) return value.includes(needle);
  return (' ' + value + ' ').includes(' ' + needle + ' ');
}

const ACCESSORY_NOUNS = [
  'bateria','akumulator','etui','futeral','pokrowiec','filtr','uchwyt',
  'zasilacz','plyta glowna','plytka','plyta','zlacz','buzzer','klapka','wyswietl',
  'mocowanie','front','oslona','toner','beben','chip','slizgacze',
  'obudow','blokad','czujnik','modul','tasma','ekran','przycisk','ramka',
  'pilot','mop','szmatk','szczotk','worek','worki','akcesori','wklad',
  'tusz','atrament','kartridz','cartridge','stojan','kontroler','glowka',
  'silnik','wylacznik','przelacznik','pierscien','kolo zebate','grzalka',
  'kosz','blok zaparzajacy','glosnik rozmow','charging board','nausznik','nakladk','folia',
  'mata ochronna','lacznik','noga','stojak','glowica','korpus',
  'kabel','przewod','adapter','ladowarka','szklo','case','cover',
  'replacement','zamienny','zamienna','zamienne','kompatybilny','kompatybilna'
];

const RELATION_WORDS = [
  ' do ',' dla ',' na ',' kompatybilny z ',' kompatybilna z ',' kompatybilne z ',
  ' pasuje do ',' przeznaczony do ',' przeznaczona do ',' for '
];

const ACCESSORY_CATEGORY_WORDS = [
  'akcesoria','czesci','baterie','akumulatory','etui','pokrowce','filtry',
  'uchwyty','zasilacze','tonery','bebny','kable','ladowarki','wyswietlacze'
];

const HARD_ACCESSORY_NOUNS = [
  'bateria','akumulator','etui','futeral','pokrowiec','filtr','case','cover',
  'folia','szklo','tusz','atrament','kartridz','cartridge',
  'mocowanie','front','oslona','toner','beben','chip','zlacz','buzzer',
  'klapka','plyta glowna','plytka','plyta','zasilacz','wyswietl',
  'obudow','blokad','czujnik','modul','tasma','ekran','przycisk','ramka',
  'pilot','mop','szmatk','szczotk','worek','worki','akcesori','wklad',
  'tusz','atrament','kartridz','cartridge','stojan','kontroler','glowka',
  'silnik','wylacznik','przelacznik','pierscien','kolo zebate','grzalka',
  'kosz','blok zaparzajacy','glosnik rozmow','charging board','nausznik','nakladk','folia',
  'mata ochronna','lacznik','noga','stojak','glowica','korpus'
];


export function classifyCandidateRelation(candidate,input = {}) {
  const name = ' ' + normalizeText(candidate?.name) + ' ';
  const category = normalizeText(candidate?.category);
  const target = clean(input.model || input.mpn || input.query);
  const targetFp = modelFingerprint(target);
  const nameFp = modelFingerprint(candidate?.name);

  const noun = ACCESSORY_NOUNS.find(word => hasNormalizedTerm(name,word)) || '';
  const phoneSpeaker = Boolean(
    hasNormalizedTerm(name,'glosnik') &&
    (
      normalizeText(name).includes('galaxy') ||
      /^sm[a-z0-9]/.test(targetFp)
    )
  );
  if (phoneSpeaker && isProbableModelQuery(input)) {
    return {
      type:'accessory',
      confidence:'strong',
      reason:'glosnik • część urządzenia mobilnego'
    };
  }

  const hardNoun = HARD_ACCESSORY_NOUNS.find(word => hasNormalizedTerm(name,word)) || '';
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

  const candidateModelFp = modelFingerprint(candidate?.model);
  const candidateMpnFp = modelFingerprint(candidate?.mpn);
  const targetIsCandidateIdentity = Boolean(
    targetFp &&
    (
      targetFp === candidateModelFp ||
      targetFp === candidateMpnFp
    )
  );

  if (targetMentioned && noun && !targetIsCandidateIdentity) {
    return {
      type:'accessory',
      confidence:'medium',
      reason:noun + ' • model tylko w nazwie'
    };
  }

  if (
    targetIsCandidateIdentity &&
    noun &&
    [
      'etui','futeral','pokrowiec','case','cover','folia','szklo',
      'pilot','mop','szmatk','szczotk','worek','worki','akcesori',
      'tusz','atrament','kartridz','cartridge','stojan','kontroler','glowka',
      'silnik','wylacznik','przelacznik','pierscien','kolo zebate','grzalka',
      'kosz','blok zaparzajacy','glosnik rozmow','nausznik','nakladk',
      'mocowanie','oslona','obudow','korpus','zlacz','buzzer','klapka',
      'plyta','plytka','zasilacz','wyswietl','ekran','ramka','adapter'
    ].includes(noun)
  ) {
    return {
      type:'accessory',
      confidence:'medium',
      reason:noun + ' • typ produktu'
    };
  }

  if (
    hardNoun &&
    isProbableModelQuery(input) &&
    !targetIsCandidateIdentity
  ) {
    return {
      type:'accessory',
      confidence:'medium',
      reason:hardNoun + ' • brak zgodnej tożsamości modelu'
    };
  }

  const targetNameOverlap = tokenOverlap(target,candidate?.name || '');
  if (
    noun &&
    targetNameOverlap >= 0.8 &&
    [
      'etui','futeral','pokrowiec','case','cover','folia','szklo',
      'pilot','mop','szmatk','szczotk','worek','worki','akcesori',
      'tusz','atrament','kartridz','cartridge','stojan','kontroler','glowka',
      'silnik','wylacznik','przelacznik','pierscien','kolo zebate','grzalka',
      'kosz','blok zaparzajacy','glosnik rozmow','nausznik','nakladk',
      'mocowanie','oslona','obudow','korpus','zlacz','buzzer','klapka',
      'plyta','plytka','zasilacz','wyswietl','ekran','ramka','adapter'
    ].includes(noun)
  ) {
    return {
      type:'accessory',
      confidence:'medium',
      reason:noun + ' • zgodność nazwy z modelem'
    };
  }

  if (targetMentioned && accessoryCategory) {
    return {
      type:'accessory',
      confidence:'medium',
      reason:'kategoria: ' + accessoryCategory
    };
  }

  if (targetMentioned && hardNoun) {
    return {
      type:'accessory',
      confidence:'medium',
      reason:hardNoun
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
      (modelFp && modelFp.length >= 4 && queryFp.includes(modelFp)) ||
      (mpnFp && mpnFp.length >= 5 && queryFp.includes(mpnFp))
    )
  ) {
    const value = modelFp && queryFp.includes(modelFp) ? model : mpn;
    const trusted =
      (value === model && candidate?.trust?.model === true) ||
      (value === mpn && candidate?.trust?.mpn === true);
    const points = trusted ? 60 : 54;
    evidence.push({
      field:'model-contained',
      label:'Dokładny model w podanej frazie',
      status:'match',
      points,
      trusted,
      value
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

  const modelPoints = modelEvidence(candidate,input,evidence,warnings);
  score += modelPoints;
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
  } else if (isProbableModelQuery(input) && modelPoints > 0) {
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
  'uchwyt','toner','beben','chip','zlacze','mocowanie','oslona','front',
  'professional','series','lattego','lightspeed','pro','ultra','max','plus',
  'mini','slim','ecotank','galaxy','oryginalny','oryginalna','zestaw','szt'
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
        /^[\p{Lu}][\p{L}\-]{1,}$/u.test(previous) &&
        !/\d/.test(previous) &&
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

export function extractLooseContextPhrases(value,target) {
  const targetFp = modelFingerprint(target);
  if (!targetFp) return [];

  const rawTokens = clean(value)
    .replace(/[^\p{L}\p{N}\-_/]+/gu,' ')
    .split(/\s+/)
    .filter(Boolean);
  const output = [];
  const seen = new Set();

  for (let start=0; start<rawTokens.length; start++) {
    for (let length=1; length<=4 && start+length<=rawTokens.length; length++) {
      const modelPhrase = rawTokens.slice(start,start+length).join(' ');
      if (modelFingerprint(modelPhrase) !== targetFp) continue;

      for (let offset=1; offset<=6 && start-offset>=0; offset++) {
        const prefix = rawTokens[start-offset];
        const prefixNorm = normalizeText(prefix);
        if (!prefixNorm) continue;
        if (/\d/.test(prefixNorm)) continue;
        if (!/^[a-z][a-z-]{2,}$/i.test(prefixNorm)) continue;
        if (CONTEXT_STOPWORDS.has(prefixNorm)) continue;
        if (ACCESSORY_NOUNS.some(term => hasNormalizedTerm(prefixNorm,term))) continue;

        const phrase = prefix + ' ' + modelPhrase;
        const key = normalizeText(phrase);
        if (!seen.has(key)) {
          seen.add(key);
          output.push(phrase);
        }
        break;
      }
    }
  }

  return output;
}

function stripLiteralTarget(value,target) {
  let result = clean(value);
  const literal = clean(target);
  if (!result || !literal) return result;
  const escaped = literal.replace(/[.*+?^$()|[\]\\]/g,'\\$&');
  result = result.replace(new RegExp(escaped,'ig'),' ');
  return result
    .replace(/[()[\]]/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}

function aliasGroupKey(alias,brand) {
  const brandTokens = new Set(normalizeText(brand).split(' ').filter(Boolean));
  const generic = new Set([
    'galaxy','series','5g','4g','lte','wifi','wi','fi','smart','model'
  ]);
  const tokens = normalizeText(alias).split(' ').filter(Boolean)
    .filter(token => !brandTokens.has(token) && !generic.has(token));
  const modelTokens = tokens.filter(token => /[a-z]/.test(token) && /\d/.test(token));
  return modelTokens.join('|');
}

export function buildModelQueryVariants(input = {}, candidates = []) {
  const original = clean(input.model || input.mpn || input.query);
  if (!original) return [];

  const fingerprint = modelFingerprint(original);
  const suggestions = new Map();

  function add(value,score,reason) {
    const phrase = clean(value);
    const key = normalizeText(phrase);
    if (!key || key === normalizeText(original)) return;
    const current = suggestions.get(key);
    if (!current) {
      suggestions.set(key,{phrase,score,reason,support:1});
      return;
    }
    current.support = Number(current.support || 1) + 1;
    if (score > current.score) {
      current.score = score;
      current.reason = reason;
      current.phrase = phrase;
    }
  }

  for (const candidate of candidates || []) {
    const name = clean(candidate?.name);
    const nameFp = modelFingerprint(name);
    if (!nameFp.includes(fingerprint)) continue;

    const relation = classifyCandidateRelation(candidate,input);
    const brand = clean(candidate?.brand || candidate?.manufacturer);
    const explicit = brand && !genericBrand(brand);

    const equivalent = [];
    for (const value of [candidate?.model,candidate?.mpn,candidate?.name]) {
      for (const phrase of extractEquivalentModelPhrases(value,original)) {
        equivalent.push(phrase);
        const formattingChanged = normalizeText(phrase) !== normalizeText(original);
        add(phrase,formattingChanged ? 56 : 24,'equivalent');
      }
    }
    const canonical = equivalent[0] || original;

    // A catalog brand attached to a product candidate is stronger than a
    // random word next to the model. For accessory candidates we do not use
    // their own brand as the target brand.
    if (explicit && relation.type !== 'accessory') {
      add(brand + ' ' + canonical,46,'catalog-brand');
    }

    if (
      relation.type === 'accessory' &&
      explicit &&
      normalizeText(name).includes(normalizeText(brand))
    ) {
      add(brand + ' ' + canonical,44,'accessory-brand-context');
    }

    for (const phrase of extractContextualModelPhrases(name,original)) {
      const prefix = clean(phrase.split(/\s+/)[0]);
      const prefixIsCatalogBrand =
        explicit &&
        modelFingerprint(prefix) === modelFingerprint(brand);

      let score = 28;
      if (relation.type === 'accessory') {
        score = prefixIsCatalogBrand ? 12 : 42;
      } else if (prefixIsCatalogBrand) {
        score = 48;
      } else if (explicit) {
        score = 32;
      }

      add(phrase,score,'context');
    }

    for (const phrase of extractLooseContextPhrases(name,original)) {
      add(phrase,36,'loose-context');
    }
  }


  const aliasSupport = new Map();
  for (const candidate of candidates || []) {
    const relation = classifyCandidateRelation(candidate,input);
    if (relation.type !== 'accessory') continue;

    const name = clean(candidate?.name);
    const exactContext = extractContextualModelPhrases(name,original)[0] || '';
    const looseContext = extractLooseContextPhrases(name,original)[0] || '';
    const context = exactContext || looseContext;
    const contextBrand = clean(context.split(/\s+/)[0]);
    const explicitBrand = clean(candidate?.brand || candidate?.manufacturer);
    const explicitNamed =
      explicitBrand &&
      !genericBrand(explicitBrand) &&
      normalizeText(name).includes(normalizeText(explicitBrand));
    const brand = contextBrand || (explicitNamed ? explicitBrand : '');

    const rawAlias = clean(candidate?.model);
    const alias = stripLiteralTarget(rawAlias,original) || rawAlias;
    const aliasFp = modelFingerprint(alias);
    const aliasTokens = normalizeText(alias).split(' ').filter(Boolean);
    const group = aliasGroupKey(alias,brand);

    if (
      !brand ||
      !alias ||
      alias.length > 40 ||
      aliasTokens.length < 2 ||
      aliasTokens.length > 6 ||
      !group ||
      !/[a-z]/.test(aliasFp) ||
      !/\d/.test(aliasFp) ||
      aliasFp === fingerprint
    ) continue;

    const key = modelFingerprint(brand) + '|' + group;
    const current = aliasSupport.get(key) || {
      brand,
      alias,
      count:0,
      richness:0
    };
    current.count += 1;

    const richness =
      (normalizeText(alias).includes('galaxy') ? 4 : 0) +
      Math.min(4,aliasTokens.length);
    if (richness > current.richness) {
      current.alias = alias;
      current.richness = richness;
    }
    aliasSupport.set(key,current);
  }

  for (const item of aliasSupport.values()) {
    if (item.count < 2) continue;
    const aliasText = normalizeText(item.alias).includes(normalizeText(item.brand))
      ? item.alias
      : item.brand + ' ' + item.alias;
    add(aliasText,62 + Math.min(12,(item.count - 2) * 4),'repeated-alias');
  }

  const spaced = original
    .replace(/[_/\-]+/g,' ')
    .replace(/([a-zA-Z])(?=\d)/g,'$1 ')
    .replace(/(\d)(?=[a-zA-Z])/g,'$1 ')
    .replace(/\s+/g,' ')
    .trim();

  if (spaced && modelFingerprint(spaced) === fingerprint) {
    add(spaced,8,'spacing');
  }

  const ranked = [...suggestions.values()]
    .map(item => ({
      ...item,
      effectiveScore:item.score + Math.min(16,Math.max(0,Number(item.support || 1) - 1) * 4)
    }))
    .sort((a,b) =>
      b.effectiveScore - a.effectiveScore ||
      b.score - a.score ||
      a.phrase.localeCompare(b.phrase,'pl')
    );

  return [original,...ranked.map(item => item.phrase)].slice(0,3);
}
