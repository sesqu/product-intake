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
  'modal.js',
  'secondary-views.js',
  'product-editor.js',
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
  'modal.js',
  'secondary-views.js',
  'product-editor.js',
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
