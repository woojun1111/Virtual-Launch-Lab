import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RocketLandingSim } from '../src/simulation/RocketLandingSim.js';
import { RocketVisual } from '../src/scene/RocketMeshBuilder.js';
const config=JSON.parse(readFileSync(new URL('../shared/physics_config.json',import.meta.url)));
const controller=(thrust=0) => ({ config, async init(){}, async predictAction(){return {thrust,thrustRatio:thrust/config.max_thrust,gimbalRad:0};} });
test('explicit Euler free fall uses old velocity',async()=>{
 const sim=await new RocketLandingSim(controller()).init();
 sim.reset([0,100,2,-3,0,0,0]);
 const s=await sim.step(.05);
 assert.equal(s.x,.1); assert.equal(s.y,99.85); assert.equal(s.vy,-3-9.81*.05);
});
test('landing preserves impact velocity; terminal step rejected',async()=>{
 const sim=await new RocketLandingSim(controller()).init();sim.reset([0,.01,0,-1,0,0,0]);
 const s=await sim.step(.05);assert.equal(s.status,'LANDED');assert.ok(s.vy<0);assert.equal(s.rewardTerminal,200);
 await assert.rejects(sim.step(.05),/Episode ended/);
});
test('timeout is not a crash',async()=>{
 const sim=await new RocketLandingSim(controller()).init();sim.reset([0,100,0,0,0,0,0]);sim.stepCount=599;
 const s=await sim.step(.05);assert.equal(s.status,'FLYING');assert.equal(s.truncated,true);assert.equal(s.done,true);
});
test('pending inference blocks concurrent step/reset',async()=>{
 let release;const c=controller();c.predictAction=()=>new Promise(resolve=>{release=resolve;});
 const sim=await new RocketLandingSim(c).init();sim.reset();const pending=sim.step(.05);
 await assert.rejects(sim.step(.05),/Concurrent/);assert.throws(()=>sim.reset(),/pending/);
 release({thrust:0,thrustRatio:0,gimbalRad:0});await pending;assert.doesNotThrow(()=>sim.reset());
});
test('visual flame follows actual thrust; four legs and lattice fins exist',()=>{
 const visual=new RocketVisual();
 visual.updateVisuals({x:0,y:100,theta:.1,gimbalRad:.02,thrustRatio:.7,thrust:0,status:'FLYING'},0);
 assert.equal(visual.flameGroup.visible,false);assert.equal(visual.legs.length,4);assert.equal(visual.gridFins.length,4);
 assert.equal(visual.nozzlePivot.rotation.z,.02);visual.dispose();
});
