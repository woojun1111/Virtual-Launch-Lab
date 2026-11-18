'use strict';
// Generic fixed-mass planar rigid bodies. No flight guidance or propulsion model.
const cross=(a,b)=>a.x*b.z-a.z*b.x;
const rotate=(p,a)=>({x:Math.cos(a)*p.x-Math.sin(a)*p.z,z:Math.sin(a)*p.x+Math.cos(a)*p.z});
function validate(b){
 for(const k of ['x','z','vx','vz','angle','omega','mass','inertia'])if(!Number.isFinite(b[k]))throw Error(`Non-finite ${k}`);
 if(b.mass<=0||b.inertia<=0)throw Error('Mass and inertia must be positive');
}
function wrench(b,loads=[]){
 let fx=0,fz=0,torque=0;
 for(const {force,point={x:0,z:0}} of loads){
  if(![force.x,force.z,point.x,point.z].every(Number.isFinite))throw Error('Invalid load');
  // Force in world coordinates; point is body-local relative to center of mass.
  const r=rotate(point,b.angle);fx+=force.x;fz+=force.z;torque+=cross(r,force);
 }
 return {fx,fz,torque};
}
const fields=['x','z','vx','vz','angle','omega'];
function derivative(b,t,loads){const w=wrench(b,loads(t,{...b}));return [b.vx,b.vz,w.fx/b.mass,w.fz/b.mass,b.omega,w.torque/b.inertia];}
function shifted(b,k,h){const n={...b};fields.forEach((f,i)=>n[f]+=h*k[i]);return n;}
function step(b,t,dt,loads=()=>[]){
 validate(b);if(!Number.isFinite(t)||!Number.isFinite(dt)||dt<=0)throw Error('Invalid time step');
 const a=derivative(b,t,loads),c=derivative(shifted(b,a,dt/2),t+dt/2,loads),d=derivative(shifted(b,c,dt/2),t+dt/2,loads),e=derivative(shifted(b,d,dt),t+dt,loads);
 const n={...b};fields.forEach((f,i)=>n[f]+=dt*(a[i]+2*c[i]+2*d[i]+e[i])/6);validate(n);return n;
}
function diagnostics(b){validate(b);return {px:b.mass*b.vx,pz:b.mass*b.vz,L:b.inertia*b.omega+b.mass*(b.x*b.vz-b.z*b.vx),energy:.5*b.mass*(b.vx*b.vx+b.vz*b.vz)+.5*b.inertia*b.omega*b.omega};}
function sumDiagnostics(bodies){return bodies.map(diagnostics).reduce((a,b)=>Object.fromEntries(Object.keys(a).map(k=>[k,a[k]+b[k]])),{px:0,pz:0,L:0,energy:0});}
function properties(parts){
 if(!Array.isArray(parts)||parts.length<2)throw Error('At least two parts required');
 for(const p of parts)if(![p.mass,p.inertia,p.offset.x,p.offset.z].every(Number.isFinite)||p.mass<=0||p.inertia<=0)throw Error('Invalid part');
 const mass=parts.reduce((s,p)=>s+p.mass,0);
 const center={x:parts.reduce((s,p)=>s+p.mass*p.offset.x,0)/mass,z:parts.reduce((s,p)=>s+p.mass*p.offset.z,0)/mass};
 const inertia=parts.reduce((s,p)=>s+p.inertia+p.mass*((p.offset.x-center.x)**2+(p.offset.z-center.z)**2),0);
 return {mass,inertia,center};
}
function release(parent,parts){
 validate(parent);const p=properties(parts),tol=1e-9;
 if(Math.abs(p.mass-parent.mass)>tol*Math.max(1,p.mass)||Math.abs(p.inertia-parent.inertia)>tol*Math.max(1,p.inertia)||Math.hypot(p.center.x,p.center.z)>tol)throw Error('Parts must match parent mass, inertia and center');
 return parts.map(part=>{const r=rotate(part.offset,parent.angle);return {mass:part.mass,inertia:part.inertia,x:parent.x+r.x,z:parent.z+r.z,vx:parent.vx-parent.omega*r.z,vz:parent.vz+parent.omega*r.x,angle:parent.angle,omega:parent.omega};});
}
function pointVelocity(b,local){validate(b);const r=rotate(local,b.angle);return {x:b.vx-b.omega*r.z,z:b.vz+b.omega*r.x};}
module.exports={rotate,cross,wrench,step,diagnostics,sumDiagnostics,properties,release,pointVelocity};
