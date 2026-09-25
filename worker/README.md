# Product Intake Worker

Backend Cloudflare Workers dla aplikacji Product Intake.

[Deploy to Cloudflare](https://deploy.workers.cloudflare.com/?url=https://github.com/sesqu/product-intake/tree/main/worker)

## Aktualny zakres
- OAuth użytkownika Allegro
- bezpieczne przechowywanie refresh/access tokenów w Workers KV
- wyszukiwanie produktu po EAN/GTIN w katalogu Allegro
- CORS ograniczony do https://sesqu.github.io
- endpoint zdrowia i statusu integracji
- przygotowanie frontendu do późniejszego dołączenia Amazon SP-API

## Sekret
Podczas wdrożenia ustaw:
`ALLEGRO_CLIENT_SECRET`

Nie zapisuj sekretu w repozytorium.

## Endpointy
- `GET /health`
- `GET /api/allegro/auth-url`
- `POST /api/allegro/exchange`
- `GET /api/allegro/status`
- `GET /api/search?ean=...`
