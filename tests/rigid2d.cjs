'use strict';
const assert=require('node:assert/strict'),R=require('../physics/rigid2d.cjs');
const base={x:0,z:0,vx:2,vz:3,angle:.2,omega:.4,mass:2,inertia:3};
const close=(a,b,t=1e-10)=>assert(Math.abs(a-b)<t,`${a} != ${b}`);
let b=R.step(base,0,2);close(b.x,4);close(b.z,6);close(b.angle,1);close(b.omega,.4);assert.equal(base.x,0);
// Constant center force and a world-aligned force couple: fixed torque.
const loads=(t,s)=>{const force=R.rotate({x:0,z:3},s.angle);return [{force:{x:4,z:-6}},{point:{x:1,z:0},force},{point:{x:-1,z:0},force:{x:-force.x,z:-force.z}}];};
b=R.step(base,0,2,loads);close(b.x,8);close(b.z,0);close(b.vx,6);close(b.vz,-3);close(b.angle,5);close(b.omega,4.4);
const parts=[{mass:2,inertia:.2,offset:{x:0,z:-1}},{mass:1,inertia:.1,offset:{x:0,z:2}}];
const props=R.properties(parts),parent={...base,x:7,z:8,mass:props.mass,inertia:props.inertia,angle:.73,omega:1.2};
const children=R.release(parent,parts),before=R.diagnostics(parent),after=R.sumDiagnostics(children);
for(const k of Object.keys(before))close(before[k],after[k]);
assert.notEqual(children[0].vx,children[1].vx);
const pv=R.pointVelocity({...base,angle:0},{x:2,z:0});close(pv.z,3.8);
// Oscillator has an independent closed-form solution; smooth RK4 convergence.
function error(dt){let s={...base,x:1,z:0,vx:0,vz:0,angle:0,omega:0,mass:1,inertia:1};const n=Math.round(2/dt);for(let i=0;i<n;i++)s=R.step(s,i*dt,dt,(t,b)=>[{force:{x:-b.x,z:0}}]);return Math.hypot(s.x-Math.cos(2),s.vx+Math.sin(2));}
const errors=[.2,.1,.05].map(error);assert(errors[0]/errors[1]>14);assert(errors[1]/errors[2]>14);
assert.throws(()=>R.step({...base,mass:0},0,.1));assert.throws(()=>R.step(base,0,0));assert.throws(()=>R.release({...parent,inertia:1},parts));
console.log(JSON.stringify({checks:'free motion, analytic force/torque, release P/L/energy, point velocity, RK4 convergence, invalid input',oscillatorErrors:errors,releaseResiduals:Object.fromEntries(Object.keys(before).map(k=>[k,after[k]-before[k]]))},null,2));
