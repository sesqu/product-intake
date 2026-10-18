// Amazon ASIN research via SerpApi's free-tier Amazon Product API.
// Secret is stored only as a Cloudflare Worker secret: SERPAPI_API_KEY.
// No Amazon HTML scraping and no fallback that silently spends extra credits.

const ALLOWED_DOMAINS = new Set(['amazon.pl','amazon.de','amazon.com']);
const clean = value => String(value ?? '').trim();
const safeText = (value,max=500) => clean(value).slice(0,max);

export function validateAsin(value){
  const asin=clean(value).toUpperCase();
  if(!/^[A-Z0-9]{10}$/.test(asin)) throw new Error('ASIN musi mieć dokładnie 10 znaków: litery A–Z lub cyfry 0–9.');
  return asin;
}
export function validateAmazonDomain(value='amazon.pl'){
  const domain=clean(value)||'amazon.pl';
  if(!ALLOWED_DOMAINS.has(domain)) throw new Error('Obsługiwane sklepy: amazon.pl, amazon.de, amazon.com.');
  return domain;
}
function specValue(data,keys){
  const source=data && typeof data==='object' && !Array.isArray(data) ? data:{};
  for(const key of keys) {
    const val=source[key];
    if(typeof val==='string' && val.trim()) return safeText(val,200);
  }
  return '';
}
function detailRows(data){
  if(!data || typeof data!=='object' || Array.isArray(data)) return [];
  return Object.entries(data).filter(([k,v])=>/^[a-zA-Z0-9_ ]+$/.test(k) && (typeof v==='string'||typeof v==='number'))
    .slice(0,28).map(([name,value])=>({
      name:safeText(name.replace(/_/g,' '),70),
      value:safeText(value,250),
      isTrusted:false
    })).filter(x=>x.name && x.value);
}
function validImage(url){
  try {
    const parsed=new URL(url);
    return parsed.protocol==='https:' && parsed.username==='' && parsed.password==='' ? parsed.href:'';
  }catch {return '';}
}
function removeBrandPrefix(name){
  return clean(name).replace(/^(brand|marka|producent)\s*:\s*/i,'').trim();
}

export function mapSerpApiAsinResponse(body,asin,domain){
  const record=body?.product_results || null;
  if(!record || !safeText(record.title,400)){
    return {product:null,reason:'Brak karty produktu o podanym ASIN w wybranym sklepie.'};
  }
  const reported=safeText(record.asin || body?.product_details?.asin).toUpperCase();
  if(reported && reported!==asin) {
    return {product:null,reason:'Źródło zwróciło inny ASIN ('+reported+'). Nie wybieram niewłaściwego wariantu.'};
  }
  const specifications=body?.item_specifications || {};
  const details=body?.product_details || {};
  const brand=removeBrandPrefix(
    safeText(record.brand,120) ||
    specValue(specifications,['brand','marka']) ||
    specValue(details,['brand','manufacturer','producent'])
  );
  const manufacturer=specValue(details,['manufacturer','producent']) || brand;
  const model=specValue(specifications,['model','model_number','item_model_number','model_name']) ||
    specValue(details,['item_model_number','model_number','model']);
  const mpn=specValue(specifications,['manufacturer_part_number','part_number','mpn','kod_producenta']) ||
    specValue(details,['manufacturer_part_number','part_number','mpn']);
  const images=[record.thumbnail,...(Array.isArray(record.thumbnails)?record.thumbnails:[])].map(validImage).filter(Boolean);
  const uniqueImages=[...new Set(images)].slice(0,8);
  const parameters=[...detailRows(specifications),...detailRows(details)]
    .filter((x,i,list)=>list.findIndex(y=>y.name+'|'+y.value===x.name+'|'+x.value)===i)
    .slice(0,45);
  const categories=Array.isArray(record.categories)?record.categories:[];
  const category=safeText(categories[categories.length-1]?.name,120);
  const observedLink='https://www.'+domain+'/dp/'+asin;
  const product={
    id:asin,
    asin,
    name:safeText(record.title,400),
    brand,
    manufacturer,
    model,
    mpn,
    ean:'', // Never infer EAN from an Amazon ASIN or UPC.
    category,
    image:uniqueImages[0]||'',
    images:uniqueImages,
    parameters,
    description:safeText(record.description,1500),
    source:'amazon',
    provider:'serpapi-amazon-product',
    url:observedLink,
    asinMatched:reported===asin,
    score:null,
    trust:{brand:false,model:false,mpn:false},
    warnings:reported
      ? []
      : [{message:'SerpApi nie zwróciło identyfikatora ASIN w szczegółach. Sprawdź wariant bezpośrednio na Amazon.'}]
  };
  return {product,reason:null};
}


