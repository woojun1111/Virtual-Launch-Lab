/* Classroom split-body gravity experiment; no impulses, rotations or guidance. */
(function(root){'use strict';const {Launch,P}=LaunchPhysics;
const assumptions=Object.freeze({splitTime:8,upperMass:2,upperArea:.01,boosterArea:.035,cd:.45});
class Sequence extends Launch{
 reset(){this.split=null;this.upper=null;this.booster=null;super.reset();}
 observe(){const o=super.observe();return {...o,separated:!!this.split,separationTime:this.split?.time??null,boosterImpactTime:this.booster?.impactTime??null,upperImpactTime:this.upper?.impactTime??null,upperHeight:this.upper?.h??(o.height+1.5),upperVelocity:this.upper?.v??o.velocity,boosterHeight:this.booster?.h??o.height,boosterVelocity:this.booster?.v??o.velocity,upperGrounded:this.upper?.grounded??false,boosterGrounded:this.booster?.grounded??false,upperMass:this.upper?.mass??0,boosterMass:this.booster?.mass??o.mass};}
 step(dt){if(!Number.isFinite(dt)||dt<0||dt>1)throw Error('Invalid dt');if(this.state==='ready'||this.state==='complete')return this.out;let left=dt;
 while(left>1e-10&&this.state!=='complete'){let h=Math.min(.005,left);
 if(!this.split){h=Math.min(h,Math.max(1e-10,assumptions.splitTime-this.t));super.step(h);if(this.t>=assumptions.splitTime-1e-9&&this.launched&&this.state!=='complete'){
 this.split={time:this.t,height:this.h,velocity:this.v};const mass=P.dryMass+this.fuel;
 this.upper={h:this.h+1.5,v:this.v,mass:assumptions.upperMass,area:assumptions.upperArea,grounded:false};
 this.booster={h:this.h,v:this.v,mass:mass-assumptions.upperMass,area:assumptions.boosterArea,grounded:false};this.cut=true;this.state='separated';this.events.push({time:this.t,label:'연소 종료 · 단분리 (가정 시점)'});
 }}else{this.t+=h;for(const [name,b] of [['상단',this.upper],['추진체',this.booster]]){if(b.grounded)continue;const oldV=b.v;const acc=v=>-P.g-.5*P.rho*assumptions.cd*b.area*v*Math.abs(v)/b.mass;const a=acc(b.v),midV=b.v+a*h/2;b.h+=midV*h;b.v+=acc(midV)*h;
 if(oldV>0&&b.v<=0)this.events.push({time:this.t,label:name+' 최고점 · 낙하 시작'});
 if(b.h<=0){b.h=0;b.v=0;b.grounded=true;b.impactTime=this.t;this.events.push({time:this.t,label:name+' 지면 도달 (충돌 후 정지)'});}}
 this.h=this.booster.h;this.v=this.booster.v;this.peak=Math.max(this.peak,this.h);
 this.state=this.upper.grounded&&this.booster.grounded?'complete':this.booster.grounded?'upper_fall':this.booster.v<0?'falling':'separated';
 }left-=h;}const o=this.observe();if(this.split){const b=this.booster,D=.5*P.rho*assumptions.cd*b.area*b.v*Math.abs(b.v);Object.assign(o,{mass:b.mass,thrust:0,weight:b.mass*P.g,drag:D,acceleration:b.grounded?0:-P.g-D/b.mass});}return this.out=o;
 }
}
root.Staging={Sequence,assumptions};
})(globalThis);
