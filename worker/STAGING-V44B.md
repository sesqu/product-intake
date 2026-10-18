# Product Intake v44b — odizolowany staging Allegro MPN

Status: **kod przygotowany, staging nie jest wdrożony**. Dotyczy wyłącznie gałęzi
`feature/model-ranking-v44b-mpn-benchmark`. Nie używać produkcyjnego
`worker/wrangler.jsonc` do tych testów.

## Izolacja

- Worker staging: `product-intake-v44b-staging`; spodziewany adres:
  `https://product-intake-v44b-staging.sesquu.workers.dev`. To adres konfiguracji,
  nie potwierdzenie, że Worker obecnie istnieje.
- KV: **oddzielny** namespace `AUTH`, z odrębnym ID; nie używać produkcyjnego KV.
- OAuth: **nowa aplikacja Allegro**, z własnym Client ID/Secret i redirect URI:
  `https://product-intake-v44b-staging.sesquu.workers.dev/api/allegro/callback`.
  Zarejestrować dokładnie ten URI w panelu dewelopera Allegro.
- API: `x-staging-test-key` dla wszystkich tras `/api/*` poza
  `/api/allegro/callback` (callback weryfikuje `state` oraz PKCE).
- OAuth po autoryzacji wraca na stronę statusu stagingu, nie do produkcyjnego frontendu.
- `/health` musi zwracać `environment: staging` i `appVersion: v44b-staging`.
- Nowe sekrety nie są zapisywane w repozytorium ani w logach.

## Jednorazowa konfiguracja (Cloudflare i Allegro)

1. W Cloudflare utworzyć nową przestrzeń Workers KV, np. `product-intake-v44b-stage-auth`,
   i zanotować jej 32-znakowy identyfikator. Nie importować danych produkcyjnych.
2. W Allegro zarejestrować osobną aplikację OAuth, ze stagingowym redirect URI powyżej.
   Zapisać Client ID i Client Secret poza repozytorium.
3. Utworzyć Cloudflare API Token z uprawnieniami potrzebnymi do wdrożenia
   **tylko testowego Workera** i zapisu jego sekretów (najmniejszy dostęp
   do konta, jaki pozwala wykonać te czynności).
4. W GitHub → repozytorium → Settings → Secrets and variables → Actions,
   utworzyć **sekrety**:
   - `CLOUDFLARE_V44B_DEPLOY_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
   - `V44B_STAGING_ALLEGRO_CLIENT_ID`
   - `V44B_STAGING_ALLEGRO_CLIENT_SECRET`
   - `V44B_STAGING_API_KEY` — losowy klucz o długości co najmniej 20 znaków,
     najlepiej 32+ znaków.
5. W tym samym miejscu dodać **zmienne**:
   - `V44B_STAGING_KV_ID` — nowe ID z kroku 1.
   - `V44B_STAGING_BASE_URL` — `https://product-intake-v44b-staging.sesquu.workers.dev`
   - `V44B_STAGING_DEPLOY_ENABLED` — domyślnie brak / `false`. Ustawić `true`
     **dopiero gdy poprzednie punkty są gotowe**.

Nigdy nie wpisywać Client Secret, API Token, klucza stagingu ani tokenów Allegro
w komentarze PR, rozmowę, plik konfiguracyjny ani jako dane wejściowe workflow.

## Wdrożenie

Workflow `.github/workflows/model-ranking-v44b-deploy-stage.yml`:
- działa tylko dla wskazanej gałęzi i tylko po świadomym włączeniu
  `V44B_STAGING_DEPLOY_ENABLED=true`;
- przed wdrożeniem wymaga wszystkich sekretów i porównuje ID KV i Client ID
  z konfiguracją produkcyjną; na konflikt reaguje błędem;
- tymczasowo dopisuje stagingowe ID KV do konfiguracji w CI (bez commita),
  testuje izolację, wdraża **tylko** staging, ustawia trzy sekrety stagingu
  i sprawdza `/health`.

Workflow ma również wyzwalacz `push` na gałęzi eksperymentalnej dla zmian
konfiguracji stagingu, co pozwala go uruchomić także przed pojawieniem się
`workflow_dispatch` na domyślnej gałęzi. Sama zmiana flagi z `false`
na `true` **nie uruchamia workflow** — wymaga nowego pasującego push,
np. aktualizacji konfiguracji stagingowej. Żaden workflow nie wdraża na `main`.

## Autoryzacja testowej aplikacji Allegro

