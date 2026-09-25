# Product Intake API

Backend trzyma sekrety do Allegro i Amazon poza przeglądarką.

## Endpointy
- `GET /health`
- `GET /api/search?ean=...`
- `GET /api/search?asin=...`
- można podać oba identyfikatory naraz.

## Uruchomienie lokalne
1. Node.js 20+
2. `npm install`
3. skopiuj `.env.example` do zmiennych środowiskowych hostingu
4. `npm start`

## Bezpieczeństwo
Nie wpisuj client secretów, refresh tokenów ani innych sekretów do frontendu ani do publicznego repo. Ustawiamy je wyłącznie jako zmienne środowiskowe na serwerze.

## Allegro
Backend używa OAuth client_credentials, a następnie `GET /sale/products` do wyszukiwania po GTIN/EAN.

## Amazon
Backend pobiera LWA access token z refresh tokena i korzysta z Catalog Items API 2022-04-01 po EAN albo ASIN.
