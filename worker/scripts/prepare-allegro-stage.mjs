import {writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';

const required=['V44_STAGE_URL','V44_STAGE_KV_ID','V44_STAGE_ALLEGRO_CLIENT_ID',
  'V44_STAGE_ALLEGRO_CLIENT_SECRET','V44_STAGE_KEY'];
for(const name of required){
  if(!process.env[name])throw Error('Missing stage-specific environment variable: '+name);
}
const url=new URL(process.env.V44_STAGE_URL);
const name='product-intake-v44-search-staging';
if(url.protocol!=='https:'||url.hostname!=='product-intake-v44-search-staging.sesquu.workers.dev'||
   url.pathname!=='/'||url.search||url.hash){
  throw Error('Refusing non-isolated Worker URL. Expected https://'+name+'.sesquu.workers.dev/');
}
const kv=process.env.V44_STAGE_KV_ID;
if(!/^[a-f0-9]{32}$/i.test(kv)||kv==='234d48b2a6104d759f600588dbdb69fb')
  throw Error('Staging KV must be a valid DISTINCT KV namespace ID');
const client=process.env.V44_STAGE_ALLEGRO_CLIENT_ID;
if(client==='3e39ca5bf6c64c91abf11983a8e1ea48'||!client)
  throw Error('Refusing to use production Allegro Client ID');
if(process.env.V44_STAGE_KEY.length<32)
  throw Error('Stage API key must be at least 32 characters');
const worker={
  $schema:'node_modules/wrangler/config-schema.json',
  name,
  main:'src/index.js',
  compatibility_date:'2026-09-25',
  vars:{
    ALLOWED_ORIGIN:'https://sesqu.github.io',
    ALLEGRO_CLIENT_ID:client,
    ALLEGRO_REDIRECT_URI:url.origin+'/api/allegro/callback',
    ALLEGRO_USER_AGENT:'Product-Intake/v44-search-staging',
    APP_VERSION:'v44-search-staging',
    STAGING_ONLY:'1'
  },
  kv_namespaces:[{binding:'AUTH',id:kv}]
};
const location=resolve(dirname(fileURLToPath(import.meta.url)),'../wrangler.allegro-stage.runtime.json');
writeFileSync(location,JSON.stringify(worker,null,2)+'\n',{mode:0o600});
console.log('Created isolated Cloudflare Worker config for '+worker.name+
  ', distinct KV and OAuth client verified. No production config touched.');
