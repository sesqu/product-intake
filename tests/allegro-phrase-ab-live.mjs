// Read-only public v43 API comparison: user-suggested "telefon + SM-S921B".
const url='https://product-intake.sesquu.workers.dev/api/research';
const cases=[
{group:'S921B',q:'SM-S921B'},
{group:'S921B',q:'telefon SM-S921B'},
{group:'S921B',q:'smartfon Samsung SM-S921B'},
{group:'S921B',q:'Samsung Galaxy S24 SM-S921B'},
{group:'S928B',q:'SM-S928B'},
{group:'S928B',q:'telefon Samsung SM-S928B'},
{group:'A556B',q:'SM-A556B'},
{group:'A556B',q:'smartfon Samsung Galaxy A55 SM-A556B'},
{group:'Sony',q:'WH-1000XM5'},
{group:'Sony',q:'słuchawki Sony WH-1000XM5'},
{group:'Dreame',q:'L50 Ultra'},
{group:'Dreame',q:'Dreame L50 Ultra robot odkurzający'},
{group:'Roborock',q:'S8 MaxV Ultra'},
{group:'Roborock',q:'Roborock S8 MaxV Ultra robot odkurzający'},
{group:'Makita',q:'DHP484'},
{group:'Makita',q:'Makita DHP484 wiertarko-wkrętarka'}
];
let ok=0;const results=[];
for(const {group,q} of cases){
  const start=Date.now();
  try {
    const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({query:q}),signal:AbortSignal.timeout(17000)});
    const b=await r.json();
    const candidates=Array.isArray(b.candidates)?b.candidates:[];
    const row={
      group,query:q,status:r.status,elapsedMs:Date.now()-start,
      top1:b.best?.name??candidates[0]?.name??null,
      top5:candidates.slice(0,5).map(x=>x.name),
      needsReview:b.requiresTesterChoice,
      error:r.ok?null:b.error??'HTTP error'
    };
    if(r.ok) ok++;
    results.push(row);
    console.log('PHRASE_AB '+JSON.stringify(row));
  }catch(error){
    const row={group,query:q,status:null,error:String(error?.message||error)};
    results.push(row);console.log('PHRASE_AB '+JSON.stringify(row));
  }
}
console.log('PHRASE_AB_SUMMARY '+JSON.stringify({checked:results.length,ok,
  note:'Production v43 only; HTTP 200 does not imply a correct product.'}));
if(ok<12) process.exitCode=1;
