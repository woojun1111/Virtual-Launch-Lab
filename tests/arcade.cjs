const assert=require('node:assert/strict');const A=require('../dist/arcade/learning.js');
const l=new A.Learner(42),before=l.evaluate();
const pristine=JSON.stringify(l.snapshot());l.evaluate();assert.equal(JSON.stringify(l.snapshot()),pristine,'evaluation must not train');
const safe=A.step({x:0,h:1,v:2,f:1,done:false},3);assert.equal(safe.success,true);assert.equal(safe.damage,0);
const crash=A.step({x:0,h:1,v:2,f:0,done:false},3);assert.equal(crash.damage,1);assert.equal(crash.success,false);
assert.equal(A.step({x:5,h:1,v:1,f:1,done:false},3).success,false,'off-target soft landing fails');
assert.throws(()=>A.step(safe.state,0));
for(let seed=0;seed<200;seed++){const r=A.rng(seed);let s=A.reset(r),n=0;while(!s.done){s=A.step(s,Math.floor(r()*4)).state;assert(++n<=18);assert(s.f>=0);}}
l.train(20000);const after=l.evaluate(),baseline=l.evaluate(260,90001,true);assert(after.successRate>before.successRate);assert(after.successRate>baseline.successRate+.3);
assert.deepEqual(after.results.map(x=>x.initial),baseline.results.map(x=>x.initial),'paired initial conditions');
const copy=new A.Learner();copy.restore(JSON.parse(JSON.stringify(l.snapshot())));assert.deepEqual(copy.evaluate(),after);assert.throws(()=>copy.restore({version:'bad'}));
console.log(JSON.stringify({before:before.successRate,after:after.successRate,random:baseline.successRate,meanDamage:after.meanDamage,episodes:l.episodes}));
