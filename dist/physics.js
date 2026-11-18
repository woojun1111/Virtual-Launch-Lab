/* Synthetic classroom launch experiment. No real vehicle parameters or guidance. */
(function(root){'use strict';
const P=Object.freeze({dryMass:5,fuelMass:2,maxThrust:100,massRate:.12,g:9.81,rho:1.225,cd:.45,area:.035});
class Launch{
 constructor(){this.reset();}
 reset(){this.t=0;this.h=0;this.v=0;this.fuel=P.fuelMass;this.state='ready';this.launched=false;this.cut=false;this.peak=0;this.events=[];this.out=this.observe();}
 start(){if(this.state==='ready'){this.state='countdown';this.events.push({time:0,label:'카운트다운'});}}
 cutoff(){if(this.state!=='ready'&&this.state!=='complete'){this.cut=true;this.events.push({time:this.t,label:'수동 연소 종료'});}}
 forces(t=this.t,fuel=this.fuel,v=this.v){const elapsed=t-3,ramp=Math.max(0,Math.min(1,elapsed/.8));const burning=!this.cut&&elapsed>=0&&fuel>1e-10;const thrust=burning?P.maxThrust*ramp:0,mass=P.dryMass+fuel,weight=mass*P.g,drag=.5*P.rho*P.cd*P.area*v*Math.abs(v);return {thrust,mass,weight,drag,flow:burning?P.massRate*ramp:0};}
 step(dt){if(!Number.isFinite(dt)||dt<0||dt>1)throw Error('Invalid dt');if(this.state==='ready'||this.state==='complete')return this.out;let left=dt;
 while(left>1e-10&&this.state!=='complete'){const h=Math.min(.005,left),f0=this.forces(this.t+h/2),used=Math.min(this.fuel,f0.flow*h),fraction=f0.flow>0?used/(f0.flow*h):1;const mass=P.dryMass+this.fuel-used/2,F=f0.thrust*fraction-mass*P.g-f0.drag,a=F/mass;
 const oldV=this.v;this.h+=this.v*h+.5*a*h*h;this.v+=a*h;this.fuel=Math.max(0,this.fuel-used);this.t+=h;left-=h;
 if(this.h<=0){this.h=0;this.v=0;}
 if(!this.launched&&this.h>0){this.launched=true;this.events.push({time:this.t,label:'이륙'});}
 this.peak=Math.max(this.peak,this.h);
 const next=this.t<3?'countdown':this.cut||this.fuel<=1e-10?'coast':this.launched?'ascent':'ignition';
 if(next!==this.state&&['ignition','coast'].includes(next))this.events.push({time:this.t,label:next==='coast'?'연소 종료':'점화'});this.state=next;
 if((this.launched&&oldV>0&&this.v<=0)||this.t>=100||(this.cut&&!this.launched)){this.state='complete';this.events.push({time:this.t,label:'관찰 종료'});}
 }return this.out=this.observe();}
 observe(){const f=this.forces();const active=this.state!=='ready'&&this.state!=='countdown',thrust=active?f.thrust:0;return {time:this.t,height:this.h,velocity:this.v,fuel:this.fuel,mass:f.mass,thrust,weight:f.weight,drag:f.drag,acceleration:this.h>0?(thrust-f.weight-f.drag)/f.mass:Math.max(0,(thrust-f.weight-f.drag)/f.mass),state:this.state,peak:this.peak};}
}
root.LaunchPhysics={Launch,P};
})(globalThis);
