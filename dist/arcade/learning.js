/* Independent tabular Q-learning implementation. See README for sources. */
(function(root){
'use strict';
const VERSION='arcade-grid-v1', ACTIONS=['대기','왼쪽','오른쪽','감속'];
function rng(seed){let n=seed>>>0;return()=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n/4294967296;};}
function reset(random){return {x:Math.floor(random()*13)-6,h:18,v:1,f:8,done:false};}
function key(s){return [s.x,s.h,s.v,s.f].join(',');}
function step(s,a){
 if(s.done)throw Error('Episode has ended');
 if(!Number.isInteger(a)||a<0||a>3)throw Error('Invalid action');
 let n={...s};
 if(a===1)n.x--; if(a===2)n.x++;
 if(a===3&&n.f>0){n.v=Math.max(1,n.v-1);n.f--;}else n.v=Math.min(3,n.v+1);
 n.h=Math.max(0,n.h-n.v);
 const outside=Math.abs(n.x)>10;
 n.done=outside||n.h===0;
 let damage=0,success=false,reason=null;
 let reward=-.2+(Math.abs(s.x)-Math.abs(n.x))*.5-(a===3?.15:0);
 if(n.done){
  damage=outside?1:Math.min(1,Math.pow((n.v-1)/2,2));
  success=!outside&&Math.abs(n.x)<=1&&damage<=.05;
  reason=outside?'out_of_bounds':success?'landed':'failed_contact';
  reward+=(success?100:0)-100*damage-10*Math.abs(n.x)-(success?0:20);
 }
 return {state:n,reward,damage,success,reason};
}
class Learner{
 constructor(seed=42){this.q={};this.episodes=0;this.seed=seed;this.random=rng(seed);}
 values(s){return this.q[key(s)]||(this.q[key(s)]=[0,0,0,0]);}
 action(s,epsilon=0,random=this.random){if(random()<epsilon)return Math.floor(random()*4);const q=this.q[key(s)]||[0,0,0,0];return q.indexOf(Math.max(...q));}
 train(count=100){let wins=0,total=0,damage=0;
  for(let i=0;i<count;i++){
   let s=reset(this.random),r;
   const epsilon=Math.max(.08,.9*Math.exp(-this.episodes/12000));
   while(!s.done){const a=this.action(s,epsilon),q=this.values(s);r=step(s,a);q[a]+=.15*(r.reward+(r.state.done?0:.98*Math.max(...this.values(r.state)))-q[a]);total+=r.reward;s=r.state;}
   wins+=Number(r.success);damage+=r.damage;this.episodes++;
  }return {episodes:this.episodes,successRate:wins/count,meanReward:total/count,meanDamage:damage/count};
 }
 evaluate(count=260,seed=90001,randomPolicy=false){const random=rng(seed),actions=rng(seed+1);let wins=0,damage=0,reward=0;const results=[];
  for(let i=0;i<count;i++){let s=reset(random),r;const initial={...s};while(!s.done){r=step(s,randomPolicy?Math.floor(actions()*4):this.action(s));reward+=r.reward;s=r.state;}wins+=Number(r.success);damage+=r.damage;results.push({initial,final:s,success:r.success,damage:r.damage});}
  return {count,seed,successRate:wins/count,meanDamage:damage/count,meanReward:reward/count,results};
 }
 snapshot(){return {version:VERSION,episodes:this.episodes,seed:this.seed,q:this.q};}
 restore(data){
  if(data.version!==VERSION||!Number.isSafeInteger(data.episodes)||data.episodes<0||!data.q||typeof data.q!=='object'||Array.isArray(data.q))throw Error('Unsupported checkpoint');
  const q={};for(const [k,v] of Object.entries(data.q)){if(!/^-?\d+,\d+,\d+,\d+$/.test(k)||!Array.isArray(v)||v.length!==4||!v.every(Number.isFinite))throw Error('Invalid Q values');q[k]=v.slice();}
  this.q=q;this.episodes=data.episodes;this.seed=Number.isInteger(data.seed)?data.seed:42;this.random=rng(this.seed);
 }
}
root.Arcade={VERSION,ACTIONS,rng,reset,key,step,Learner};if(typeof module!=='undefined')module.exports=root.Arcade;
})(globalThis);
