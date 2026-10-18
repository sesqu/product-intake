// Browser-only onboarding for the isolated v44b staging Worker.
// No credentials are embedded, stored, logged or placed in URL parameters.
const html = `<!doctype html>
<html lang="pl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Product Intake v44b — testowe Allegro</title>
  <style>
    :root{color-scheme:dark;font:16px system-ui,-apple-system,sans-serif;background:#0f141d;color:#f6f8fc}
    body{margin:0;min-height:100vh;display:grid;place-items:center;padding:20px;box-sizing:border-box}
    main{width:min(100%,440px);border:1px solid #333b49;border-radius:20px;padding:28px;background:#1a222e}
    h1{font-size:24px;margin:0 0 10px}p{color:#bcc8d8;line-height:1.5}
    label{display:block;margin-top:24px;margin-bottom:8px}
    input,button{box-sizing:border-box;width:100%;border-radius:12px;font:inherit;padding:13px 15px}
    input{background:#101722;border:1px solid #4d596b;color:white}
    button{margin-top:12px;background:#8cb8ff;color:#061527;border:0;font-weight:700}
    button:disabled{opacity:.55}output{display:block;margin-top:16px;min-height:20px;word-break:break-word}
    small{color:#94a3b8}
  </style>
  <script src="/staging/connect.js" defer></script>
</head>
<body>
  <main>
    <h1>Product Intake · v44b</h1>
    <p>Autoryzacja <strong>testowej</strong> aplikacji Allegro w odizolowanym Workerze. Nie łączy z produkcją.</p>
    <form id="connect">
      <label for="key">Klucz dostępu do stagingu</label>
      <input id="key" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" required minlength="20">
      <button type="submit">Połącz testowe Allegro</button>
    </form>
    <output id="status" role="status" aria-live="polite"></output>
    <p><small>Klucz jest używany tylko w nagłówku jednego żądania. Nie zapisujemy go w przeglądarce ani w adresie strony.</small></p>
  </main>
</body>
</html>`;

const js = `'use strict';
const form=document.getElementById('connect');
const status=document.getElementById('status');
form.addEventListener('submit',async event=>{
  event.preventDefault();
  const button=form.querySelector('button');
  const input=document.getElementById('key');
  const value=input.value;
  input.value='';
  button.disabled=true;
  status.textContent='Łączenie z testowym Allegro…';
  try {
    if(value.length<20) throw Error('Klucz jest za krótki.');
    const response=await fetch('/api/allegro/auth-url',{
      method:'GET',
      cache:'no-store',
      headers:{'x-staging-test-key':value}
    });
    const result=await response.json();
    if(!response.ok) throw Error(result.error||('HTTP '+response.status));
    const target=new URL(result.url);
    if(target.protocol!=='https:'||target.hostname!=='allegro.pl')
      throw Error('Serwer zwrócił nieoczekiwany adres autoryzacji.');
    window.location.assign(target.href);
  } catch(error) {
    status.textContent=error.message||'Nie udało się rozpocząć autoryzacji.';
    button.disabled=false;
  }
});`;

export function stagingConnectPage(){
  return new Response(html,{
    status:200,
    headers:{
      'content-type':'text/html; charset=utf-8',
      'cache-control':'no-store',
      'x-content-type-options':'nosniff',
      'referrer-policy':'no-referrer',
      'content-security-policy':"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'none'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'"
    }
  });
}

export function stagingConnectScript(){
  return new Response(js,{
    status:200,
    headers:{
      'content-type':'text/javascript; charset=utf-8',
      'cache-control':'no-store',
      'x-content-type-options':'nosniff',
      'referrer-policy':'no-referrer'
    }
  });
}
