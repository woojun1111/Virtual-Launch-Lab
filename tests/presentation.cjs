const assert=require('node:assert/strict');require('../dist/presentation.js');
const base={time:8,separated:true,separationTime:8};const start=LaunchPresentation.pose(base);assert.deepEqual(start.booster,{x:0,angle:0,roll:0});
const near=LaunchPresentation.pose({...base,time:8.000001});assert.ok(Math.abs(near.booster.x)<1e-12);assert.ok(Math.abs(near.booster.angle)<1e-12);
const later=LaunchPresentation.pose({...base,time:12});assert.ok(later.booster.angle!==0&&later.booster.x<0);
const raw=LaunchPresentation.pose({...base,time:12},false);assert.equal(raw.booster.angle,0);assert.equal(raw.booster.x,0);assert.equal(raw.upper.x,0);
const stopped=LaunchPresentation.pose({...base,time:14,boosterImpactTime:12});assert.deepEqual(stopped.booster,later.booster);
assert.deepEqual(LaunchPresentation.pose({...base,time:0,separated:false}).booster,start.booster);
console.log('PASS presentation: continuous separation, no instantaneous translation/rotation, opt-out, impact freeze, reset');
