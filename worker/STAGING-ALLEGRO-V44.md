# Realny test wyszukiwania Allegro v44 — izolowany staging

Wersja publiczna Product Intake nadal używa starego Workera. Ten plan
tworzy **oddzielny**:
- Worker: `product-intake-v44-search-staging.sesquu.workers.dev`;
- KV `AUTH`, ze świeżym identyfikatorem **innym niż produkcyjny**;
- aplikację OAuth Allegro z przekierowaniem na nowy Worker;
- 32+ znakowy klucz `V44_STAGE_KEY`.

Nie klonujemy tokenów ani produktów z działającego Workera.

## Konfiguracja po stronie właściciela konta

1. Cloudflare Dashboard → Storage & databases → KV → **Create namespace**.
   Skopiuj nowy identyfikator namespace, ale nie używaj istniejącego KV.
2. Panel Allegro Developer → nowa aplikacja OAuth dla stagingu;
   Callback/Redirect URI:
   `https://product-intake-v44-search-staging.sesquu.workers.dev/api/allegro/callback`.
   Nie używaj istniejącego produkcyjnego Client ID.
3. GitHub repo `sesqu/product-intake` → Settings → Secrets and variables →
   Actions, dodaj **secrets**:
   - `V44_STAGE_CF_API_TOKEN`: Cloudflare API token o minimalnych
     uprawnieniach do oddzielnego Workera/KV;
   - `V44_STAGE_CF_ACCOUNT_ID`;
   - `V44_STAGE_KV_ID`: nowy namespace;
   - `V44_STAGE_ALLEGRO_CLIENT_ID`;
   - `V44_STAGE_ALLEGRO_CLIENT_SECRET`;
   - `V44_STAGE_KEY`: osobny wygenerowany klucz, minimum 32 znaki.
4. GitHub Settings → Variables dodaj `V44_STAGE_DEPLOY_ENABLED=true`.
   To świadomie odblokuje workflow z gałęzi eksperymentalnej.
5. GitHub Actions → *Deploy isolated Allegro v44 search staging*:
   uruchom workflow (na właściwej gałęzi) lub pozwól na automatyczne
   uruchomienie po kolejnym push.
6. Workflow odrzuca produkcyjny adres Workera, produkcyjny identyfikator
   KV i produkcyjny Client ID. Po wdrożeniu zapisz testowe sekrety Workera
   `ALLEGRO_CLIENT_SECRET` i `V44_STAGE_KEY` (workflow robi to automatycznie).
7. Otwórz stagingowy `/api/allegro/auth-url`, wysyłając `x-v44-stage-key`
   w nagłówku prywatnego żądania, i przejdź przez OAuth w przeglądarce.
   Pamiętaj: adres `/api/allegro/auth-url` wymaga klucza — sam link bez
   nagłówka nie działa. Nie wklejaj sekretów w publiczne issue ani czat.
8. Po połączeniu testowego Allegro uruchom `tests/allegro-v44-stage-live.mjs`
   z prywatnym `V44_STAGE_KEY`. Test dotyczy 10 modeli, sprawdza HTTP,
   TOP3, źródła i limit trzech prób. Nadal wymagana jest **ręczna ocena
   fizycznej poprawności każdego wyniku**, nie tylko kod HTTP 200.

Workflow jest obecnie **skipped**, dopóki właściciel nie włączy zmiennej
i nie skonfiguruje oddzielnego OAuth/KV. Nie oznacza to nieudanego testu.
Nie wolno publikować v44 tylko dlatego, że jednostkowe testy CI są zielone.

## Co mierzymy

Użyjemy tych samych modeli dla v43 i v44 i ocenimy ręcznie:
TOP1 właściwy produkt, TOP3 właściwy produkt, akcesoria zamiast pełnego
urządzenia, mylenie marek i wariantów, brak produktu, ręczna decyzja
testera, czas odpowiedzi oraz liczba wywołań Allegro. Odrębnie liczymy
niebezpieczne dopasowania z wysokim poziomem pewności.

Cel: zmniejszyć liczbę ręcznych poszukiwań oraz ryzyko złego modelu.
**Nie zakładamy z góry procentowej skuteczności**.
