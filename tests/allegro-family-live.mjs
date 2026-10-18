// Live v43 read-only query refinement experiment. No write operations.
const origin='https://product-intake.sesquu.workers.dev/api/research';
const queries=[
'Galaxy S24',
'Samsung Galaxy S24',
'Samsung Galaxy S24 smartfon',
'Galaxy S24 telefon',
'SM-S921B Samsung',
'Samsung SM-S921B',
'Samsung Galaxy S24 128GB',
'Samsung Galaxy S24 SM-S921B smartfon',
'Samsung Galaxy A55',
'Sony WH1000XM5',
'Sony WH-1000XM5 nauszne',
'Dreame L50 Ultra odkurzacz',
'Roborock S8 MaxV Ultra odkurzacz'
];
let ok=0;
for(const query of queries){
 try {
  const res=await fetch(origin,{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({query}),signal:AbortSignal.timeout(16000)});
  const r=await res.json();
  if(res.ok)ok++;
  console.log('FAMILY_AB '+JSON.stringify({
    query,status:res.status,
    top1:r.best?.name || r.candidates?.[0]?.name || null,
    top5:(r.candidates||[]).slice(0,5).map(x=>x.name),
    requiresTesterChoice:r.requiresTesterChoice,
    error:res.ok?null:r.error
  }));
 } catch(e) {
  console.log('FAMILY_AB '+JSON.stringify({query,error:String(e.message||e)}));
 }
}
console.log('FAMILY_AB_SUMMARY '+JSON.stringify({checked:queries.length,ok}));
if(ok<10)process.exitCode=1;
