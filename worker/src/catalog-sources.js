const clean = value => String(value ?? '').trim();

function norm(value) {
  return clean(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu,' ')
    .trim();
}

function normCode(value) {
  const digits = clean(value).replace(/\D/g,'');
  return digits ? digits.replace(/^0+(?=\d{8,}$)/,'') : '';
}

function same(a,b,field='') {
  if (field === 'ean') {
    const aa = normCode(a);
    const bb = normCode(b);
    return Boolean(aa && bb && aa === bb);
  }
  return Boolean(clean(a) && clean(b) && norm(a) === norm(b));
}

function sourceValue(source, field) {
  if (field === 'ean') {
    return clean(
      source?.catalogEan ||
      source?.eanList?.[0] ||
      source?.gtinList?.[0] ||
      source?.ean
    );
  }
  if (field === 'partNumber') return clean(source?.partNumber);
  return clean(source?.[field]);
}

function sourceConflict(field, label, leftValue, rightValue, severity, left, right) {
  return {
    key:'source:' + left.key + ':' + right.key + ':' + field,
    field,
    label,
    severity,
    type:'source-disagreement',
    values:[
      left.label + ': ' + clean(leftValue),
      right.label + ': ' + clean(rightValue)
    ],
    options:[
      {
        choice:left.key,
        source:left.key,
        label:'Użyj ' + left.label,
        value:clean(leftValue)
      },
      {
        choice:right.key,
        source:right.key,
        label:'Użyj ' + right.label,
        value:clean(rightValue)
      }
    ],
    message:left.label + ' i ' + right.label + ' zwracają różne wartości. Tester wybiera wartość mastera.'
  };
}

export function compareNamedCatalogSources(leftSource, rightSource, options = {}) {
  if (!leftSource || !rightSource) {
    return {conflicts:[],hardConflictDetails:[],checks:[]};
  }

  const left = {
    key:clean(options.leftKey || leftSource.source || 'left'),
    label:clean(options.leftLabel || leftSource.source || 'Źródło 1')
  };
  const right = {
    key:clean(options.rightKey || rightSource.source || 'right'),
    label:clean(options.rightLabel || rightSource.source || 'Źródło 2')
  };

  const definitions = options.definitions || [
    ['ean','EAN / GTIN','critical'],
    ['model','Model','critical'],
    ['partNumber','Numer części','critical'],
    ['brand','Marka','warning']
  ];

  const conflicts = [];
  const hardConflictDetails = [];
  const checks = [];

  for (const [field,label,severity] of definitions) {
    const a = sourceValue(leftSource,field);
    const b = sourceValue(rightSource,field);

    if (!a || !b) {
      checks.push({
        label:label + ' • źródła',
        value:a || b || 'brak',
        status:'warn',
        text:'jedno źródło nie podało wartości'
      });
      continue;
    }

    if (same(a,b,field)) {
      checks.push({
        label:label + ' • źródła',
        value:a,
        status:'ok',
        text:left.label + ' i ' + right.label + ' zgodne'
      });
      continue;
    }

    const conflict = sourceConflict(field,label,a,b,severity,left,right);
    conflicts.push(conflict);
    if (severity === 'critical') hardConflictDetails.push(conflict);

    checks.push({
      label:label + ' • źródła',
      value:a + ' ↔ ' + b,
      status:severity === 'critical' ? 'bad' : 'warn',
      text:'wybór testera'
    });
  }

  return {conflicts,hardConflictDetails,checks};
}

export function compareCatalogSources(allegro, amazon) {
  return compareNamedCatalogSources(allegro,amazon,{
    leftKey:'allegro',
    leftLabel:'Allegro',
    rightKey:'amazon',
    rightLabel:'Amazon',
    definitions:[
      ['ean','EAN / GTIN','critical'],
      ['model','Model','critical'],
      ['brand','Marka','warning']
    ]
  });
}

export function compareAllegroKeepa(allegro, keepa) {
  return compareNamedCatalogSources(allegro,keepa,{
    leftKey:'allegro',
    leftLabel:'Allegro',
    rightKey:'keepa',
    rightLabel:'Keepa / Amazon',
    definitions:[
      ['ean','EAN / GTIN','critical'],
      ['model','Model','critical'],
      ['partNumber','Numer części','critical'],
      ['brand','Marka','warning']
    ]
  });
}

export function sourceLabel(sources = {}) {
  const names = [];
  if (sources.allegro) names.push('Allegro');
  if (sources.keepa) names.push('Keepa');
  if (sources.amazon) names.push('Amazon SP-API');
  return names.join(' + ') || 'API';
}

export function sourceConsensusSummary(leftSource, rightSource, labels = {}) {
  if (!leftSource || !rightSource) {
    return {
      available:false,
      matched:0,
      compared:0,
      label:'Jedno źródło'
    };
  }

  const fields = ['ean','model','partNumber','brand'];
  let matched = 0;
  let compared = 0;

  for (const field of fields) {
    const a = sourceValue(leftSource,field);
    const b = sourceValue(rightSource,field);
    if (!a || !b) continue;
    compared++;
    if (same(a,b,field)) matched++;
  }

  const leftLabel = clean(labels.leftLabel || leftSource.source || 'Źródło 1');
  const rightLabel = clean(labels.rightLabel || rightSource.source || 'Źródło 2');

  return {
    available:true,
    matched,
    compared,
    label:compared
      ? (matched + '/' + compared + ' zgodnych pól kluczowych • ' + leftLabel + ' ↔ ' + rightLabel)
      : 'Brak wspólnych pól do porównania'
  };
}
