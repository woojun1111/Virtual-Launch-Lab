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

import * as THREE from 'three';
import { TrajectoryVisualizer } from '../src/scene/TrajectoryVisualizer.js';
import { ExhaustPlumeParticles } from '../src/scene/ExhaustPlumeParticles.js';
test('ballistic positive root satisfies ground equation and colors only horizontal offset',()=>{
 const scene=new THREE.Scene(), vis=new TrajectoryVisualizer(scene);
 for (const vy of [-20,0,20]) {
  const s={x:0,y:100,vx:0,vy,status:'FLYING'};
  const p=vis.updatePrediction(s);
  assert.ok(p.tImpact>0);assert.ok(Math.abs(s.y+vy*p.tImpact-.5*9.81*p.tImpact**2)<1e-10);
  assert.equal(p.color,0x10b981);
 }
 assert.equal(vis.updatePrediction({x:3,y:100,vx:0,vy:0,status:'FLYING'}).color,0xf59e0b);
 assert.equal(vis.updatePrediction({x:13,y:100,vx:0,vy:0,status:'FLYING'}).color,0xef4444);
 vis.updatePrediction({x:0,y:100,vx:0,vy:0,status:'FLYING',done:true});
 assert.equal(vis.iipGroup.visible,false);vis.dispose();assert.equal(scene.children.length,0);
});
test('trajectory retains latest points including terminal nozzle point; reset clears',()=>{
 const scene=new THREE.Scene(),vis=new TrajectoryVisualizer(scene,{maxPoints:3});
 for(let i=0;i<5;i++) vis.recordStep({time:i,status:i===4?'LANDED':'FLYING'},new THREE.Vector3(i,10+i,2));
 assert.equal(vis.pointCount,3);assert.deepEqual(Array.from(vis.positions),[2,12,2,3,13,2,4,14,2]);
 vis.recordStep({time:4},new THREE.Vector3(99,99,99));assert.equal(vis.positions[6],4);
 vis.reset();assert.equal(vis.lineGeo.drawRange.count,0);vis.dispose();
});
test('world nozzle position includes pitch, gimbal and visual offset',()=>{
 const visual=new RocketVisual();visual.setPose({x:3,y:20,theta:Math.PI/2,gimbalRad:0});
 const p=visual.getNozzleWorldPosition(new THREE.Vector3());
 assert.ok(Math.abs(p.x-8.1)<1e-10);assert.ok(Math.abs(p.y-(20+4+2.6*Math.SQRT1_2))<1e-10);
 visual.dispose();
});
class HeadlessSmoke extends ExhaustPlumeParticles {
 _createSmokeTexture(){return new THREE.Texture();} // Only GPU/canvas creation is replaced.
}
test('smoke emission requires actual thrust and downward exhaust; pool resets and fades',()=>{
 const scene=new THREE.Scene(),smoke=new HeadlessSmoke(scene,{maxParticles:8});
 const s={x:0,y:1,theta:0,gimbalRad:0,thrustRatio:1,thrust:0,status:'FLYING'};
 smoke.update(s,.05);assert.equal(smoke.active.reduce((a,b)=>a+b,0),0);
 s.thrust=22000;s.theta=Math.PI;smoke.update(s,.05);assert.equal(smoke.active.reduce((a,b)=>a+b,0),0);
 s.theta=0;smoke.update(s,.05);assert.ok(smoke.active.some(Boolean));
 const positions=smoke.positions;s.done=true;
 for(let i=0;i<50;i++) smoke.update(s,.05);
 assert.equal(smoke.active.reduce((a,b)=>a+b,0),0);assert.equal(smoke.positions,positions);
 smoke.reset();assert.ok(smoke.alphas.every(a=>a===0));smoke.dispose();assert.equal(scene.children.length,0);
});