// Best-effort rate guard for the 250-search free plan. KV is eventually
// consistent, so this is a safety net (not an atomic billing guarantee).
async function reserveLookupCredit(kv,clientIp){
  if(!kv || typeof kv.get!=='function' || typeof kv.put!=='function'){
    const error=new Error('Magazyn limitu ASIN jest niedostępny. Wyszukiwanie zostało wstrzymane.');
    error.status=503;throw error;
  }
  const month=new Date().toISOString().slice(0,7);
  const day=new Date().toISOString().slice(0,10);
  const monthly='asin:serpapi:quota:month:'+month;
  const hashed=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(clientIp||'anonymous')));
  const identity=Array.from(new Uint8Array(hashed)).slice(0,12)
    .map(x=>x.toString(16).padStart(2,'0')).join('');
  const daily='asin:serpapi:quota:day:'+day+':'+identity;
  let monthCount,dayCount;
  try{
    [monthCount,dayCount]=await Promise.all([kv.get(monthly),kv.get(daily)]);
  }catch{
    const error=new Error('Nie udało się sprawdzić limitu bezpłatnych wyszukiwań.');
    error.status=503;throw error;
  }
  if(Number(monthCount||0)>=200) {
    const error=new Error('Wyczerpano miesięczny limit bezpieczeństwa ASIN (200 zapytań). Pozostałe zapytania SerpApi są chronione.');
    error.status=429;throw error;
  }
  if(Number(dayCount||0)>=20) {
    const error=new Error('Wykorzystano dzienny limit ASIN dla tego połączenia (20 zapytań).');
    error.status=429;throw error;
  }
  try{
    await Promise.all([
      kv.put(monthly,String(Number(monthCount||0)+1),{expirationTtl:40*86400}),
      kv.put(daily,String(Number(dayCount||0)+1),{expirationTtl:2*86400})
    ]);
  }catch{
    const error=new Error('Nie udało się zarezerwować zapytania SerpApi.');
    error.status=503;throw error;
  }
}

export async function lookupAsinWithSerpApi({asin,domain='amazon.pl',apiKey,kv,force=false,clientIp=''}={}){
  asin=validateAsin(asin);
  domain=validateAmazonDomain(domain);
  if(!apiKey) {
    const error=new Error('Wyszukiwanie ASIN wymaga konfiguracji klucza SerpApi w Workerze (SERPAPI_API_KEY).');
    error.status=503;
    throw error;
  }
  const cacheKey='asin:serpapi:v1:'+domain+':'+asin;
  if(!force && kv && typeof kv.get==='function'){
    try {
      const cached=await kv.get(cacheKey,'json');
      if(cached && cached.asin===asin && cached.domain===domain){
        return {...cached,cached:true};
      }
    }catch {}
  }
  await reserveLookupCredit(kv,clientIp);
  const url=new URL('https://serpapi.com/search.json');
  url.searchParams.set('engine','amazon_product');
  url.searchParams.set('asin',asin);
  url.searchParams.set('amazon_domain',domain);
  url.searchParams.set('language',domain==='amazon.pl'?'pl_PL':domain==='amazon.de'?'de_DE':'en_US');
  url.searchParams.set('api_key',apiKey);
  let response;
  try{
    response=await fetch(url.toString(),{
      headers:{accept:'application/json'},
      signal:AbortSignal.timeout(25000)
    });
  }catch(error){
    const failure=new Error('SerpApi jest chwilowo niedostępne. Spróbuj ponownie.');
    failure.status=502;
    throw failure;
  }
  if(!response.ok) {
    const error=new Error(
      response.status===429 ? 'Limit zapytań SerpApi został wyczerpany lub przekroczony.'
      : [401,403].includes(response.status) ? 'Błędny lub nieaktywny klucz SerpApi.'
      : 'Nie udało się pobrać produktu z SerpApi (HTTP '+response.status+').'
    );
    error.status=response.status===429?429:502;
    throw error;
  }
  const body=await response.json().catch(()=>({}));
  if(body.error || body.search_metadata?.status==='Error'){
    const error=new Error('SerpApi nie zwróciło danych produktu. Sprawdź ASIN i wybrany sklep lub limit konta.');
    error.status=502;throw error;
  }
  const mapped=mapSerpApiAsinResponse(body,asin,domain);
  const result={
    asin,domain,provider:'serpapi-amazon-product',
    product:mapped.product,
    reason:mapped.reason,
    cached:false,
    fetchedAt:new Date().toISOString()
  };
  if(kv && typeof kv.put==='function'){
    try {
      await kv.put(cacheKey,JSON.stringify(result),{
        expirationTtl:result.product ? 86400 : 3600
      });
    }catch {}
  }
  return result;
}
