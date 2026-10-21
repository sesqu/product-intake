// Deterministic human review of Allegro 100-model benchmark results.
// No model-name heuristic may count a product as correct automatically.
// Usage:
// node tests/allegro-benchmark-review.mjs template benchmark-results/production-batch-all.json > reviews.json
// node tests/allegro-benchmark-review.mjs score benchmark-results/production-batch-all.json reviews.json
import {readFileSync} from 'node:fs';
const [, ,command,reportPath,reviewPath]=process.argv;
if(!['template','score'].includes(command)||!reportPath)
 throw Error('Usage: node tests/allegro-benchmark-review.mjs template|score report.json [review.json]');
const report=JSON.parse(readFileSync(reportPath,'utf8'));
if(!Array.isArray(report.results)||!report.summary?.environment)throw Error('Invalid benchmark report');
const IDs=new Set(report.results.map(r=>r.id));
if(IDs.size!==report.results.length)throw Error('Duplicate report ID');
if(command==='template'){
  const template={
    reportEnvironment:report.summary.environment,reportBatch:report.summary.batch,
    instructions:'Review actual product cards/physical units. correct = matching brand, exact model/variant, complete primary device, not spare parts/display dummy; uncertain is NOT correct.',
    reviewer:'',reviewedAt:null,
    labels:Object.fromEntries(report.results.map(r=>[r.id,{
      top1:'unreviewed',top3:'unreviewed',
      wrongVariant:false,accessoryOrDummy:false,notes:''
    }]))
  };
  process.stdout.write(JSON.stringify(template,null,2)+'\n');
  process.exit(0);
}
if(!reviewPath)throw Error('Provide human review labels JSON');
const review=JSON.parse(readFileSync(reviewPath,'utf8'));
if(review.reportEnvironment!==report.summary.environment||
  review.reportBatch!==report.summary.batch)
 throw Error('Review belongs to a different result set');
const allowed=new Set(['unreviewed','correct','incorrect','uncertain']);
let assessed=0,top1Correct=0,top3Correct=0,wrongVariant=0,accessory=0,uncertain=0;
const byCategory=new Map(),rows=[];
for(const item of report.results){
  const label=review.labels?.[item.id];
  if(!label||!allowed.has(label.top1)||!allowed.has(label.top3))
    throw Error('Missing/invalid manual label: '+item.id);
  if(label.top1==='correct'&&label.top3!=='correct')
    throw Error('TOP1 correct implies TOP3 correct: '+item.id);
  if(label.top1==='unreviewed'||label.top3==='unreviewed')continue;
  if(!review.reviewer||!review.reviewedAt)
    throw Error('Set reviewer and reviewedAt after manually checking results');
  assessed++;
  top1Correct+=Number(label.top1==='correct');
  top3Correct+=Number(label.top3==='correct');
  wrongVariant+=Number(label.wrongVariant===true);
  accessory+=Number(label.accessoryOrDummy===true);
  uncertain+=Number(label.top1==='uncertain'||label.top3==='uncertain');
  const category=byCategory.get(item.category)||{reviewed:0,top1:0,top3:0};
  category.reviewed++;
  category.top1+=Number(label.top1==='correct');
  category.top3+=Number(label.top3==='correct');
  byCategory.set(item.category,category);
  rows.push({id:item.id,category:item.category,query:item.query,top1:label.top1,top3:label.top3});
}
const summary={
  environment:report.summary.environment,batch:report.summary.batch,
  totalRows:report.results.length,manualReviewed:assessed,
  unreviewed:report.results.length-assessed,
  top1Correct,top3Correct,wrongVariant,accessoryOrDummy:accessory,uncertain,
  // Null while no manually reviewed samples: never misrepresent zero review as 0%.
  top1Accuracy:assessed?Math.round(10000*top1Correct/assessed)/100:null,
  top3Accuracy:assessed?Math.round(10000*top3Correct/assessed)/100:null,
  breakdown:Object.fromEntries([...byCategory]),
  note:'Accuracy calculated ONLY over rows where a human reviewed TOP1 and TOP3.'
};
console.log(JSON.stringify({summary,rows},null,2));
