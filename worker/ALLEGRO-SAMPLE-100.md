# Allegro — zrównoważona próbka 100 modeli (21.10.2026)

## Dlaczego rozszerzyliśmy test

Poprzedni test 10 modeli był zdominowany przez smartfony, akcesoria
do robotów sprzątających i elektronarzędzia. Zwiększyliśmy próbkę do
**100 unikalnych zapytań** z **10 kategorii × 10 modeli**, uporządkowanych
tak, aby każda kolejna dziesiątka zawierała jeden produkt z każdej kategorii.

Kategorie: smartfony, słuchawki/audio, roboty sprzątające,
elektronarzędzia, ekspresy, laptopy, monitory, konsole/peryferia,
aparaty/kamery, AGD.

Plik wejściowy: [tests/fixtures/allegro-sample-100.json](../tests/fixtures/allegro-sample-100.json).
Są to nazwy/kody modeli do testowania; **nie są automatycznie
potwierdzonymi identyfikatorami fizycznych sztuk**, dlatego wszystkie
rekordy mają `verifiedGroundTruth:false`.

## Rzeczywisty test aktualnego v43

Dnia **21.10.2026** wykonano 100 żądań `POST /api/research` na
**istniejącym produkcyjnym Workerze v43**, bez zapisywania produktów.
[GitHub Actions — pełne 100](https://github.com/sesqu/product-intake/actions/runs/39539848635).

- **100/100** HTTP 200 — backend dostępny.
- **98/100** zwróciło co najmniej jednego kandydata — ale to NIE jest 98% poprawnych identyfikacji.
- **2/100** bez kandydatów: `MSI G274QPF-QD` i `Samsung S27AG500PP`.
- **83/100** stary backend oznaczył jako wymagające wyboru testera,
  a dla pozostałych 17 nie oznaczył — nie dowodzi to ich poprawności.
- Mediana czasu API ok. **786 ms**, 95. percentyl ok. **1417 ms**
  w tym pojedynczym teście; zależą od obciążenia i sieci.
- Stary v43 nie wystawia liczby wewnętrznych requestów do Allegro
  w tym endpointzie, dlatego `reportedRequests=0` oznacza
  brak telemetrii, **a nie zero żądań Allegro**.

Wyniki na trwałe zachowano w
[tests/fixtures/allegro-live-v43-100-2026-10-21.json](../tests/fixtures/allegro-live-v43-100-2026-10-21.json).
GitHub Actions ma też plik wynikowy JSON w artefaktach biegu.

## Lokalny replay rankingu v44 na tych samych kandydatach

Nowe zapytania frazowe, MPN oraz druga strona wyników **nie są tu
uruchamiane** — analizujemy tylko ponowną kolejność pierwszych
pięciu kandydatów rzeczywiście zwróconych przez v43.

Po poprawkach:

- **39/100** przypadków ma innego kandydata na TOP1 niż v43.
  Sama zmiana kolejności nie oznacza poprawy skuteczności.
- **80/100** wymaga wyboru testera według v44.
- **25/100** TOP1 ma nazwę sugerującą część lub akcesorium według
  ograniczonego automatycznego wzorca. Ta miara jest szacunkowa.
- Dla tych 25 v44 nie oznacza wyniku jako gotowego do automatycznego
  zaakceptowania. To **nie dowodzi**, że wszystkie pozostałe propozycje są bezpieczne.
- Próbka wykryła regresje: `Dell P2422H` (podstawa zamiast monitora)
  i `GBH 2-26` (włącznik zamiast wiertarki). Zmieniono klasyfikację
  akcesoriów i dodano twarde testy zapobiegające nawrotowi błędu.

[GitHub Actions — replay 100 modeli](https://github.com/sesqu/product-intake/actions/runs/39540511322).

## Co pozostaje do uczciwego pomiaru skuteczności

**Nie liczymy TOP1/TOP3 jako poprawnego tylko dlatego, że w nazwie jest
szukany model.** Tester musi potwierdzić:
1. Czy to właściwe kompletne urządzenie, nie część, atrapa ani zestaw
   odnoszący się do innego SKU.
2. Zgodność marki, modelu i wariantu (np. pamięć, rewizja, kompletność).
3. Czy przynajmniej jedna właściwa propozycja znajduje się w TOP3.

Szablon ręcznej oceny i licznik sprawdzonych przypadków:

```bash
node tests/allegro-benchmark-review.mjs template benchmark-results/production-batch-all.json > reviews-v43.json
# Ręcznie uzupełnij statusy, osobę oceniającą i datę:
node tests/allegro-benchmark-review.mjs score benchmark-results/production-batch-all.json reviews-v43.json
```

Bez takich etykiet wynik testu mówi o dostępności, liczbie propozycji
i wykrytych ryzykach, ale **nie o procentowej trafności**.

## Porównanie v43 ↔ v44 na prawdziwym API

Nowy skrypt działa na **dokładnie tej samej próbce 100**:

```bash
# Najpierw wybierz 10 modeli z różnych kategorii:
BENCHMARK_TARGET=production BENCHMARK_BATCH=0 node tests/allegro-benchmark-100.mjs
# Pełna setka tylko po jawnym włączeniu:
BENCHMARK_TARGET=staging BENCHMARK_BATCH=all ALLOW_100_LIVE=true \
 V44_STAGE_KEY='<sekret środowiska testowego>' node tests/allegro-benchmark-100.mjs
```

W GitHub Actions wybierz **Allegro 100-model balanced sample**
→ *Run workflow* → `target=staging`, `batch=all`. Wymaga to
odizolowanego Workera z testowym OAuth Allegro i sekretami; nie
zmienia publicznej aplikacji. Plik wynikowy w artefakcie pozwoli
przeprowadzić **ocenę obu backendów na tych samych 100 przypadkach**.

**Nie twierdzimy, że 100 zapytań v44 wykonano live.** Staging pozostaje
niewdrożony; obecne prawdziwe obserwacje pochodzą z v43.
