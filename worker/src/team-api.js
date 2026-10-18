import {verifyAccessJwt} from './team-auth.js';

const roles=new Set(['owner','manager','tester','viewer']);
const now=()=>Math.floor(Date.now()/1000);
function problem(status,message){const e=new Error(message);e.status=status;throw e;}
function clean(value){return String(value??'').trim();}
function result(data,status=200){return new Response(JSON.stringify(data),{
  status,headers:{'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store','x-content-type-options':'nosniff'}
});}
function normalizeLpn(lpn){
  const raw=clean(lpn);
  if(!raw||raw.length>90||!^[a-z0-9\-_. /]+$?/.test('')){} // Intentionally no implicit SKU rewrite.
  if(!raw||raw.length>90||/[\x00-\x1f]/.test(raw))problem(400,'Nieprawidłowe LPN');
  return {lpn:raw,key:raw.normalize('NFKC').toLowerCase()};
}
async function jsonBody(request){
  const length=Number(request.headers.get('content-length')||0);
  if(length>150_000)problem(413,'Produkt przekracza limit 150 kB');
  const text=await request.text();
  if(text.length>150_000)problem(413,'Produkt przekracza limit 150 kB');
  try{const body=JSON.parse(text);if(!body||typeof body!=='object'||Array.isArray(body))throw Error();
    return body;}catch{problem(400,'Nieprawidłowy JSON');}
}
function restricted(user,allowed){
  if(!allowed.includes(user.role))problem(403,'Brak uprawnień do tej operacji');
}
function bind(db,sql,...args){return db.prepare(sql).bind(...args);}
function parseProduct(x){if(!x)return null;return {...x,data:JSON.parse(x.data_json),data_json:undefined};}
function checkVersion(raw){
  if(!Number.isSafeInteger(raw)||raw<0)problem(428,'Wymagana aktualna wersja produktu (expectedRevision)');
  return raw;
}
function assertTeam(env){
  if(env.TEAM_MODE!=='1'||!env.TEAM_DB||!clean(env.TEAM_WORKSPACE_ID))
    problem(503,'Wieloużytkownikowa baza danych nie jest skonfigurowana');
  return {db:env.TEAM_DB,workspace:clean(env.TEAM_WORKSPACE_ID)};
}
async function authenticate(request,env,db,workspace){
  const actor=await verifyAccessJwt(request,env);
  const firstOwner=clean(env.TEAM_OWNER_EMAIL).toLowerCase();
  if(actor.email===firstOwner){
    // Only the fixed configured owner can bootstrap the first member.
    await bind(db,`INSERT OR IGNORE INTO team_users
      (workspace_id,email,access_sub,role,active,created_at,updated_at)
      VALUES (?, ?, ?, 'owner', 1, ?, ?)`,
      workspace,actor.email,actor.sub,now(),now()).run();
  }
  const user=await bind(db,`SELECT email,role,access_sub,active
    FROM team_users WHERE workspace_id=? AND email=?`,
    workspace,actor.email).first();
  if(!user||!user.active)problem(403,'Konto nie zostało zaproszone lub jest nieaktywne');
  if(user.access_sub && user.access_sub!==actor.sub)
    problem(403,'Konto jest powiązane z inną tożsamością Cloudflare Access');
  if(!user.access_sub){
    const attached=await bind(db,`UPDATE team_users SET access_sub=?,updated_at=?
      WHERE workspace_id=? AND email=? AND access_sub IS NULL`,
      actor.sub,now(),workspace,actor.email).run();
    if(attached.meta?.changes!==1)problem(409,'Konto zostało już powiązane z inną osobą');
  }
  return {email:actor.email,sub:actor.sub,role:user.role};
}
function isEditor(user){restricted(user,['owner','manager','tester']);}
async function details(db,workspace,lpnKey){
  return bind(db,`SELECT * FROM team_products
    WHERE workspace_id=? AND lpn_key=? AND deleted_at IS NULL`,
    workspace,lpnKey).first();
}
async function claim(db,workspace,key,user,release=false){
  isEditor(user);
  const stamp=now();
  const action=release
    ? bind(db,`UPDATE team_products SET locked_by=NULL,lock_expires_at=NULL,
          updated_by=?,updated_at=?
        WHERE workspace_id=? AND lpn_key=? AND deleted_at IS NULL
          AND locked_by=? AND lock_expires_at>?`,
        user.email,stamp,workspace,key,user.email,stamp)
    : bind(db,`UPDATE team_products SET locked_by=?,lock_expires_at=?,
          updated_by=?,updated_at=?
        WHERE workspace_id=? AND lpn_key=? AND deleted_at IS NULL
          AND (locked_by IS NULL OR lock_expires_at<=? OR locked_by=?)`,
        user.email,stamp+600,user.email,stamp,workspace,key,stamp,user.email);
  const change=await action.run();
  if(change.meta?.changes!==1){
    const record=await details(db,workspace,key);
    if(!record)problem(404,'Produkt nie istnieje');
    problem(423,'Produkt jest edytowany przez innego pracownika lub blokada wygasła');
  }
  return parseProduct(await details(db,workspace,key));
}
async function write(db,workspace,key,user,body){
  isEditor(user);
  const expected=checkVersion(body.expectedRevision);
  const draft=body.product;
  if(!draft||typeof draft!=='object'||Array.isArray(draft))problem(400,'Brak produktu');
  const {lpn,key:payloadKey}=normalizeLpn(draft.lpn);
  if(payloadKey!==key)problem(400,'Nie wolno zmieniać LPN w istniejącym produkcie');
  const packed=JSON.stringify(draft);
  if(packed.length>140_000)problem(413,'Produkt przekracza limit 140 kB');
  const stamp=now();
  if(expected===0){
    const inserted=await bind(db,`INSERT INTO team_products
      (workspace_id,lpn_key,lpn,data_json,revision,locked_by,lock_expires_at,
       updated_by,updated_at,created_by,created_at)
      VALUES (?,?,?,?,1,?,?,?,?,?,?)
      ON CONFLICT(workspace_id,lpn_key) DO NOTHING`,
      workspace,key,lpn,packed,user.email,stamp+600,
      user.email,stamp,user.email,stamp).run();
    if(inserted.meta?.changes!==1)problem(409,'Produkt o tym LPN już istnieje. Pobierz jego aktualne dane.');
    return parseProduct(await details(db,workspace,key));
  }
  const changed=await bind(db,`UPDATE team_products
      SET data_json=?,revision=revision+1,updated_by=?,updated_at=?,
          lock_expires_at=?
      WHERE workspace_id=? AND lpn_key=? AND revision=? AND deleted_at IS NULL
        AND locked_by=? AND lock_expires_at>?`,
    packed,user.email,stamp,stamp+600,workspace,key,expected,user.email,stamp).run();
  if(changed.meta?.changes!==1){
    const actual=await details(db,workspace,key);
    if(!actual)problem(404,'Produkt nie istnieje');
    if(actual.revision!==expected)
      problem(409,'Konflikt wersji: ktoś zapisał nowszy produkt. Pobierz zmiany przed kolejnym zapisem.');
    problem(423,'Nie posiadasz aktualnej blokady tego produktu.');
  }
  return parseProduct(await details(db,workspace,key));
}

