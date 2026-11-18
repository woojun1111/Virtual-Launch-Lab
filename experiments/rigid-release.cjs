'use strict';
// Generic two-body release benchmark, not a vehicle trajectory model.
const R=require('../physics/rigid2d.cjs');
const parts=[{mass:2,inertia:.2,offset:{x:0,z:-1}},{mass:1,inertia:.1,offset:{x:0,z:2}}];
const p=R.properties(parts);
let bodies=[{mass:p.mass,inertia:p.inertia,x:0,z:0,vx:1,vz:2,angle:0,omega:.4}];
const dt=.01;
console.log('time,body,x,z,vx,vz,angle,omega,mass,inertia');
for(let i=0;i<=300;i++){
 const t=i*dt;
 if(i===100)bodies=R.release(bodies[0],parts);
 bodies.forEach((b,j)=>console.log([t.toFixed(2),j,b.x,b.z,b.vx,b.vz,b.angle,b.omega,b.mass,b.inertia].join(',')));
 if(i<300)bodies=bodies.map(b=>R.step(b,t,dt));
}
