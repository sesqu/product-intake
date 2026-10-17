const base='https://product-intake.sesquu.workers.dev';
const cases=[
  {base:'L50 Ultra',probes:['Dreame L50 Ultra robot odkurzający','Dreame L50 Ultra odkurzacz'],want:/dreame.*l50.*(robot|odkurzacz)|(robot|odkurzacz).*dreame.*l50/i},
  {base:'S8 MaxV Ultra',probes:['Roborock S8 MaxV Ultra robot odkurzający','Roborock S8 MaxV Ultra odkurzacz'],want:/roborock.*s8.*(robot|odkurzacz)|(robot|odkurzacz).*roborock.*s8/i},
  {base:'DCD796',probes:['DeWalt DCD796 wiertarko-wkrętarka','DeWalt DCD796 wiertarka'],want:/dewalt.*dcd796.*(wiert|wkręt)|(wiert|wkręt).*dewalt.*dcd796/i},
  {base:'SM-S921B',probes:['Samsung Galaxy S24 smartfon','Samsung SM-S921B smartfon'],want:/samsung.*(galaxy s24|sm-s921b).*(smartfon|telefon)|(smartfon|telefon).*samsung.*(galaxy s24|sm-s921b)/i},
  {base:'SM-S928B',probes:['Samsung Galaxy S24 Ultra smartfon','Samsung SM-S928B smartfon'],want:/samsung.*(galaxy s24 ultra|sm-s928b).*(smartfon|telefon)|(smartfon|telefon).*samsung.*(galaxy s24 ultra|sm-s928b)/i},
  {base:'SM-A556B',probes:['Samsung Galaxy A55 5G smartfon','Samsung SM-A556B smartfon'],want:/samsung.*(galaxy a55|sm-a556b).*(smartfon|telefon)|(smartfon|telefon).*samsung.*(galaxy a55|sm-a556b)/i},
  {base:'14T',probes:['Xiaomi 14T smartfon','Xiaomi 14T telefon'],want:/xiaomi.*14t.*(smartfon|telefon)|(smartfon|telefon).*xiaomi.*14t/i}
];

async function lookup(query){
  const response=await fetch(base+'/api/research',{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({query}),
    signal:AbortSignal.timeout(15000)
  });
  const text=await response.text();
  if(!response.ok) return {error:'HTTP '+response.status+' '+text.slice(0,160),candidates:[]};
  return JSON.parse(text);
}

for(const test of cases){
  for(const query of test.probes){
    const data=await lookup(query);
    const candidates=data.candidates||[];
    console.log('TYPE_PROBE '+JSON.stringify({
      base:test.base,
      query,
      best:data.best?.name||'',
      confidence:data.confidence??0,
      found:candidates.some(x=>test.want.test(x.name||'')),
      matches:candidates.filter(x=>test.want.test(x.name||'')).map(x=>x.name),
      top:candidates.slice(0,5).map(x=>x.name||'')
    }));
  }
}
