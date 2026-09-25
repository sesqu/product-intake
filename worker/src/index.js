const AAPI = "https://api.allegro.pl";
const AOAUTH = "https://allegro.pl/auth/oauth";

function out(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type"
    }
  });
}

function originFor(request, env) {
  const incoming = request.headers.get("origin") || "";
  const allowed = env.ALLOWED_ORIGIN || "https://sesqu.github.io";
  return incoming === allowed ? incoming : allowed;
}

const clean = v => String(v ?? "").trim();
const norm = v => clean(v).toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const first = a => Array.isArray(a) && a.length ? a[0] : null;

function basic(clientId, secret) {
  return "Basic " + btoa(clientId + ":" + secret);
}

async function exchange(env, params) {
  if (!env.ALLEGRO_CLIENT_ID || !env.ALLEGRO_CLIENT_SECRET) {
    throw new Error("Brak konfiguracji Allegro");
  }

  const r = await fetch(AOAUTH + "/token", {
    method: "POST",
    headers: {
      authorization: basic(env.ALLEGRO_CLIENT_ID, env.ALLEGRO_CLIENT_SECRET),
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams(params)
  });

  const body = await r.json().catch(() => ({}));
  if (!r.ok || !body.access_token) {
    throw new Error(body.error_description || body.error || ("OAuth HTTP " + r.status));
  }

  const expiresAt = Date.now() + Math.max(60, Number(body.expires_in || 43199)) * 1000;
  await env.AUTH.put("allegro:access_token", body.access_token);
  await env.AUTH.put("allegro:expires_at", String(expiresAt));
  if (body.refresh_token) await env.AUTH.put("allegro:refresh_token", body.refresh_token);

  return { accessToken: body.access_token, expiresAt };
}

async function userToken(env) {
  const [access, expiresRaw] = await Promise.all([
    env.AUTH.get("allegro:access_token"),
    env.AUTH.get("allegro:expires_at")
  ]);

  const expiresAt = Number(expiresRaw || 0);
  if (access && expiresAt > Date.now() + 120000) return access;

  const refresh = await env.AUTH.get("allegro:refresh_token");
  if (!refresh) throw new Error("Konto Allegro nie jest połączone");

  const t = await exchange(env, {
    grant_type: "refresh_token",
    refresh_token: refresh
  });
  return t.accessToken;
}

function pvalue(product, names) {
  const wanted = names.map(norm);
  for (const p of product?.parameters || []) {
    if (!wanted.includes(norm(p.name))) continue;
    const values = p.valuesLabels || p.values || [];
    if (Array.isArray(values) && values.length) return clean(values[0]);
  }
  return "";
}

function mapProduct(p, ean) {
  if (!p) return null;
  return {
    source: "allegro",
    status: "znaleziono",
    id: p.id || "",
    name: p.name || "",
    ean: pvalue(p, ["EAN", "GTIN"]) || ean || "",
    asin: "",
    brand: pvalue(p, ["Marka", "Brand"]),
    model: pvalue(p, ["Model", "Kod producenta", "Manufacturer code", "MPN"]),
    category: p.category?.name || p.category?.id || "",
    image: first(p.images)?.url || "",
    parameters: (p.parameters || []).slice(0, 40).map(x => ({
      name: x.name || x.id || "",
      value: first(x.valuesLabels) || first(x.values) || ""
    }))
  };
}

function scoreProduct(p, queryEan) {
  let score = 0;
  if (p.ean && norm(p.ean) === norm(queryEan)) score += 60;
  if (p.brand) score += 10;
  if (p.model) score += 15;
  if (p.name) score += 10;
  if (p.category) score += 5;
  return Math.min(100, score);
}

function checks(p, queryEan) {
  return [
    {
      label: "EAN",
      value: p.ean || queryEan || "brak",
      status: p.ean && norm(p.ean) === norm(queryEan) ? "ok" : "warn",
      text: p.ean && norm(p.ean) === norm(queryEan) ? "zgodny" : "sprawdź"
    },
    {
      label: "Marka",
      value: p.brand || "brak",
      status: p.brand ? "ok" : "warn",
      text: p.brand ? "znaleziona" : "brak"
    },
    {
      label: "Model",
      value: p.model || "brak",
      status: p.model ? "ok" : "warn",
      text: p.model ? "znaleziony" : "brak"
    },
    {
      label: "Kategoria",
      value: p.category || "brak",
      status: p.category ? "ok" : "warn",
      text: p.category ? "znaleziona" : "brak"
    }
  ];
}

async function allegroSearch(env, ean) {
  const token = await userToken(env);
  const u = new URL(AAPI + "/sale/products");
  u.searchParams.set("phrase", ean);
  u.searchParams.set("mode", "GTIN");
  u.searchParams.set("language", "pl-PL");

  const r = await fetch(u, {
    headers: {
      authorization: "Bearer " + token,
      accept: "application/vnd.allegro.public.v1+json",
      "accept-language": "pl-PL"
    }
  });

  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(body?.errors?.[0]?.message || ("Allegro API HTTP " + r.status));
  }

  return (body.products || []).map(p => mapProduct(p, ean));
}

