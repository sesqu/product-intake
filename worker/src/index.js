const AAPI = "https://api.allegro.pl";
const AOAUTH = "https://allegro.pl/auth/oauth";

function out(data, status, origin) {
  return new Response(status === 204 ? null : JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
      "access-control-allow-headers": "content-type,x-workspace-key"
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

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function workspaceSecret(request) {
  const key = clean(request.headers.get("x-workspace-key"));
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(key)) {
    throw new Error("Brak lub nieprawidłowy kod synchronizacji");
  }
  return key;
}

async function workspacePrefix(request) {
  return "workspace:" + await sha256Hex(workspaceSecret(request)) + ":";
}

async function cloudProductKey(request, lpn) {
  return (await workspacePrefix(request)) + "product:" + await sha256Hex(norm(lpn));
}

async function workspaceIndexKey(request) {
  return (await workspacePrefix(request)) + "index:v1";
}

function productSummary(record) {
  return {
    id: record.id || "",
    lpn: record.lpn || "",
    ean: record.ean || "",
    asin: record.asin || "",
    productName: record.productName || "",
    brand: record.brand || "",
    model: record.model || "",
    category: record.category || "",
    catalogImage: record.catalogImage || "",
    confidence: Number(record.confidence || 0),
    loc: record.loc || "",
    status: record.status || "",
    savedAt: record.savedAt || "",
    source: record.source || "",
    testRecord: Boolean(record.testRecord)
  };
}

async function readWorkspaceIndex(env, request) {
  const key = await workspaceIndexKey(request);
  const raw = await env.AUTH.get(key, "json").catch(() => null);
  const products = Array.isArray(raw?.products) ? raw.products : [];
  return products
    .filter(p => p && p.lpn)
    .filter(p => !String(p.lpn).startsWith("TEST-SEED-"))
    .sort((a,b) => String(b.savedAt || "").localeCompare(String(a.savedAt || "")));
}

async function writeWorkspaceIndex(env, request, products) {
  const key = await workspaceIndexKey(request);
  const cleanProducts = (products || [])
    .filter(p => p && p.lpn)
    .filter(p => !String(p.lpn).startsWith("TEST-SEED-"))
    .slice(0, 500);
  await env.AUTH.put(key, JSON.stringify({
    updatedAt: new Date().toISOString(),
    products: cleanProducts
  }));
}

async function backfillWorkspaceIndex(env, request) {
  const prefix = (await workspacePrefix(request)) + "product:";
  let cursor;
  const names = [];

  for (let i = 0; i < 20; i++) {
    const page = await env.AUTH.list({ prefix, cursor, limit: 1000 });
    names.push(...(page.keys || []).map(k => k.name));
    if (page.list_complete || !page.cursor) break;
    cursor = page.cursor;
  }

  const products = await Promise.all(
    names.map(name => env.AUTH.get(name, "json").catch(() => null))
  );

  const summaries = products
    .filter(Boolean)
    .filter(p => !String(p?.lpn || "").startsWith("TEST-SEED-"))
    .map(productSummary)
    .sort((a,b) => String(b.savedAt || "").localeCompare(String(a.savedAt || "")));

  await writeWorkspaceIndex(env, request, summaries);
  return summaries;
}

async function listCloudProducts(env, request) {
  const indexed = await readWorkspaceIndex(env, request);
  if (indexed.length) return indexed;
  return backfillWorkspaceIndex(env, request);
}

async function getCloudProduct(env, request, lpn) {
  const cleanLpn = clean(lpn);
  if (!cleanLpn) throw new Error("Brak LPN / SKU");
  const key = await cloudProductKey(request, cleanLpn);
  return env.AUTH.get(key, "json").catch(() => null);
}

async function saveCloudProduct(env, request, input) {
  const product = input && typeof input === "object" ? input : {};
  const lpn = clean(product.lpn);
  if (!lpn) throw new Error("LPN / SKU jest wymagany");

  const key = await cloudProductKey(request, lpn);
  const existing = await env.AUTH.get(key, "json").catch(() => null);
  const now = new Date().toISOString();

  const record = {
    ...(existing || {}),
    ...product,
    id: existing?.id || clean(product.id) || crypto.randomUUID(),
    lpn,
    status: clean(product.status) || "ready",
    savedAt: now,
    cloudUpdatedAt: now
  };

  await env.AUTH.put(key, JSON.stringify(record));

  const current = await readWorkspaceIndex(env, request);
  const next = current.filter(p => norm(p.lpn) !== norm(lpn));
  next.unshift(productSummary(record));
  await writeWorkspaceIndex(env, request, next);

  return { record, created: !existing, updated: Boolean(existing) };
}

async function deleteCloudProduct(env, request, lpn) {
  const cleanLpn = clean(lpn);
  if (!cleanLpn) throw new Error("Brak LPN / SKU");

  const key = await cloudProductKey(request, cleanLpn);
  await env.AUTH.delete(key);

  const current = await readWorkspaceIndex(env, request);
  const next = current.filter(p => norm(p.lpn) !== norm(cleanLpn));
  await writeWorkspaceIndex(env, request, next);
}

async function seedRealWorkspaceProducts(env, request) {
  const eans = ["195949544026", "4548736132580", "6925281994258"];
  const oldTestLpns = ["TEST-SEED-001","TEST-SEED-002","TEST-SEED-003"];

  for (const lpn of oldTestLpns) {
    await deleteCloudProduct(env, request, lpn).catch(() => {});
  }

  const saved = [];

  for (const ean of eans) {
    const products = await allegroSearch(env, ean);
    if (!products.length) throw new Error("Nie znaleziono produktu dla EAN " + ean);

    const ranked = products
      .map(p => ({ ...p, score: scoreProduct(p, ean) }))
      .sort((a,b) => b.score - a.score);

    const best = ranked[0];

    let categoryMeta = null;
    try {
      categoryMeta = await categoryMetadata(env, best.categoryId);
    } catch (e) {
      categoryMeta = { error: e.message, categoryId: best.categoryId || "" };
    }

    const gpsr = summarizeProductSafety(best.productSafety);

    const record = {
      lpn: "REAL-EAN-" + ean,
      ean,
      asin: best.asin || "",
      productName: best.name || "",
      brand: best.brand || "",
      model: best.model || "",
      category: categoryMeta?.categoryName || best.category || "",
      parameters: Array.isArray(best.parameters)
        ? best.parameters.map(p => (p.name || p.key || "") + ": " + (p.value ?? "")).join("\n")
        : "",
      condition: "",
      contents: "TEST katalogowy — bez fizycznej weryfikacji sztuki",
      flaws: "",
      loc: "TEST-LIVE",
      shipping: "",
      weight: "",
      confirm: false,
      identified: true,
      confidence: Number(best.score || 0),
      categoryMeta,
      gpsrData: gpsr,
      photos: [],
      status: "catalog-test",
      source: "Allegro API",
      testRecord: true
    };

    const result = await saveCloudProduct(env, request, record);
    saved.push(result.record);
  }

  return saved;
}

async function storeTokens(env, body) {
  if (!body?.access_token) throw new Error("Brak access_token w odpowiedzi Allegro");

  const expiresAt = Date.now() + Math.max(60, Number(body.expires_in || 43199)) * 1000;
  await env.AUTH.put("allegro:access_token", body.access_token);
  await env.AUTH.put("allegro:expires_at", String(expiresAt));
  if (body.refresh_token) {
    await env.AUTH.put("allegro:refresh_token", body.refresh_token);
  }

  return { accessToken: body.access_token, expiresAt };
}

async function exchangeAuthorizationCode(env, code, codeVerifier) {
  if (!env.ALLEGRO_CLIENT_ID) throw new Error("Brak ALLEGRO_CLIENT_ID");

  const r = await fetch(AOAUTH + "/token", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": env.ALLEGRO_USER_AGENT || "Product-Intake/1.1 (+https://github.com/sesqu/product-intake)"
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: env.ALLEGRO_REDIRECT_URI,
      client_id: env.ALLEGRO_CLIENT_ID,
      code_verifier: codeVerifier
    })
  });

  const body = await r.json().catch(() => ({}));
  if (!r.ok || !body.access_token) {
    throw new Error(body.error_description || body.error || ("OAuth HTTP " + r.status));
  }

  return storeTokens(env, body);
}

