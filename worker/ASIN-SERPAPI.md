# Product Intake — ASIN z Amazon przez SerpApi

## Dostawca i ograniczenia

Sprawdzone 18.10.2026: SerpApi (https://serpapi.com/amazon-product-api)
udostępnia Amazon Product API z wyszukiwaniem po ASIN. Plan Free
(https://serpapi.com/) daje 250 wyszukań miesięcznie. Obsługiwane
sklepy: amazon.pl, amazon.de i amazon.com. Jest to zewnętrzna komercyjna
usługa z darmowym limitem, nie oficjalne API Amazon.

## Wyszukiwanie w Product Intake

1. Otwórz Dodaj produkt → Znajdź produkt (wersja z PR #8).
2. Wpisz typowy ASIN (np. B072MQ5BRX) w główne pole lub użyj
   Doprecyzuj wyszukiwanie → ASIN (Amazon).
3. Wybierz sklep: Polska / Niemcy / USA (domyślnie Polska).
4. Kliknij Szukaj. Produkt pojawi się z nazwą, marką, modelem,
   zdjęciami i parametrami, o ile były dostępne.
5. Sprawdź, czy produkt i wariant zgadzają się z fizyczną sztuką.
   Aby świadomie wpisać dane, kliknij:
   Potwierdzam produkt i używam danych Amazon.
6. Jeśli w masterze są inne wartości niż na Amazon, aplikacja pyta
   dla każdego konfliktu, czy zachować dotychczasową wartość, czy
   użyć Amazon. Oryginalne dane źródła nadal pozostają w audycie.

Główne pole automatycznie rozpoznaje typowe ASIN rozpoczynające się od
B i zawierające cyfry. Każdy alfanumeryczny ASIN mający 10 znaków można
wpisać przez osobne pole ASIN. Dziesięciocyfrowy kod w polu głównym
pozostaje traktowany jako EAN.

Amazon nie jest źródłem nadrzędnym względem Allegro ani danych fizycznego
produktu. Dane oznaczane są jako Amazon/SerpApi, nie Allegro.
Nie dopisujemy EAN przez zgadywanie, a brak pewności nie jest prezentowany
jako 100%. Dane GPSR i mapowanie Allegro wymagają osobnego uzupełnienia.

## Konfiguracja BEZPŁATNEGO klucza API

1. Utwórz konto na https://serpapi.com/ i pobierz własny klucz API.
2. W Cloudflare Workers & Pages otwórz testowy Worker
   product-intake-v44b-staging, a następnie w Settings → Variables
   and Secrets ustaw SEKRET SERPAPI_API_KEY.
3. Alternatywnie zapisz SerpApi klucz jako GitHub Actions Secret
   V44B_SERPAPI_API_KEY. Staging deploy przeniesie go jako
   SerpApi Worker secret, jeśli istnieje i staging zostanie uruchomiony.
4. W Product Intake przełącz Tryb testowania wyszukiwania →
   Testuj wyszukiwanie na osobnym Workerze v44b.
   Wpisz klucz stagingowy (oddzielny od klucza SerpApi).

Nie zapisuj SerpApi API key w repozytorium, kodzie frontendu ani
w rozmowie. Samo wdrożenie zmian w GitHubie NIE uruchamia Workerów.
Późniejsze wdrożenie produkcyjne wymaga ustawienia SERPAPI_API_KEY
również na produkcyjnym Workerze — nie zostało wykonane.

## Koszty, cache i ochrona

- Jeden nowy ASIN w wybranym regionie = jedno zapytanie SerpApi.
  Nie odpytujemy automatycznie kolejnych regionów, co zużywałoby kredyty.
- Cache KV: trafienia 24 h, brak produktu 1 h.
- Limit bezpieczeństwa we własnym Workerze: 200 nowych wywołań miesięcznie
  oraz 20 na dzień na połączenie, pozostawiając margines darmowego planu.
- Workers KV ma spójność ostateczną, więc przy wyścigach liczników nie jest
  to nieprzekraczalny limit kosztów. Kontroluj kredyty także w panelu SerpApi.
- Brak klucza → HTTP 503; przekroczenie limitu → HTTP 429.
- ASIN odpowiedzi inny od żądanego → wynik odrzucony. Brak ASIN w
  odpowiedzi oznacza konieczność ręcznej weryfikacji.
- Nie kopiuj automatycznie cudzych zdjęć i opisów do publikowanych ofert
  bez weryfikacji praw do ich wykorzystania.

## Testy

- tests/asin-lookup.test.mjs: mapowanie, błędy, cache, sekrety i API.
- tests/catalog-asin-accept.test.cjs: potwierdzenie testera, konflikty,
  zapis źródła Amazon i brak zgadywania EAN.
- tests/finder-diagnostics.test.cjs: ASIN/EAN i wybór źródła z Findera.

W testach użyto symulowanego SerpApi. Brak jeszcze prawdziwego klucza
SerpApi podłączonego do stagingu, więc nie twierdzimy, że pobieranie
realnych produktów Amazon zostało przetestowane end-to-end.
