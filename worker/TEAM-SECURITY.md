# Product Intake — konta i bezpieczna praca zespołu (projekt v1)

**Stan:** oddzielny szkic backendu na gałęzi
`feature/team-workspace-security-v1`, **nie jest wdrożony**. Nie wolno
włączać go w publicznej aplikacji przed ukończeniem frontendu i migracji.

## Wnioski z audytu aktualnego rozwiązania

1. `cloud-products.js` zapisuje jeden `x-workspace-key` w localStorage.
   Kto ma ten kod, ma dostęp do całego obszaru. Nie wiadomo, *który*
   pracownik faktycznie wykonał operację ani jak mu odebrać dostęp bez
   wymiany kodu dla pozostałych.
2. `worker/src/index.js` zapisuje produkty i ich indeks w Workers KV.
   Dwa równoczesne zapisy mogą nadpisać zmianę drugiej osoby;
   indeks może też pominąć zapis z równoległego żądania. KV nie
   udostępnia transakcyjnego `WHERE revision = ?`.
3. Aplikacja równolegle zapisuje dane w localStorage. Po uruchomieniu
   wielu kont **nie można** bezrefleksyjnie synchronizować lokalnych
   kopii metodą „ostatni czas zapisu wygrywa”.
4. Testowe produkty i załączniki lokalne nie mogą zostać po cichu
   wymieszane z danymi firmowymi różnych testerów. Potrzebna jest
   jawna migracja, rozdzielenie kopii zapasowych i praw dostępu.
5. Zmiana tylko interfejsu logowania **nie naprawia** tych problemów.

## Przygotowany bezpieczny backend (D1 + Cloudflare Access)

- **Tożsamość:** każda osoba loguje się własnym kontem w Cloudflare Access
  (np. kod jednorazowy na mail). Worker **weryfikuje podpis RS256 JWT**,
  issuer, audience, czas wygaśnięcia i tożsamość. Sam nagłówek e-mail
  czy wspólny kod synchronizacji nie dają dostępu.
- **Konto właściciela:** adres jest konfigurowany jako
  `TEAM_OWNER_EMAIL`. Przy pierwszym podpisanym logowaniu dostaje
  rolę `owner`. Nikt inny nie może utworzyć swojego konta owner.
- **Zaproszenia:** owner dodaje pracowników po e-mailu i ustala rolę.
  E-mail musi także należeć do zasad dostępu Cloudflare Access.
  Można pracownika wyłączyć bez zmieniania pozostałych haseł.
- **Role:** owner zarządza kontami; manager/tester mogą pracować na
  produktach, viewer tylko czyta.
- **Blokada edycji:** osoba zaczynająca pracę przejmuje produkt na
  dziesięć minut. Odnawia blokadę podczas pracy. Druga osoba widzi
  zajętość i nie może w tym czasie zapisać zmian (423).
- **Wersje:** każda treściowa modyfikacja podnosi `revision`.
  Serwer zapisuje zmiany atomowo tylko z właściwym `expectedRevision`.
  Stary zapis dostaje **409 Conflict** i musi pobrać nowszą wersję.
- **Historia:** transakcyjne wyzwalacze D1 tworzą ślad zapisów, blokad,
  zaproszeń oraz zmian uprawnień. Przejęcie blokady nie zmienia pola
  „ostatnia osoba edytująca treść”.
- **Izolacja:** gdy `TEAM_MODE=1`, stare `/api/products` i inne
  `/api/*` nie omijają sprawdzania kont. Wyłącznie `/api/team/*`
  dopuszcza operacje; obecny publiczny Worker nie uruchamia Team Mode.

Źródła: `worker/src/team-auth.js`, `worker/src/team-api.js`,
`worker/migrations/0001_team_workspace.sql`.

## Co MUSI powstać przed rozpoczęciem pracy zespołu

1. **Osobny Worker i D1** tylko dla zespołu; osobna aplikacja
   Cloudflare Access. Nie wdrażać przez produkcyjny plik
   `wrangler.jsonc` i nie podłączać istniejącego produkcyjnego KV.
2. **Frontend tej samej aplikacji** serwowany pod domeną chronioną
   przez Access, najlepiej z API na tym samym origin (ważne dla
   cookies w Safari/iPhone). Wskazanie zalogowanego użytkownika
   i roli, wylogowanie w Access, zarządzanie zaproszeniami przez ownera.
3. **Integracja listy i edytora** z D1: otwarcie produktu wymaga
   `claim`, odnowienie blokady, badge „edytuje …”, uwolnienie
   przy wyjściu; przed zapisem wysyłamy `expectedRevision`.
4. **Ekran konfliktu 409**: pokaż dwie wersje obok siebie,
   zachowaj niezapisany formularz, pozwól ręcznie scalić pola.
   Nigdy automatycznie nie nadpisuj cudzego zapisu.
5. **Przypisanie zadań i lista „Do przyjęcia / W trakcie /
   Do kontroli / Gotowe”** z wyraźnym właścicielem zadania;
   możliwość przejęcia przez kierownika z uzasadnieniem i audytem.
   Rozdziel przypisanie zadania od dziesięciominutowej blokady edycji.
6. **LPN unikalne globalnie** w przestrzeni firmy; drugi tester
   skanujący to samo LPN powinien otworzyć istniejący produkt,
   a nie utworzyć duplikat.
7. **Autosave i brak sieci:** zmiany w trwającym formularzu
   zachować lokalnie z przypisaniem do zalogowanej osoby, ale
   nie wykonywać cichej synchronizacji/merge po powrocie internetu.
   Przy konflikcie zapytać użytkownika. Trwałe zdjęcia w R2,
   nie jedynie URL blob i localStorage.
8. **Migracja ze starego KV:** eksport z pełnym backupem, mapowanie
   firmowego workspace, kontrola duplikatów LPN, testowa migracja do
   D1, porównanie liczby produktów, dopiero potem ręczne przełączenie.
   Nie udostępniaj współdzielonego klucza ani tokenów w czacie.
9. **Backup/restore, retencja i RODO:** D1 backup, wersjonowanie,
   rejestrowanie usunięć, ograniczenia dostępu do danych pracowników,
   polityka zdjęć i czytelny proces wyłączenia konta.
10. **Testy akceptacyjne:** dwie osoby edytują ten sam produkt,
    dwie nowe sztuki jednocześnie, zerwane połączenie podczas autosave,
    wygasła blokada, konflikt 409 i ponowienie, wyłączone konto,
    uprawnienia viewer, odtworzenie backupu oraz iPhone/iPad/PC.

## Minimalny kontrakt API backendu

- `GET /api/team/me` — podpisana tożsamość i rola.
- `GET/POST/PATCH /api/team/members` — zarządzanie pracownikami (owner).
- `GET /api/team/members/history` — audyt kont (owner).
- `GET /api/team/products` — lista.
- `GET /api/team/products/:lpn` — bieżąca sztuka i wersja.
- `POST /api/team/products/:lpn/claim` — przejmij / odśwież blokadę.
- `POST /api/team/products/:lpn/release` — zwolnij blokadę.
- `PUT /api/team/products/:lpn` — wymagany `expectedRevision`.
- `GET /api/team/products/:lpn/history` — historia zdarzeń.

## Granica gotowości

Backend i testy nie oznaczają gotowego systemu wielu użytkowników.
**Nie wolno publikować ani migrować danych**, dopóki nie ma frontendu
kont, obsługi 409/423 w edytorze, zabezpieczonej domeny Access,
procedury migracji i backupu oraz testu równoczesnej pracy fizycznych
użytkowników. Publiczne `main` i istniejąca synchronizacja pozostają
bez zmian.
