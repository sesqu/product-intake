const fs = require('fs');
const assert = require('assert');

const scripts = [
  'intake-core.js',
  'product-storage.js',
  'pwa-updates.js',
  'modal-ui.js',
  'navigation.js',
  'cloud-products.js',
  'catalog-lookup.js',
  'intake-session.js',
  'secondary-views.js',
  'product-list.js',
  'product-editor.js',
  'product-finder.js',
  'product-research.js',
  'enhancements.js',
  'sw.js'
];

for (const file of scripts) {
  const source = fs.readFileSync(file, 'utf8');
  assert.doesNotThrow(() => new Function(source), file + ' ma błąd składni');
}

const version = JSON.parse(fs.readFileSync('version.json', 'utf8'));
assert(Number.isInteger(version.version), 'version.json musi mieć numeryczne version');
assert.equal(version.label, 'v' + version.version, 'label wersji musi zgadzać się z version');

const html = fs.readFileSync('index.html', 'utf8');
const sw = fs.readFileSync('sw.js', 'utf8');

for (const file of [
  'styles.css',
  'intake-core.js',
  'pwa-updates.js',
  'modal-ui.js',
  'navigation.js',
  'cloud-products.js',
  'catalog-lookup.js',
  'intake-session.js',
  'secondary-views.js',
  'product-editor.js',
  'product-finder.js',
  'product-research.js',
  'enhancements.js'
]) {
  assert(
    html.includes(file),
    'index.html nie ładuje ' + file
  );
  assert(
    sw.includes(file),
    'sw.js nie cacheuje ' + file
  );
}

const runtimeMatch = fs.readFileSync('enhancements.js', 'utf8')
  .match(/ProductIntakePWA\?\.setup\(\{build:(\d+),label:'v(\d+)'\}\)/);

assert(runtimeMatch, 'Brak konfiguracji wersji runtime PWA');
assert.equal(Number(runtimeMatch[1]), version.version, 'Runtime build != version.json');
assert.equal(Number(runtimeMatch[2]), version.version, 'Runtime label != version.json');

console.log('PASS: składnia modułów, wersja, index.html i cache PWA są spójne.');


for (const id of ['productName','brand','model','category','parameters','serial','flaws','weight']) {
  assert(
    html.includes('id="' + id + '"'),
    'Brak stałego id pola: ' + id
  );
}
console.log('PASS stable intake field ids.');


const sessionSource = fs.readFileSync('intake-session.js', 'utf8');
assert(
  sessionSource.includes('identificationBlockingState'),
  'Brak bezpośredniej walidacji stanu konfliktów identyfikacji'
);
assert(
  sessionSource.includes('rozstrzygnięcie krytycznych konfliktów'),
  'Krytyczne konflikty nie blokują finalnego zapisu'
);
assert(
  sessionSource.includes('Konflikt do rozstrzygnięcia'),
  'UI kontroli końcowej nie sygnalizuje nierozstrzygniętego konfliktu'
);
console.log('PASS critical conflict ready-state guard.');


const catalogSource = fs.readFileSync('catalog-lookup.js', 'utf8');
const productEditorSource = fs.readFileSync('product-editor.js', 'utf8');

assert(
  catalogSource.includes('sourceSnapshot: latestSourceSnapshot'),
  'Stan katalogu nie udostępnia snapshotu źródła'
);
assert(
  sessionSource.includes('out.sourceSnapshot = catalogState.sourceSnapshot || null'),
  'Draft nie zapisuje snapshotu źródła'
);
assert(
  sessionSource.includes('draft.sourceSnapshot || null'),
  'Draft nie odtwarza snapshotu źródła'
);
assert(
  productEditorSource.includes('data-tab="identification"'),
  'Edytor produktu nie ma zakładki audytu identyfikacji'
);
assert(
  productEditorSource.includes('confidenceMethodLabel'),
  'Edytor produktu nie pokazuje wersji/metody scoringu'
);
console.log('PASS source snapshot and identification audit trail.');


assert(
  html.includes('id="sourceMode"') && html.includes('value="allegro"'),
  'Aktywne źródło identyfikacji powinno pozostać Allegro'
);
assert(
  !html.includes('value="keepa"') && !html.includes('value="amazon"') && !html.includes('value="allegro-keepa"'),
  'Nieaktywne źródła nie powinny być dostępne w selektorze'
);
assert(
  catalogSource.includes("|| 'allegro'"),
  'Frontend powinien domyślnie używać Allegro'
);

const finderSource = fs.readFileSync('product-finder.js', 'utf8');
const researchSource = fs.readFileSync('product-research.js', 'utf8');

assert(
  html.includes('id="productFinderQuery"') &&
  html.includes('id="productFinderSearch"') &&
  html.includes('EAN, ASIN, modelu, MPN') &&
  html.includes('id="productFinderAsin"') &&
  html.includes('id="productFinderAmazonDomain"'),
  'Główna identyfikacja nie zawiera uniwersalnego wyszukiwania produktu'
);
assert(
  finderSource.includes("detectKind") &&
  finderSource.includes("acceptResearchResult") &&
  finderSource.includes("pamięć 24h"),
  'Finder nie ma detekcji EAN/research, ręcznego użycia wyniku lub cache'
);
assert(
  catalogSource.includes('function acceptResearchResult'),
  'Catalog lookup nie przyjmuje jawnie wybranego wyniku Research'
);
assert(
  fs.readFileSync('navigation.js','utf8').includes('Znajdź produkt') &&
  fs.readFileSync('navigation.js','utf8').includes('data-act="search"'),
  'Wyszukiwanie produktu nie jest główną akcją nawigacji'
);
console.log('PASS unified product finder wiring.');

assert(
  researchSource.includes('Wystarczy sam model'),
  'Kreator opisu nie komunikuje wyszukiwania po samym modelu'
);
assert(
  fs.existsSync('worker/src/dormant/amazon.js') && fs.existsSync('worker/src/dormant/keepa.js'),
  'Odłożone moduły powinny pozostać zachowane poza aktywną ścieżką'
);
const workerIndex = fs.readFileSync('worker/src/index.js','utf8');
assert(
  !workerIndex.includes("from './amazon.js'") && !workerIndex.includes("from './keepa.js'"),
  'Worker nie powinien importować odłożonych integracji'
);
console.log('PASS active sources trimmed and model research UI wired.');