async function randomState(env) {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const state = [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
  await env.AUTH.put("allegro:oauth_state:" + state, "1", { expirationTtl: 600 });
  return state;
}

async function handle(request, env) {
  const origin = originFor(request, env);
  if (request.method === "OPTIONS") return out({ ok: true }, 204, origin);

  const url = new URL(request.url);

  if (url.pathname === "/health") {
    return out({
      status: "ok",
      service: "product-intake-api",
      allegro: {
        configured: Boolean(env.ALLEGRO_CLIENT_ID && env.ALLEGRO_CLIENT_SECRET && env.ALLEGRO_REDIRECT_URI),
        connected: Boolean(await env.AUTH.get("allegro:refresh_token"))
      }
    }, 200, origin);
  }

  if (url.pathname === "/api/allegro/auth-url" && request.method === "GET") {
    if (!env.ALLEGRO_CLIENT_ID || !env.ALLEGRO_REDIRECT_URI) {
      return out({ error: "Brak konfiguracji Allegro" }, 500, origin);
    }
    const state = await randomState(env);
    const auth = new URL(AOAUTH + "/authorize");
    auth.searchParams.set("response_type", "code");
    auth.searchParams.set("client_id", env.ALLEGRO_CLIENT_ID);
    auth.searchParams.set("redirect_uri", env.ALLEGRO_REDIRECT_URI);
    auth.searchParams.set("state", state);
    return out({ url: auth.toString() }, 200, origin);
  }

  if (url.pathname === "/api/allegro/exchange" && request.method === "POST") {
    try {
      const body = await request.json();
      const code = clean(body?.code);
      const state = clean(body?.state);
      if (!code || !state) return out({ error: "Brak code lub state" }, 400, origin);

      const stateKey = "allegro:oauth_state:" + state;
      const valid = await env.AUTH.get(stateKey);
      if (!valid) return out({ error: "Nieprawidłowy lub wygasły state OAuth" }, 400, origin);
      await env.AUTH.delete(stateKey);

      const t = await exchange(env, {
        grant_type: "authorization_code",
        code,
        redirect_uri: env.ALLEGRO_REDIRECT_URI
      });

      return out({ ok: true, connected: true, expiresAt: t.expiresAt }, 200, origin);
    } catch (e) {
      return out({ error: e.message }, 502, origin);
    }
  }

  if (url.pathname === "/api/allegro/status" && request.method === "GET") {
    return out({
      configured: Boolean(env.ALLEGRO_CLIENT_ID && env.ALLEGRO_CLIENT_SECRET && env.ALLEGRO_REDIRECT_URI),
      connected: Boolean(await env.AUTH.get("allegro:refresh_token"))
    }, 200, origin);
  }

  if (url.pathname === "/api/search" && request.method === "GET") {
    const ean = clean(url.searchParams.get("ean"));
    const asin = clean(url.searchParams.get("asin")).toUpperCase();

    if (!ean && asin) {
      return out({ error: "Amazon nie jest jeszcze podłączony. Na razie wyszukujemy EAN w Allegro." }, 501, origin);
    }
    if (!ean) return out({ error: "Podaj EAN" }, 400, origin);

    try {
      const products = await allegroSearch(env, ean);
      if (!products.length) {
        return out({
          query: { ean, asin },
          sources: { allegro: null, amazon: null },
          best: null,
          confidence: 0,
          checks: [],
          hardConflicts: [],
          candidates: []
        }, 200, origin);
      }

      const ranked = products
        .map(p => ({ ...p, score: scoreProduct(p, ean) }))
        .sort((a, b) => b.score - a.score);

      const best = ranked[0];
      const hardConflicts = best.ean && norm(best.ean) !== norm(ean) ? ["EAN"] : [];

      return out({
        query: { ean, asin },
        sources: { allegro: best, amazon: null },
        best,
        confidence: best.score,
        checks: checks(best, ean),
        hardConflicts,
        candidates: ranked.slice(0, 5)
      }, 200, origin);
    } catch (e) {
      return out({ error: e.message }, 502, origin);
    }
  }

  return out({ error: "Not found" }, 404, origin);
}

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch (e) {
      return out({ error: e?.message || "Internal error" }, 500, originFor(request, env));
    }
  }
};
