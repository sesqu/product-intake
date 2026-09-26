const assert = require('assert');
const ProductStorage = require('../product-storage.js');

class MemoryStorage {
  constructor(seed = {}) { this.data = new Map(Object.entries(seed)); }
  getItem(key) { return this.data.has(key) ? this.data.get(key) : null; }
  setItem(key, value) { this.data.set(key, String(value)); }
  removeItem(key) { this.data.delete(key); }
}

const KEY = 'productIntake.products.v2';
const storage = new MemoryStorage();

const fixtures = [
  { lpn: 'TEST-001', productName: 'Produkt testowy 1', ean: '5900000000011', loc: 'A-01' },
  { lpn: 'TEST-002', productName: 'Produkt testowy 2', ean: '5900000000028', loc: 'A-02' },
  { lpn: 'TEST-003', productName: 'Produkt testowy 3', ean: '5900000000035', loc: 'A-03' }
];

for (const product of fixtures) {
  const result = ProductStorage.saveProduct(storage, KEY, product);
  assert.equal(result.created, true);
}

let products = ProductStorage.getProducts(storage, KEY);
assert.equal(products.length, 3, 'Po zapisaniu trzech produktów powinny istnieć dokładnie 3 rekordy');
assert.deepEqual(
  new Set(products.map(p => p.lpn)),
  new Set(['TEST-001','TEST-002','TEST-003'])
);

// Symulacja ponownego uruchomienia/odświeżenia: nowy obiekt Storage z zapisanym JSON-em.
const persistedRaw = storage.getItem(KEY);
const afterReload = new MemoryStorage({ [KEY]: persistedRaw });
products = ProductStorage.getProducts(afterReload, KEY);
assert.equal(products.length, 3, 'Po odświeżeniu nadal powinny istnieć 3 rekordy');

// Powtórny zapis tego samego LPN ma aktualizować, a nie tworzyć duplikat.
const update = ProductStorage.saveProduct(afterReload, KEY, {
  lpn: 'TEST-002',
  productName: 'Produkt testowy 2 - poprawiony',
  ean: '5900000000028',
  loc: 'B-99'
});
assert.equal(update.updated, true);
products = ProductStorage.getProducts(afterReload, KEY);
assert.equal(products.length, 3, 'Aktualizacja istniejącego LPN nie może zwiększać liczby rekordów');
assert.equal(products[0].lpn, 'TEST-002');
assert.equal(products[0].loc, 'B-99');

console.log('PASS: zapisano 3 produkty, odczytano je po reloadzie i zablokowano duplikat LPN.');


// status test: editor must preserve catalog/test status unless explicitly changed.
const special = ProductStorage.saveProduct(afterReload, KEY, {
  lpn: 'TEST-STATUS',
  productName: 'Produkt statusowy',
  status: 'catalog-test'
});
assert.equal(special.record.status, 'catalog-test');
const specialUpdate = ProductStorage.saveProduct(afterReload, KEY, {
  lpn: 'TEST-STATUS',
  productName: 'Produkt statusowy po edycji'
});
assert.equal(specialUpdate.record.status, 'catalog-test', 'Edycja nie może samoczynnie zmienić statusu produktu');
console.log('PASS status test: status produktu zachowany przy edycji.');
