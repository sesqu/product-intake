const clean = value => String(value ?? '').trim();

export function normalizeIdentity(value) {
  return clean(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function parameterValue(product, aliases) {
  const wanted = aliases.map(normalizeIdentity);

  for (const parameter of product?.parameters || []) {
    if (!wanted.includes(normalizeIdentity(parameter?.name))) continue;
    const value = clean(parameter?.value);
    if (value) return value;
  }

  return '';
}

function fieldValue(product, field) {
  switch (field) {
    case 'model':
      return clean(product?.model);
    case 'capacity':
      return parameterValue(product, [
        'Pojemność',
        'Pojemność pamięci',
        'Pamięć wbudowana',
        'Pamięć urządzenia',
        'Pojemność dysku',
        'Pojemność SSD',
        'Storage',
        'Capacity'
      ]);
    case 'variant':
      return parameterValue(product, [
        'Wariant',
        'Wersja',
        'Edycja',
        'Variant',
        'Version',
        'Edition'
      ]);
    case 'brand':
      return clean(product?.brand);
    case 'color':
      return parameterValue(product, [
        'Kolor',
        'Kolor dominujący',
        'Color',
        'Colour'
      ]);
    case 'category':
      return clean(product?.category);
    default:
      return '';
  }
}

function distinctValues(products, field) {
  const byNormalized = new Map();

  for (const product of products) {
    const value = fieldValue(product, field);
    const normalized = normalizeIdentity(value);
    if (!normalized) continue;
    if (!byNormalized.has(normalized)) byNormalized.set(normalized, value);
  }

  return [...byNormalized.values()];
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

  return Math.round(
    checks.filter(Boolean).length / checks.length * 100
  );
}

function exactCatalogEan(product, queryEan) {
  const catalogEan = clean(product?.catalogEan || product?.ean);
  return Boolean(
    catalogEan &&
    normalizeIdentity(catalogEan) === normalizeIdentity(queryEan)
  );
}

function catalogEanMismatch(product, queryEan) {
  const catalogEan = clean(product?.catalogEan);
  return Boolean(
    catalogEan &&
    queryEan &&
    normalizeIdentity(catalogEan) !== normalizeIdentity(queryEan)
  );
}

function scoreCandidate(product, queryEan, criticalConflictCount) {
  const evidence = [];
  let score = 0;

  if (exactCatalogEan(product, queryEan)) {
    score += 60;
    evidence.push({
      key:'ean',
      label:'EAN / GTIN',
      status:'strong',
      points:60,
      text:'EAN potwierdzony w danych katalogowych'
    });
  } else if (!clean(product?.catalogEan) && clean(product?.ean)) {
    score += 48;
    evidence.push({
      key:'ean',
      label:'EAN / GTIN',
      status:'medium',
      points:48,
      text:'Produkt znaleziony w trybie GTIN, ale katalog nie zwrócił osobnego pola EAN'
    });
  } else {
    evidence.push({
      key:'ean',
      label:'EAN / GTIN',
      status:'conflict',
      points:0,
      text:'EAN wymaga wyjaśnienia'
    });
  }

  if (clean(product?.model)) {
    score += 14;
    evidence.push({
      key:'model',
      label:'Model',
      status:'strong',
      points:14,
      text:'Model jest określony'
    });
  } else {
    evidence.push({
      key:'model',
      label:'Model',
      status:'missing',
      points:0,
      text:'Brak modelu'
    });
  }

  if (clean(product?.brand)) {
    score += 8;
    evidence.push({
      key:'brand',
      label:'Marka',
      status:'strong',
      points:8,
      text:'Marka jest określona'
    });
  }

  if (clean(product?.category)) {
    score += 5;
    evidence.push({
      key:'category',
      label:'Kategoria',
      status:'supporting',
      points:5,
      text:'Kategoria jest określona'
    });
  }

  if (clean(product?.name)) {
    score += 3;
    evidence.push({
      key:'name',
      label:'Nazwa',
      status:'supporting',
      points:3,
      text:'Nazwa katalogowa jest dostępna'
    });
  }

  if (criticalConflictCount === 0) {
    score += 10;
    evidence.push({
      key:'consensus',
      label:'Jednoznaczność katalogu',
      status:'strong',
      points:10,
      text:'Brak konfliktu modelu, wariantu i pojemności między kandydatami'
    });
  } else {
    evidence.push({
      key:'consensus',
      label:'Jednoznaczność katalogu',
      status:'conflict',
      points:0,
      text:'Katalog zwrócił konkurencyjne warianty'
    });
  }

  if (catalogEanMismatch(product, queryEan)) {
    score = Math.min(score, 25);
  }

  if (criticalConflictCount > 0) {
    score = Math.min(score, 69);
  }

  return {
    score:Math.max(0,Math.min(100,Math.round(score))),
    evidence,
    completeness:candidateCompleteness(product)
  };
}

function buildDisagreement(field, label, values, severity='critical') {
  return {
    key:field,
    label,
    severity,
    type:'candidate-disagreement',
    values,
    message:
      'Allegro zwróciło różne wartości pola „' +
      label +
      '” dla tego samego wyszukiwania.'
  };
}

export function analyzeIdentification(products, queryEan, selectedId='') {
  const candidates = Array.isArray(products)
    ? products.filter(Boolean)
    : [];

  if (!candidates.length) {
    return {
      selected:null,
      ranked:[],
      confidence:0,
      completeness:0,
      evidence:[],
      conflicts:[],
      hardConflicts:[],
      warnings:[],
      requiresTesterChoice:false,
      confidenceMethod:'weighted-identification-v2'
    };
  }

  const criticalDefinitions = [
    ['model','Model'],
    ['capacity','Pojemność'],
    ['variant','Wariant']
  ];

  const warningDefinitions = [
    ['brand','Marka'],
    ['color','Kolor'],
    ['category','Kategoria']
  ];

  const conflicts = [];

  for (const [field,label] of criticalDefinitions) {
    const values = distinctValues(candidates,field);
    if (values.length > 1) {
      conflicts.push(buildDisagreement(field,label,values,'critical'));
    }
  }

  for (const [field,label] of warningDefinitions) {
    const values = distinctValues(candidates,field);
    if (values.length > 1) {
      conflicts.push(buildDisagreement(field,label,values,'warning'));
    }
  }

  const criticalDisagreements =
    conflicts.filter(item => item.severity === 'critical');

  const ranked = candidates
    .map(product => {
      const analysis = scoreCandidate(
        product,
        queryEan,
        criticalDisagreements.length
      );

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
      clean(a.name).localeCompare(clean(b.name),'pl')
    );

  const requested = clean(selectedId);
  const selected =
    (requested && ranked.find(item => clean(item.id) === requested)) ||
    ranked[0];

  const hardConflicts = [];

  if (catalogEanMismatch(selected,queryEan)) {
    hardConflicts.push({
      key:'ean',
      label:'EAN / GTIN',
      severity:'critical',
      type:'value-mismatch',
      expected:clean(queryEan),
      actual:clean(selected.catalogEan),
      message:'EAN produktu z katalogu różni się od zeskanowanego EAN.'
    });
  }

  const requiresTesterChoice =
    !requested &&
    criticalDisagreements.length > 0;

  const selectedAnalysis = scoreCandidate(
    selected,
    queryEan,
    requiresTesterChoice ? criticalDisagreements.length : 0
  );

  return {
    selected:{
      ...selected,
      score:selectedAnalysis.score,
      completeness:selectedAnalysis.completeness,
      identificationEvidence:selectedAnalysis.evidence
    },
    ranked,
    confidence:selectedAnalysis.score,
    completeness:selectedAnalysis.completeness,
    evidence:selectedAnalysis.evidence,
    conflicts,
    hardConflicts,
    warnings:conflicts.filter(item => item.severity !== 'critical'),
    requiresTesterChoice,
    selectedBy:requested ? 'tester' : 'ranking',
    confidenceMethod:'weighted-identification-v2'
  };
}

export function conflictLabel(conflict) {
  return clean(conflict?.label || conflict?.key || 'Konflikt');
}
