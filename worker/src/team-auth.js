// Verify Cloudflare Access identity cryptographically. Never trust a user-sent
// email, workspace key or unverified JWT claim for authorization.
const encoder = new TextEncoder();
const cache=new Map();
function fail(status,message){const e=new Error(message);e.status=status;throw e;}
function decode64url(value){
  if(typeof value!=='string'||!/^[A-Za-z0-9_-]+$/.test(value))fail(401,'Nieprawidłowy token');
  const normal=value.replace(/-/g,'+').replace(/_/g,'/');
  return Uint8Array.from(atob(normal.padEnd(Math.ceil(normal.length/4)*4,'=')),c=>c.charCodeAt(0));
}
function decodeJson(value){
  try {return JSON.parse(new TextDecoder().decode(decode64url(value))); }
  catch{fail(401,'Nieprawidłowy token');}
}
export async function verifyAccessJwt(request,env){
  const domain=String(env.TEAM_ACCESS_DOMAIN||'').trim().toLowerCase();
  const audience=String(env.TEAM_ACCESS_AUD||'').trim();
  if(!/^[a-z0-9-]{4,80}$/.test(domain)||!audience)
    fail(503,'Cloudflare Access nie jest skonfigurowane');
  const jwt=request.headers.get('cf-access-jwt-assertion')||'';
  if(jwt.length>12000)fail(401,'Nieprawidłowy token');
  const pieces=jwt.split('.');
  if(pieces.length!==3)fail(401,'Zaloguj się przez Cloudflare Access');
  const header=decodeJson(pieces[0]),claims=decodeJson(pieces[1]);
  if(header.alg!=='RS256'||typeof header.kid!=='string'||!header.kid)
    fail(401,'Nieobsługiwany token');
  const now=Math.floor(Date.now()/1000);
  const issuer='https://'+domain+'.cloudflareaccess.com';
  if(claims.iss!==issuer ||
     !(Array.isArray(claims.aud)?claims.aud.includes(audience):claims.aud===audience) ||
     typeof claims.exp!=='number'||claims.exp<=now ||
     typeof claims.nbf==='number'&&claims.nbf>now+30 ||
     typeof claims.iat==='number'&&claims.iat>now+30 ||
     typeof claims.sub!=='string'||claims.sub.length<6 ||
     typeof claims.email!=='string'||!claims.email.includes('@'))
    fail(401,'Token nie jest przeznaczony dla Product Intake lub wygasł');
  let jwks=cache.get(issuer);
  if(!jwks||jwks.until<Date.now()){
    const url=issuer+'/cdn-cgi/access/certs';
    const r=await fetch(url,{signal:AbortSignal.timeout(7000)});
    if(!r.ok)fail(503,'Brak dostępu do certyfikatów logowania');
    const data=await r.json();
    jwks={keys:Array.isArray(data.keys)?data.keys:[],until:Date.now()+10*60*1000};
    cache.set(issuer,jwks);
  }
  const jwk=jwks.keys.find(x=>x.kid===header.kid && x.kty==='RSA' &&
    (!x.alg||x.alg==='RS256') && (!x.use||x.use==='sig'));
  if(!jwk)fail(401,'Brak zgodnego certyfikatu logowania');
  const publicKey=await crypto.subtle.importKey('jwk',jwk,
    {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  const valid=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',publicKey,
    decode64url(pieces[2]),encoder.encode(pieces[0]+'.'+pieces[1]));
  if(!valid)fail(401,'Nieprawidłowy podpis logowania');
  const email=claims.email.trim().toLowerCase();
  if(email.length>254||!/^\S+@\S+\.\S+$/.test(email))fail(401,'Nieprawidłowy adres konta');
  return {sub:claims.sub,email};
}
