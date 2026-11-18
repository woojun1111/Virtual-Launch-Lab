/* Classroom split-body gravity experiment; no impulses, rotations or guidance. */
(function(root){'use strict';const {Launch,P}=LaunchPhysics;
const assumptions=Object.freeze({splitTime:8,upperMass:2,upperArea:.01,boosterArea:.035,cd:.45});
class Sequence extends Launch{
 reset(){this.split=null;this.upper=null;this.booster=null;this.terminationReason=null;super.reset();}
 observe(){const o=super.observe();return {...o,separated:!!this.split,terminationReason:this.terminationReason,boosterImpactVelocity:this.booster?.impactVelocity??null,upperImpactVelocity:this.upper?.impactVelocity??null,separationTime:this.split?.time??null,boosterImpactTime:this.booster?.impactTime??null,upperImpactTime:this.upper?.impactTime??null,upperHeight:this.upper?.h??(o.height+1.5),upperVelocity:this.upper?.v??o.velocity,boosterHeight:this.booster?.h??o.height,boosterVelocity:this.booster?.v??o.velocity,upperGrounded:this.upper?.grounded??false,boosterGrounded:this.booster?.grounded??false,upperMass:this.upper?.mass??0,boosterMass:this.booster?.mass??o.mass};}
 step(dt){if(!Number.isFinite(dt)||dt<0||dt>1)throw Error('Invalid dt');if(this.state==='ready'||this.state==='complete')return this.out;let left=dt;
 while(left>1e-10&&this.state!=='complete'){let h=Math.min(.005,left);
 if(!this.split){const remaining=assumptions.splitTime-this.t;
 if(remaining>1e-9){h=Math.min(h,remaining);super.step(h);}else h=0;
 if(this.t>=assumptions.splitTime-1e-9&&this.state!=='complete'){
 if(!this.launched){this.cut=true;this.state='complete';this.terminationReason='no_liftoff';this.events.push({time:this.t,label:'이륙 실패 · 실험 중단',reason:'no_liftoff'});break;}

 this.split={time:this.t,height:this.h,velocity:this.v};const mass=P.dryMass+this.fuel;
 this.upper={h:this.h+1.5,v:this.v,mass:assumptions.upperMass,area:assumptions.upperArea,grounded:false};
 this.booster={h:this.h,v:this.v,mass:mass-assumptions.upperMass,area:assumptions.boosterArea,grounded:false};this.cut=true;this.state='separated';this.events.push({time:this.t,label:'연소 종료 · 단분리 (가정 시점)'});
 }}else{this.t+=h;for(const [name,b] of [['상단',this.upper],['추진체',this.booster]]){if(b.grounded)continue;const oldV=b.v,oldH=b.h;const acc=v=>-P.g-.5*P.rho*assumptions.cd*b.area*v*Math.abs(v)/b.mass;const a=acc(b.v),midV=b.v+a*h/2;b.h+=midV*h;b.v+=acc(midV)*h;
 if(oldV>0&&b.v<=0)this.events.push({time:this.t,label:name+' 최고점 · 낙하 시작'});
 if(b.h<=0){const fraction=Math.max(0,Math.min(1,oldH/(oldH-b.h)));
 b.impactTime=this.t-h+fraction*h;b.impactVelocity=oldV+fraction*(b.v-oldV);
 b.h=0;b.v=0;b.grounded=true;this.events.push({time:b.impactTime,label:name+' 지면 도달 (충돌 후 정지)',body:name,impactVelocity:b.impactVelocity,impactTime:b.impactTime});}}
 this.h=this.booster.h;this.v=this.booster.v;this.peak=Math.max(this.peak,this.h);
 if(this.upper.grounded&&this.booster.grounded)this.terminationReason='ground_contact';
 this.state=this.upper.grounded&&this.booster.grounded?'complete':this.booster.grounded?'upper_fall':this.booster.v<0?'falling':'separated';
 }left-=h;}const o=this.observe();if(this.split){const b=this.booster,D=.5*P.rho*assumptions.cd*b.area*b.v*Math.abs(b.v);Object.assign(o,{mass:b.mass,thrust:0,weight:b.mass*P.g,drag:D,acceleration:b.grounded?0:-P.g-D/b.mass});}return this.out=o;
 }
}
root.Staging={Sequence,assumptions};
})(globalThis);