export async function handleTeamApi(request,env){
  try{
    const {db,workspace}=assertTeam(env);
    const user=await authenticate(request,env,db,workspace);
    const url=new URL(request.url);
    const route=url.pathname.slice('/api/team'.length);
    if(route==='/me'&&request.method==='GET')
      return result({user,workspace});

    if(route==='/members'&&request.method==='GET'){
      restricted(user,['owner']);
      const members=await bind(db,`SELECT email,role,active,created_at,updated_at
         FROM team_users WHERE workspace_id=? ORDER BY email`,workspace).all();
      return result({members:members.results||[]});
    }
    if(route==='/members'&&request.method==='POST'){
      restricted(user,['owner']);
      const body=await jsonBody(request);
      const email=clean(body.email).toLowerCase(),role=clean(body.role);
      if(!/^\S+@\S+\.\S+$/.test(email)||email.length>254||
        !roles.has(role))problem(400,'Nieprawidłowy e-mail lub rola');
      if(role==='owner')problem(403,'Drugie konto owner wymaga osobnej procedury');
      await bind(db,`INSERT INTO team_users
        (workspace_id,email,role,active,created_at,updated_at)
        VALUES(?,?,?,1,?,?)
        ON CONFLICT(workspace_id,email) DO UPDATE
        SET role=excluded.role,active=1,updated_at=excluded.updated_at`,
        workspace,email,role,now(),now()).run();
      return result({email,role,invited:true},201);
    }
    if(route==='/products'&&request.method==='GET'){
      const list=await bind(db,`SELECT lpn,revision,updated_by,updated_at,
        locked_by,lock_expires_at FROM team_products
        WHERE workspace_id=? AND deleted_at IS NULL
        ORDER BY updated_at DESC,lpn_key LIMIT 100`,workspace).all();
      return result({products:list.results||[],limit:100});
    }
    const match=route.match(/^\/products\/([^/]+)(?:\/(claim|release|history))?$/);
    if(!match)problem(404,'Nieznany endpoint zespołu');
    let raw;
    try{raw=decodeURIComponent(match[1]);}catch{problem(400,'Błędne LPN');}
    const {key}=normalizeLpn(raw);
    const action=match[2]||'';
    if(action==='history'&&request.method==='GET'){
      const records=await bind(db,`SELECT event_id,revision,action,actor_email,at
        FROM team_events WHERE workspace_id=? AND lpn_key=?
        ORDER BY event_id DESC LIMIT 100`,workspace,key).all();
      return result({history:records.results||[]});
    }
    if(action==='claim'&&request.method==='POST')
      return result({product:await claim(db,workspace,key,user,false)});
    if(action==='release'&&request.method==='POST')
      return result({product:await claim(db,workspace,key,user,true)});
    if(action===''&&request.method==='GET'){
      const row=await details(db,workspace,key);
      if(!row)problem(404,'Produkt nie istnieje');
      return result({product:parseProduct(row)});
    }
    if(action===''&&request.method==='PUT'){
      const body=await jsonBody(request);
      const row=await write(db,workspace,key,user,body);
      return result({product:row},body.expectedRevision===0?201:200);
    }
    problem(405,'Niedozwolona operacja');
  }catch(e){
    return result({error:e?.message||'Błąd serwera'},e?.status||500);
  }
}
