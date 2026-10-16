const base = 'https://product-intake.sesquu.workers.dev';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

let last = '';
for (let attempt = 0; attempt < 18; attempt++) {
  try {
    const response = await fetch(base + '/api/research', {
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({model:'WH-1000XM5'})
    });
    const text = await response.text();
    last = response.status + ' ' + text.slice(0,500);

    if (response.ok) {
      const data = JSON.parse(text);
      if (!data.best?.name) throw new Error('Brak najlepszego kandydata');
      if (!Array.isArray(data.candidates) || !data.candidates.length) throw new Error('Brak kandydatów');
      if (data.query?.model !== 'WH-1000XM5') throw new Error('Backend nie zachował zapytania po modelu');
      console.log('PASS LIVE RESEARCH:', data.best.name, '| confidence=', data.confidence);
      process.exit(0);
    }
  } catch (error) {
    last = error.message || String(error);
  }

  await sleep(10000);
}

throw new Error('Research po modelu nie jest dostępny na produkcyjnym Workerze: ' + last);