import {ManualRocketController} from '../src/controls/ManualRocketController.js';
test('manual override bypasses policy, allows cutoff, clamps limits and empty fuel',async()=>{
 const c=controller();c.predictAction=()=>{throw new Error('Policy must not run');};
 const sim=await new RocketLandingSim(c).init();sim.reset();
 let s=await sim.step(.05,{thrustRatio:0,gimbalRad:10});assert.equal(s.thrust,0);assert.equal(s.gimbalRad,Math.PI/12);
 s=await sim.step(.05,{thrustRatio:2,gimbalRad:-10});assert.equal(s.thrust,22000);assert.equal(s.gimbalRad,-Math.PI/12);
 sim.reset([0,100,0,0,0,0,0]);s=await sim.step(.05,{thrustRatio:1,gimbalRad:0});assert.equal(s.thrust,0);
 await assert.rejects(sim.step(.05,{thrustRatio:NaN,gimbalRad:0}),/finite/);
});
test('keyboard responds once per dt, centers gimbal, releases and removes listeners',()=>{
 const target=new EventTarget();let toggles=0;
 const c=new ManualRocketController({target,onToggleMode:()=>toggles++});
 const key=(type,code)=>{const e=new Event(type,{cancelable:true});Object.defineProperty(e,'code',{value:code});target.dispatchEvent(e);};
 key('keydown','ArrowLeft');key('keydown','Space');
 let a=c.update(.05);assert.equal(a.thrustRatio,1);assert.ok(a.gimbalRad<0);
 key('keyup','ArrowLeft');key('keyup','Space');const old=Math.abs(a.gimbalRad);
 a=c.update(.05);assert.equal(a.thrustRatio,0);assert.ok(Math.abs(a.gimbalRad)<old);
 key('keydown','KeyM');assert.equal(toggles,1);
 key('keydown','Space');target.dispatchEvent(new Event('blur'));assert.equal(c.update(.05).thrustRatio,0);
 key('keydown','Space');c.reset();assert.equal(c.keys.size,0);
 c.dispose();key('keydown','KeyM');assert.equal(toggles,1);
});

import RocketRLController from '../src/ai/RocketRLController.js';
test('missing or HTML normalization response resolves unavailable without JSON parsing',async t=>{
 const expected='모델 파일(public/models/norm_stats.json)이 없습니다. export_onnx.py를 먼저 실행하세요.';
 let calls=0;
 for (const [ok,type] of [[false,'application/json'],[true,'text/html; charset=utf-8'],[true,'']]) {
  t.mock.method(globalThis,'fetch',async url=>{
   calls++;assert.equal(url,'/models/norm_stats.json');
   return {ok,headers:new Headers({'content-type':type}),json(){throw new Error('Must not parse');}};
  });
  const controller=new RocketRLController();
  t.mock.method(console,'warn',()=>{});
  assert.equal(await controller.init(),controller);
  assert.equal(controller.isReady,false);
  assert.equal(controller.loadStatus,'unavailable');
  assert.equal(controller.loadMessage,expected);
  assert.equal(controller._initPromise,null);
  t.mock.restoreAll();
 }
 assert.equal(calls,3); // No physics_config HTTP request.
});
test('invalid JSON/schema resolves unavailable; missing ONNX and HTML bodies are detected',async t=>{
 const stats={obs_mean:Array(7).fill(0),obs_var:Array(7).fill(1),epsilon:1e-8,clip_obs:10};
 for (const scenario of ['bad-json','bad-schema','missing-onnx','html-onnx']) {
  t.mock.method(console,'warn',()=>{});
  t.mock.method(globalThis,'fetch',async url=>{
    if (url.endsWith('.json')) return new Response(scenario==='bad-json'?'{bad':scenario==='bad-schema'?'null':JSON.stringify(stats),{headers:{'content-type':'application/json'}});
    return scenario==='missing-onnx'?new Response('',{status:404}):new Response('<!doctype html><html>',{headers:{'content-type':'application/octet-stream'}});
  });
  const c=new RocketRLController();await c.init();
  assert.equal(c.isReady,false);assert.equal(c.loadStatus,'unavailable');assert.equal(c.session,null);
  assert.ok(c.loadMessage.length>0);assert.equal(c._initPromise,null);
  t.mock.restoreAll();
 }
});