async function refreshAccessToken(env, refreshToken) {
  if (!env.ALLEGRO_CLIENT_ID || !env.ALLEGRO_CLIENT_SECRET) {
    throw new Error("Brak konfiguracji Client ID/Secret Allegro");
  }

  const r = await fetch(AOAUTH + "/token", {
    method: "POST",
    headers: {
      authorization: basic(env.ALLEGRO_CLIENT_ID, env.ALLEGRO_CLIENT_SECRET),
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": env.ALLEGRO_USER_AGENT || "Product-Intake/1.1 (+https://github.com/sesqu/product-intake)"
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken
    })
  });

  const body = await r.json().catch(() => ({}));
  if (!r.ok || !body.access_token) {
    throw new Error(body.error_description || body.error || ("OAuth HTTP " + r.status));
  }

  return storeTokens(env, body);
}

async function clearAllegroTokens(env) {
  await Promise.all([
    env.AUTH.delete("allegro:access_token"),
    env.AUTH.delete("allegro:expires_at"),
    env.AUTH.delete("allegro:refresh_token")
  ]);
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

  const t = await refreshAccessToken(env, refresh);
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

function stripHtml(value) {
  return clean(value)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function flattenDescription(description) {
  if (!description) return "";
  if (typeof description === "string") return stripHtml(description);

  const chunks = [];
  for (const section of description.sections || []) {
    for (const item of section.items || []) {
      if (item?.content) chunks.push(stripHtml(item.content));
      if (item?.text) chunks.push(stripHtml(item.text));
    }
  }
  return chunks.filter(Boolean).join("\n\n").slice(0, 12000);
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
    categoryId: p.category?.id || "",
    image: first(p.images)?.url || "",
    description: flattenDescription(p.description),
    productSafety: p.productSafety || null,
    parameters: (p.parameters || []).slice(0, 40).map(x => ({
      name: x.name || x.id || "",
      value: first(x.valuesLabels) || first(x.values) || ""
    }))
  };
}

async function categoryMetadata(env, categoryId) {
  if (!categoryId) return null;

  const token = await userToken(env);
  const headers = {
    authorization: "Bearer " + token,
    accept: "application/vnd.allegro.public.v1+json",
    "accept-language": "pl-PL",
    "user-agent": env.ALLEGRO_USER_AGENT || "Product-Intake/1.1 (+https://github.com/sesqu/product-intake)"
  };

  const [paramsResponse, categoryResponse] = await Promise.all([
    fetch(new URL(AAPI + "/sale/categories/" + encodeURIComponent(categoryId) + "/parameters"), { headers }),
    fetch(new URL(AAPI + "/sale/categories/" + encodeURIComponent(categoryId)), { headers })
  ]);

  const body = await paramsResponse.json().catch(() => ({}));
  const categoryBody = await categoryResponse.json().catch(() => ({}));

  if (!paramsResponse.ok) {
    throw new Error(body?.errors?.[0]?.message || ("Allegro category parameters HTTP " + paramsResponse.status));
  }

  const parameters = Array.isArray(body.parameters) ? body.parameters : [];
  const gtinIds = new Set(["225693", "245669", "245673"]);
  const gtin = parameters.find(p => gtinIds.has(String(p.id)) || ["ean","isbn","issn","gtin"].includes(norm(p.name)));
  const condition = parameters.find(p => String(p.id) === "11323" || norm(p.name) === "stan");

  return {
    categoryId: String(categoryId),
    categoryName: categoryResponse.ok ? (categoryBody.name || "") : "",
    gtin: gtin ? {
      id: String(gtin.id || ""),
      name: gtin.name || "GTIN",
      requiredForProduct: Boolean(gtin.requiredForProduct),
      requiredIf: gtin.requiredIf || null
    } : null,
    condition: condition ? {
      id: String(condition.id || "11323"),
      name: condition.name || "Stan",
      required: Boolean(condition.required),
      values: (condition.dictionary || []).map(v => ({
        id: String(v.id || ""),
        value: clean(v.value)
      })).filter(v => v.value)
    } : null
  };
}

function summarizeProductSafety(productSafety) {
  if (!productSafety) {
    return {
      available: false,
      status: "Brak danych GPSR w katalogu Allegro",
      producers: [],
      safetyInformation: null
    };
  }

  const producers = (productSafety.responsibleProducers || []).map(p => ({
    id: p.id || "",
    name: p.name || "",
    tradeName: p.producerData?.tradeName || "",
    address: p.producerData?.address || null,
    contact: p.producerData?.contact || null
  }));

  return {
    available: Boolean(producers.length || productSafety.safetyInformation),
    status: (producers.length || productSafety.safetyInformation)
      ? "Dane GPSR pobrane z Allegro"
      : "Brak danych GPSR w katalogu Allegro",
    producers,
    safetyInformation: productSafety.safetyInformation || null
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
  const makeRequest = async token => {
    const u = new URL(AAPI + "/sale/products");
    u.searchParams.set("phrase", ean);
    u.searchParams.set("mode", "GTIN");
    u.searchParams.set("language", "pl-PL");

    return fetch(u, {
      headers: {
        authorization: "Bearer " + token,
        accept: "application/vnd.allegro.public.v1+json",
        "accept-language": "pl-PL",
        "user-agent": env.ALLEGRO_USER_AGENT || "Product-Intake/1.1 (+https://github.com/sesqu/product-intake)"
      }
    });
  };

  let token = await userToken(env);
  let r = await makeRequest(token);

  if (r.status === 401) {
    await Promise.all([
      env.AUTH.delete("allegro:access_token"),
      env.AUTH.delete("allegro:expires_at")
    ]);

    const refresh = await env.AUTH.get("allegro:refresh_token");
    if (!refresh) {
      await clearAllegroTokens(env);
      throw new Error("Autoryzacja Allegro wygasła. Połącz konto ponownie.");
    }

    try {
      const refreshed = await refreshAccessToken(env, refresh);
      token = refreshed.accessToken;
      r = await makeRequest(token);
    } catch {
      await clearAllegroTokens(env);
      throw new Error("Autoryzacja Allegro wygasła. Połącz konto ponownie.");
    }
  }

  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(body?.errors?.[0]?.message || ("Allegro API HTTP " + r.status));
  }

  return (body.products || []).map(p => mapProduct(p, ean));
}

function base64Url(bytes) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function createOAuthState(env) {
  const stateBytes = crypto.getRandomValues(new Uint8Array(24));
  const verifierBytes = crypto.getRandomValues(new Uint8Array(64));

  const state = base64Url(stateBytes);
  const codeVerifier = base64Url(verifierBytes);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(codeVerifier)
  );
  const codeChallenge = base64Url(new Uint8Array(digest));

  await env.AUTH.put(
    "allegro:oauth_state:" + state,
    JSON.stringify({ codeVerifier }),
    { expirationTtl: 600 }
  );

  return { state, codeChallenge };
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

  if (url.pathname === "/api/products" && request.method === "GET") {
    try {
      const lpn = clean(url.searchParams.get("lpn"));
      if (lpn) {
        const product = await getCloudProduct(env, request, lpn);
        if (!product) return out({ error: "Produkt nie istnieje" }, 404, origin);
        return out({ ok: true, product }, 200, origin);
      }

      const products = await listCloudProducts(env, request);
      return out({ ok: true, products, count: products.length }, 200, origin);
    } catch (e) {
      return out({ error: e.message }, 401, origin);
    }
  }

  if (url.pathname === "/api/products" && request.method === "POST") {
    try {
      const body = await request.json();
      const result = await saveCloudProduct(env, request, body?.product || body);
      return out({ ok: true, ...result }, result.created ? 201 : 200, origin);
    } catch (e) {
      return out({ error: e.message }, 400, origin);
    }
  }

  if (url.pathname === "/api/products" && request.method === "DELETE") {
    try {
      const lpn = clean(url.searchParams.get("lpn"));
      await deleteCloudProduct(env, request, lpn);
      return out({ ok: true }, 200, origin);
    } catch (e) {
      return out({ error: e.message }, 400, origin);
    }
  }

  if (url.pathname === "/api/products/seed-real" && request.method === "POST") {
    try {
      const products = await seedRealWorkspaceProducts(env, request);
      return out({ ok: true, products, count: products.length }, 200, origin);
    } catch (e) {
      return out({ error: e.message }, 502, origin);
    }
  }

  if (url.pathname === "/api/allegro/auth-url" && request.method === "GET") {
    if (!env.ALLEGRO_CLIENT_ID || !env.ALLEGRO_CLIENT_SECRET || !env.ALLEGRO_REDIRECT_URI) {
      return out({ error: "Brak pełnej konfiguracji Allegro (Client ID / Client Secret / redirect URI)" }, 500, origin);
    }
    const { state, codeChallenge } = await createOAuthState(env);
    const auth = new URL(AOAUTH + "/authorize");
    auth.searchParams.set("response_type", "code");
    auth.searchParams.set("client_id", env.ALLEGRO_CLIENT_ID);
    auth.searchParams.set("redirect_uri", env.ALLEGRO_REDIRECT_URI);
    auth.searchParams.set("state", state);
    auth.searchParams.set("prompt", "confirm");
    auth.searchParams.set("code_challenge_method", "S256");
    auth.searchParams.set("code_challenge", codeChallenge);
    return out({ url: auth.toString() }, 200, origin);
  }

  if (url.pathname === "/api/allegro/callback" && request.method === "GET") {
    const code = clean(url.searchParams.get("code"));
    const state = clean(url.searchParams.get("state"));
    const error = clean(url.searchParams.get("error"));
    const frontend = "https://sesqu.github.io/product-intake/";

    if (error) {
      const target = new URL(frontend);
      target.searchParams.set("allegro", "error");
      target.searchParams.set("reason", error);
      return Response.redirect(target.toString(), 302);
    }

    if (!code || !state) {
      const target = new URL(frontend);
      target.searchParams.set("allegro", "error");
      target.searchParams.set("reason", "missing_code_or_state");
      return Response.redirect(target.toString(), 302);
    }

    const stateKey = "allegro:oauth_state:" + state;
    const saved = await env.AUTH.get(stateKey);
    if (!saved) {
      const target = new URL(frontend);
      target.searchParams.set("allegro", "error");
      target.searchParams.set("reason", "invalid_or_expired_state");
      return Response.redirect(target.toString(), 302);
    }

    let codeVerifier = "";
    try {
      codeVerifier = JSON.parse(saved).codeVerifier || "";
    } catch {}

    await env.AUTH.delete(stateKey);

    if (!codeVerifier) {
      const target = new URL(frontend);
      target.searchParams.set("allegro", "error");
      target.searchParams.set("reason", "missing_code_verifier");
      return Response.redirect(target.toString(), 302);
    }

    try {
      await exchangeAuthorizationCode(env, code, codeVerifier);
      const target = new URL(frontend);
      target.searchParams.set("allegro", "connected");
      return Response.redirect(target.toString(), 302);
    } catch (e) {
      const target = new URL(frontend);
      target.searchParams.set("allegro", "error");
      target.searchParams.set("reason", "token_exchange_failed");
      return Response.redirect(target.toString(), 302);
    }
  }

  if (url.pathname === "/api/allegro/exchange" && request.method === "POST") {
    try {
      const body = await request.json();
      const code = clean(body?.code);
      const state = clean(body?.state);
      if (!code || !state) return out({ error: "Brak code lub state" }, 400, origin);

      const stateKey = "allegro:oauth_state:" + state;
      const saved = await env.AUTH.get(stateKey);
      if (!saved) return out({ error: "Nieprawidłowy lub wygasły state OAuth" }, 400, origin);

      let codeVerifier = "";
      try {
        codeVerifier = JSON.parse(saved).codeVerifier || "";
      } catch {}
      if (!codeVerifier) return out({ error: "Brak code_verifier dla PKCE" }, 400, origin);

      await env.AUTH.delete(stateKey);
      const t = await exchangeAuthorizationCode(env, code, codeVerifier);

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

      let categoryMeta = null;
      try {
        categoryMeta = await categoryMetadata(env, best.categoryId);
      } catch (e) {
        categoryMeta = { error: e.message, categoryId: best.categoryId || "" };
      }

      const gpsr = summarizeProductSafety(best.productSafety);

      return out({
        query: { ean, asin },
        sources: { allegro: best, amazon: null },
        best,
        confidence: best.score,
        confidenceMethod: "allegro-catalog-v1",
        checks: checks(best, ean),
        hardConflicts,
        candidates: ranked.slice(0, 5),
        categoryMeta,
        gpsr
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
