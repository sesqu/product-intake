import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { stagingProbeScript } from '../worker/src/staging-probe.js';

const key='this-is-only-a-local-test-staging-key-1234';
function element(tag='div'){
  return {
    tagName:tag,children:[],listeners:{},
    textContent:'',value:'',disabled:false,
    appendChild(child){this.children.push(child);return child;},
    replaceChildren(){this.children=[];},
    addEventListener(name,handler){this.listeners[name]=handler;}
  };
}
const elements={
  run:element('button'),copy:element('button'),
  key:element('input'),status:element('output'),results:element('div')
};
elements.key.value=key;
elements.copy.disabled=true;
let stageIsValid=true;
let apiCalls=0;
let copied='';
const browser={
  document:{
    getElementById(id){return elements[id]||null;},
    createElement(tag){return element(tag);}
  },
  AbortSignal,
  navigator:{
    clipboard:{async writeText(value){copied=value;}}
  },
  fetch:async (url,options={})=>{
    if(url==='/health'){
      return {
        ok:true,
        async json(){
          return {
            environment:stageIsValid?'staging':'production',
            appVersion:'v44b-staging',
            allegro:{connected:true}
          };
        }
      };
    }
    assert.equal(url,'/api/research','Browser must call only staging API');
    assert.equal(options.method,'POST');
    assert.equal(options.headers['x-staging-test-key'],key);
    apiCalls++;
    const body=JSON.parse(options.body);
    return {
      ok:true,
      async json(){
        return {
          best:{name:'Produkt dla '+body.query},
          confidence:72,
          requiresTesterChoice:true,
          bestFoundBy:{mode:'MPN'},
          searchAttempts:[
            {phrase:body.query,mode:'',foundCount:5,uniqueAdded:5},
            {phrase:body.query,mode:'MPN',foundCount:1,uniqueAdded:1}
          ],
          candidates:[{name:'Produkt dla '+body.query,score:72}]
        };
      }
    };
  }
};
const script=await (await stagingProbeScript()).text();
runInNewContext(script,browser,{timeout:1000});
assert.equal(typeof elements.run.listeners.click,'function');
await elements.run.listeners.click();
assert.equal(apiCalls,8,'Browser probe must issue all eight cases');
assert.equal(elements.results.children.length,8);
assert.equal(elements.copy.disabled,false);
assert.equal(elements.key.value,'','Browser must clear access key input before testing');
const firstCard=elements.results.children[0];
const label=firstCard.children.find(c=>c.tagName==='label');
const select=label.children.find(c=>c.tagName==='select');
assert(select);
select.value='correct';
select.listeners.change();
await elements.copy.listeners.click();
const report=JSON.parse(copied);
assert.equal(report.version,'v44b-staging');
assert.equal(report.total,8);
assert.equal(report.rows[0].testerVerdict,'correct');
assert.equal(report.rows[0].bestFoundBy.mode,'MPN');
assert.equal(report.rows[0].mpnUniqueAdded,1);
assert.equal(report.rows[0].query,'SM-S921B');
assert(!copied.includes(key),'The secret key must never be exported');
assert(!copied.includes('Bearer'),'OAuth tokens must not be present in exported report');

stageIsValid=false;
elements.key.value=key;
await elements.run.listeners.click();
assert.equal(apiCalls,8,'Environment identity mismatch must block every API call');
assert(elements.status.textContent.includes('Błędne środowisko'));
console.log('PASS browser MPN probe: 8 cases, tester ground-truth, no leaked key, stage identity guard.');
