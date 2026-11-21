const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
(async()=>{
const html=fs.readFileSync('dist/replay/index.html','utf8'),els={},g=new Proxy({},{get:()=>()=>{}});for(const m of html.matchAll(/id="([^"]+)"/g))els[m[1]]={value:0,checked:false,style:{},textContent:'',width:1100,height:650,getContext:()=>g,appendChild(){}};
const episode=require('../dist/replay/episode.json'),files={'episode.json':episode,'evaluations.json':require('../dist/replay/evaluations.json'),'training.json':require('../dist/replay/training.json')};let callback;
const sandbox={window:{},document:{getElementById:k=>{assert(els[k],k);return els[k];},createElement:()=>({appendChild(){}}),hidden:false},fetch:async n=>({ok:true,json:async()=>files[n]}),requestAnimationFrame:f=>callback=f,console};vm.createContext(sandbox);
for(const f of ['data.js','app.js','history.js'])vm.runInContext(fs.readFileSync('dist/replay/'+f,'utf8'),sandbox);
await new Promise(setImmediate);assert.match(els['generation-stats'].textContent,/375세대/);assert.match(els.playlist.textContent,/1 \/ 1/);
const second=JSON.parse(JSON.stringify(episode));second.seed=123;await els.file.onchange({target:{files:[{size:10,text:async()=>JSON.stringify(episode)},{size:10,text:async()=>JSON.stringify(second)}]}});
els.loop.checked=true;els.play.onclick();els.time.value=Number(els.time.max)-.01;callback(100);assert.match(els.playlist.textContent,/2 \/ 2/);assert.match(els.playlist.textContent,/123/);els.end.onclick();assert.equal(Number(els.time.value),Number(els.time.max));
els.generation.value=0;els.generation.oninput();assert.match(els['generation-stats'].textContent,/5세대/);
console.log('PASS replay UI: log selection, multi-file playlist, automatic advance, final frame (mock DOM)');
})();