Po wdrożeniu otworzyć `/health` i upewnić się, że `environment=staging`.

**Najłatwiej z telefonu lub komputera:** otworzyć adres
`https://product-intake-v44b-staging.sesquu.workers.dev/staging/connect`,
wpisać prywatny `V44B_STAGING_API_KEY` w polu hasła i wybrać
**Połącz testowe Allegro**. Formularz wysyła klucz tylko w nagłówku
jednego żądania; nie zapisuje go ani nie dołącza do adresu strony.
Po autoryzacji przeglądarka wróci na stagingową stronę statusu.

Alternatywnie można pobrać URL OAuth prywatnym żądaniem HTTP,
bez ujawniania klucza w logach:

```bash
read -rs V44B_STAGE_KEY
curl --fail-with-body -sS \
  -H "x-staging-test-key: ${V44B_STAGE_KEY}" \
  https://product-intake-v44b-staging.sesquu.workers.dev/api/allegro/auth-url
```

Otworzyć otrzymany URL autoryzacji w przeglądarce i zatwierdzić połączenie
testowej aplikacji Allegro. Callback zapisze tokeny **tylko** w nowym KV.
Sprawdzić, czy `/health` pokazuje `configured=true` i `connected=true`.
Do testu można użyć odrębnego konta Allegro, jeśli dostępne.

## Test MPN z przeglądarki (bez terminala)

Po potwierdzeniu połączenia testowego Allegro otworzyć:

`https://product-intake-v44b-staging.sesquu.workers.dev/staging/probe`

To przyszły adres testowego Workera; będzie dostępny dopiero po wdrożeniu.
Wprowadzić `V44B_STAGING_API_KEY` i użyć przycisku **Sprawdź 8 modeli**.
Ekran sprawdza nazwę wdrożenia i aktywny OAuth zanim wykona zapytania
do katalogu Allegro. Wyświetla wynik każdej próby, liczbę nowych wyników
MPN oraz źródło najlepszego kandydata. Dla każdego produktu tester powinien
wybrać: **Właściwy / Błędny / Brak produktu / Nie wiem**.

Po ocenie kliknąć **Kopiuj raport JSON**. Raport zawiera odpowiedzi i oceny,
ale nie zawiera klucza stagingu ani tokenów Allegro. Nie wklejać raportu do
publicznych issue, jeśli nazwy produktów są poufne. Można zachować go
w prywatnych materiałach testowych.

**Uwaga:** osiem udanych odpowiedzi HTTP nie oznacza ośmiu poprawnych produktów.
Skuteczność powinna być mierzona wyłącznie po sprawdzeniu fizycznej sztuki.

## Nieprodukcyjne kompilacje Cloudflare

Zewnętrzna kontrola GitHub `Workers Builds: product-intake` bywa czerwona
na gałęzi v44b, niezależnie od pomyślnych testów GitHub Actions. Bez logu
w Cloudflare Dashboard nie znamy konkretnej przyczyny.

Cloudflare dokumentuje kompilacje preview dla gałęzi nieprodukcyjnych.
Jeśli dotychczasowy produkcyjny Worker `product-intake` nie powinien
budować eksperymentalnych gałęzi, należy sprawdzić ustawienie:
Cloudflare → Workers & Pages → `product-intake` → Settings → Build →
Branch control → **Enable Preview Builds** i rozważyć jego wyłączenie.
Nie zmienia to logiki naszego oddzielnego staging deploy, lecz jest
ustawieniem produkcyjnego Workera: zmienia je wyłącznie właściciel.
Nie przełączać produkcyjnego branch na gałąź v44b.

Dokumentacja: https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/

## Test MPN na realnym stagingu

Workflow `.github/workflows/model-ranking-v44b-live-mpn.yml` wykorzystuje
`V44B_STAGING_BASE_URL` i sekret `V44B_STAGING_API_KEY`.
Test `tests/model-ranking-v44b-live-mpn.mjs` najpierw sprawdza środowisko,
aktywne OAuth i odrzucenie niezalogowanego żądania. Następnie odpytuje
osiem przypadków problematycznych, weryfikuje wykorzystanie `mode=MPN`
i limit trzech prób oraz raportuje kandydatów. **Nie twierdzi**, że nazwa
kandydata sama dowodzi poprawnego modelu. Analiza wyników przez człowieka
nadal jest konieczna.

Przed włączeniem stagingu standardowy zestaw testów uruchamia
`tests/staging-isolation.test.mjs`. Produkcyjna aplikacja i `main`
pozostają bez zmian.
