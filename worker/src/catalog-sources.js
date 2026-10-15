const clean = value => String(value ?? '').trim();

function norm(value) {
  return clean(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu,' ')
    .trim();
}

function same(a,b) {
  return Boolean(clean(a) && clean(b) && norm(a) === norm(b));
}

function sourceValue(source, field) {
  if (field === 'ean') return clean(source?.catalogEan);
  return clean(source?.[field]);
}

function sourceConflict(field, label, allegroValue, amazonValue, severity='warning') {
  return {
    key:'source:' + field,
    field,
    label,
    severity,
    type:'source-disagreement',
    values:[
      'Allegro: ' + clean(allegroValue),
      'Amazon: ' + clean(amazonValue)
    ],
    options:[
      {
        choice:'allegro',
        source:'allegro',
        label:'Użyj Allegro',
        value:clean(allegroValue)
      },
      {
        choice:'amazon',
        source:'amazon',
        label:'Użyj Amazon',
        value:clean(amazonValue)
      }
    ],
    message:'Allegro i Amazon zwracają różne wartości. Tester wybiera wartość mastera.'
  };
}

export function compareCatalogSources(allegro, amazon) {
  if (!allegro || !amazon) {
    return {
      conflicts:[],
      hardConflictDetails:[],
      checks:[]
    };
  }

  const definitions = [
    ['ean','EAN / GTIN','critical'],
    ['model','Model','critical'],
    ['brand','Marka','warning']
  ];

  const conflicts = [];
  const hardConflictDetails = [];
  const checks = [];

  for (const [field,label,severity] of definitions) {
    const a = sourceValue(allegro,field);
    const b = sourceValue(amazon,field);

    if (!a || !b) {
      checks.push({
        label:label + ' • źródła',
        value:a || b || 'brak',
        status:'warn',
        text:'jedno źródło nie podało wartości'
      });
      continue;
    }

    if (same(a,b)) {
      checks.push({
        label:label + ' • źródła',
        value:a,
        status:'ok',
        text:'Allegro i Amazon zgodne'
      });
      continue;
    }

    const conflict = sourceConflict(field,label,a,b,severity);
    conflicts.push(conflict);
    if (severity === 'critical') hardConflictDetails.push(conflict);

    checks.push({
      label:label + ' • źródła',
      value:a + ' ↔ ' + b,
      status:severity === 'critical' ? 'bad' : 'warn',
      text:'wybór testera'
    });
  }

  return {conflicts, hardConflictDetails, checks};
}

export function sourceLabel(sources = {}) {
  const names = [];
  if (sources.allegro) names.push('Allegro');
  if (sources.amazon) names.push('Amazon');
  return names.join(' + ') || 'API';
}

export function sourceConsensusSummary(allegro, amazon) {
  if (!allegro || !amazon) {
    return {
      available:false,
      matched:0,
      compared:0,
      label:'Jedno źródło'
    };
  }

  const fields = ['ean','model','brand'];
  let matched = 0;
  let compared = 0;

  for (const field of fields) {
    const a = clean(allegro?.[field]);
    const b = clean(amazon?.[field]);
    if (!a || !b) continue;
    compared++;
    if (same(a,b)) matched++;
  }

  return {
    available:true,
    matched,
    compared,
    label:compared ? (matched + '/' + compared + ' zgodnych pól kluczowych') : 'Brak wspólnych pól do porównania'
  };
}
