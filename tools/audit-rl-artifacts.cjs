'use strict';
// Read-only artifact inspection. Never imports or executes supplied simulation/policies.
const fs=require('node:fs');
function audit(policy,episode,csv){
 if(!Array.isArray(policy.weights)||!policy.weights.every(Number.isFinite))throw Error('Invalid weights');
 if(!Array.isArray(policy.sizes)||policy.sizes.length<2||!policy.sizes.every(x=>Number.isInteger(x)&&x>0))throw Error('Invalid sizes');
 const expected=policy.sizes.slice(1).reduce((n,size,i)=>n+(policy.sizes[i]+1)*size,0);
 if(policy.weights.length!==expected)throw Error('Weight count mismatch');
 const lines=csv.trim().split(/\r?\n/),headers=lines.shift().split(',');
 if(!headers.includes('gen')||!headers.includes('meanReturn'))throw Error('Missing log columns');
 const rows=lines.map(l=>{const v=l.split(',').map(Number);if(v.length!==headers.length||!v.every(Number.isFinite))throw Error('Invalid log row');return Object.fromEntries(headers.map((k,i)=>[k,v[i]]));});
 if(!rows.length)throw Error('Empty log');
 const best=rows.reduce((a,b)=>b.meanReturn>a.meanReturn?b:a);
 if(!episode.info||!Array.isArray(episode.traj))throw Error('Invalid episode');
 return {scope:'artifact inspection only; no rollout or training',storedGeneration:policy.gens,bestLoggedGeneration:best.gen,bestLoggedReturn:best.meanReturn,storedBestReturn:policy.bestReturn,weightCount:expected,level:episode.level,seed:episode.seed,outcome:episode.info.outcome,onPad:episode.info.onPad,miss:episode.info.miss,damageProxy:episode.info.damage,frames:episode.traj.length,warnings:['Log returns are rounded; best-generation attribution relies on supplied save logic.','A single recorded episode does not reproduce aggregate evaluation.','Damage proxy is not a calibrated probability of structural failure.']};
}
if(require.main===module){if(process.argv.length!==5)throw Error('Usage: node tools/audit-rl-artifacts.cjs policy.json episode.json training.log.csv');console.log(JSON.stringify(audit(JSON.parse(fs.readFileSync(process.argv[2])),JSON.parse(fs.readFileSync(process.argv[3])),fs.readFileSync(process.argv[4],'utf8')),null,2));}
module.exports={audit};
