# Product Intake v44 — wyłącznie jakość wyszukiwania Allegro

Ta gałąź pochodzi bezpośrednio z `main` (publicznego v43).
**Nie zawiera nowej integracji ASIN ani SerpApi**, nie wymaga nowego źródła danych.

## Zmiany w katalogu Allegro

- Wyszukiwanie `GET /sale/products` po frazie i precyzyjnym `mode=MPN`.
- Złożone frazy użytkownika są przetwarzane przed próbą MPN: z
  `Samsung Galaxy S24 SM-S921B 256GB` do `SM-S921B`, z
  `Bosch GSR 18V-55` do `GSR 18V-55`.
- Numer pojemności `256GB` nie jest traktowany jako MPN.
- Obsługa drugiej strony wyników za pomocą `page.id`. Jeżeli pierwsze
  wyniki to części i akcesoria, a nie ma wiarygodnego produktu głównego,
  można zużyć pozostały budżet na kolejną stronę MPN (lub frazy).
- Priorytet drugiej strony dokładnego MPN przed mniej obiecującym powtórzeniem
  krótszej frazy, szczególnie przy wypełnionych polach marka + model.
- Maksymalnie **trzy żądania** Allegro na pojedyncze wyszukiwanie.
  Nie gwarantuje to znalezienia produktu, którego brakuje w katalogu.
- Ranking rozróżnia kompletny sprzęt, części, zamienniki, atrapy i zestawy;
  podobny, lecz błędny wariant nie jest równoznaczny z dokładnym MPN.
- Serwer zwraca do 12 kandydatów. Finder na początku pokazuje pięciu,
  a kolejnych siedmiu po rozwinięciu.
- Szczegóły wyszukiwania podają tryb, stronę i liczbę nowych kandydatów.
  Porównanie fraza vs MPN jest liczone bez dodatkowych wywołań API.

## Dlaczego nie dopisujemy zawsze „telefon”?

Read-only testy przeciw obecnie działającemu API Allegro v43
(18 października 2026) pokazały, że:

- `SM-S921B` zwraca części do telefonu;
- `telefon SM-S921B` także zwraca część (taśmę);
- `smartfon Samsung SM-S921B` może nie zwrócić niczego;
- `Samsung Galaxy S24 smartfon` potrafi znaleźć prawdziwy telefon,
  ale również atrapę wystawową, którą ranking musi odrzucić;
- `Makita DHP484 wiertarko-wkrętarka` znalazła urządzenie,
  gdy sam `DHP484` zwrócił błędnie opisanego Boscha;
- `Roborock S8 MaxV Ultra robot odkurzający` znalazł robot,
  gdy sam model zwrócił mopy.

Wniosek: nie istnieje jedna magiczna kolejność słów. Stosujemy
**adaptacyjne odzyskiwanie wyników**: oryginalna fraza, dokładny
MPN, a potem odpowiednio dobrana trzecia próba. Gdy lista wskazuje
wiarygodny powtarzalny alias rodziny i rodzaj sprzętu, można
spróbować np. `Samsung Galaxy S24 smartfon`; w przeciwnym razie
sprawdzamy następną stronę MPN. Nie przekraczamy trzech prób.
Fraza służy do znalezienia kandydatów; punktowanie zawsze opiera
się na wyodrębnionym kodzie `SM-S921B`, nie na całym „telefon SM-S921B”.

Pełne logi aktualnej publicznej wersji API:
https://github.com/sesqu/product-intake/actions/runs/39131354189
i https://github.com/sesqu/product-intake/actions/runs/39131571533

**Uwaga:** to testy rzeczywistego starego API v43. Nowe odgałęzienie
v44 było testowane z symulowanymi wynikami i offline na zapisanej
próbce rzeczywistych kandydatów. Nie ma jeszcze end-to-end live
nowego Workera.

## Zabezpieczenia testera

Wybór kandydata zawsze jest jawny; ranking nie potwierdza rzeczywistej sztuki.
Jeżeli kandydat znika między wyświetleniem listy a próbą zapisania do mastera,
backend odpowiada HTTP 409. **Nigdy** nie zastępuje takiego ID bieżącym TOP1.
Potwierdzenie właściwego modelu, MPN, wariantu i zestawu należy do testera.

## Wdrożenie

To *release candidate* na gałęzi `feature/allegro-search-quality-v44`.
Publiczny `main` i produkcyjny Worker nie zostały zmienione.

Interfejs jest przygotowany jako v44 (wersja, linki zasobów i cache PWA),
ale **nie został opublikowany**, więc użytkownik wciąż widzi dotychczasowe
v43, dopóki zmiany nie zostaną sprawdzone na rzeczywistym koncie Allegro
i świadomie wdrożone.

## Testy

- `node tests/product-research.test.mjs`
- `node tests/allegro-pagination.test.mjs`
- `node tests/research-ranking-v3.test.mjs`
- `node tests/allegro-api-v44.test.mjs`
- `node tests/finder-allegro-v44.test.cjs`
- `node tests/frontend-syntax.test.cjs`

Są to testy z symulowanymi wynikami Allegro, a nie dowód poprawnej
skuteczności w katalogu live. Po wdrożeniu stagingu warto wykonać test na
rzeczywistych modelach fizycznych i prowadzić historię ręcznych decyzji.
