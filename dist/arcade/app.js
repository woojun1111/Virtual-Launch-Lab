'use strict';
const $=id=>document.getElementById(id), L=new Arcade.Learner(),ctx=$('scene').getContext('2d');
let busy=false,history=[],evaluation=null,replay=null,frame=0;
const pct=x=>(100*x).toFixed(1)+'%';
function message(s){$('message').textContent=s;}
function update(){ $('episode').textContent=`학습 ${L.episodes.toLocaleString()}회`; }
function chart(){const c=$('chart'),g=c.getContext('2d');g.clearRect(0,0,c.width,c.height);g.strokeStyle='#30445c';g.strokeRect(35,10,800,140);g.fillStyle='#90a8c1';g.fillText('100%',0,20);g.fillText('0%',8,150);if(!history.length)return;g.beginPath();g.strokeStyle='#78e6c9';history.forEach((v,i)=>{const x=35+i/Math.max(1,history.length-1)*800,y=150-v.successRate*140;i?g.lineTo(x,y):g.moveTo(x,y);});g.stroke();}
function evaluate(){evaluation={version:Arcade.VERSION,episodes:L.episodes,policy:L.evaluate(),random:L.evaluate(260,90001,true)};const p=evaluation.policy,r=evaluation.random;$('metrics').textContent=`고정 평가 260회 · seed 90001\n학습 정책 성공 ${pct(p.successRate)} / 평균 손상 ${pct(p.meanDamage)}\n무작위 성공 ${pct(r.successRate)} / 평균 손상 ${pct(r.meanDamage)}`;$('metrics').style.whiteSpace='pre-line';return evaluation;}
$('train').onclick=()=>{if(busy)return;busy=true;$('train').disabled=true;$('reset').disabled=true;$('load').disabled=true;let left=20000;function batch(){if(!busy||left===0){busy=false;$('train').disabled=false;$('reset').disabled=false;$('load').disabled=false;evaluate();message('학습 종료. 고정 평가 조건의 결과를 확인하세요.');return;}history.push(L.train(200));left-=200;update();chart();message(`학습 중 · 이번 실행 ${20000-left} / 20,000`);setTimeout(batch,0);}batch();};
$('stop').onclick=()=>{busy=false;};$('evaluate').onclick=evaluate;
$('reset').onclick=()=>{if(busy)return;L.q={};L.episodes=0;L.random=Arcade.rng(42);history=[];evaluation=null;replay=null;update();chart();$('metrics').textContent='평가 전';$('result').textContent='접촉 전';message('학습 모델을 초기화했습니다.');};
function download(name,data){const a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('save').onclick=()=>download('arcade-q-policy.json',L.snapshot());
$('export').onclick=()=>download('arcade-evaluation.json',evaluate());
$('load').onchange=async e=>{try{const file=e.target.files[0];if(!file)return;if(file.size>10000000)throw Error('파일이 너무 큽니다.');L.restore(JSON.parse(await file.text()));history=[];replay=null;update();chart();evaluate();message('모델을 불러왔습니다. 이어 학습하면 난수열은 저장된 seed에서 다시 시작합니다.');}catch(err){message('불러오기 실패: '+err.message);}};
$('play').onclick=()=>{const random=Arcade.rng(Number($('seed').value)>>>0);let s=Arcade.reset(random);const states=[{...s}],actions=[];let result;
 // Freeze the policy rollout at click time; training cannot alter the playback.
 while(!s.done){const a=$('policy').value==='random'?Math.floor(random()*4):L.action(s);result=Arcade.step(s,a);actions.push(a);s=result.state;states.push({...s});}
 replay={start:performance.now(),states,actions,result};$('result').textContent='재생 중';};
function rocket(x,y,angle,color,flame,upper=false){ctx.save();ctx.translate(x,y);ctx.rotate(angle);if(flame){ctx.fillStyle='#ffb95b';ctx.beginPath();ctx.moveTo(-7,21);ctx.lineTo(0,44+5*Math.sin(frame*.6));ctx.lineTo(7,21);ctx.fill();}ctx.fillStyle=color;ctx.beginPath();ctx.moveTo(-8,20);ctx.lineTo(-8,-17);ctx.lineTo(0,-29);ctx.lineTo(8,-17);ctx.lineTo(8,20);ctx.closePath();ctx.fill();ctx.fillStyle='#3a556a';ctx.fillRect(-8,0,16,5);if(!upper){ctx.beginPath();ctx.moveTo(-8,11);ctx.lineTo(-17,25);ctx.lineTo(17,25);ctx.lineTo(8,11);ctx.fill();}ctx.restore();}
function position(s){return {x:500+s.x*32,y:535-s.h*23};}
function draw(now){frame++;const w=1000,h=620;ctx.clearRect(0,0,w,h);const grad=ctx.createLinearGradient(0,0,0,h);grad.addColorStop(0,'#091321');grad.addColorStop(1,'#1b3450');ctx.fillStyle=grad;ctx.fillRect(0,0,w,h);ctx.fillStyle='#99bcd0';for(let i=0;i<60;i++)ctx.fillRect((i*137)%997,(i*79)%470,1.5,1.5);ctx.strokeStyle='#213f55';for(let x=180;x<=820;x+=32){ctx.beginPath();ctx.moveTo(x,80);ctx.lineTo(x,555);ctx.stroke();}ctx.fillStyle='#243b49';ctx.fillRect(0,558,w,62);ctx.fillStyle='#657f8a';ctx.fillRect(130,550,80,8);
 let landed=false,success=false;
 if(replay){const t=(now-replay.start)/1000,initial=position(replay.states[0]);
 if(t<4){const p=t/4,e=p*p*(3-2*p),x=170+(initial.x-170)*e,y=535+(initial.y-535)*e-120*Math.sin(Math.PI*p);rocket(x,y,.55*Math.sin(Math.PI*p),'#e1eced',true);rocket(x-22*Math.sin(.55*Math.sin(Math.PI*p)),y-42*Math.cos(.55*Math.sin(Math.PI*p)),.55*Math.sin(Math.PI*p),'#93abc4',false,true);$('phase').textContent='상승 · 곡선 경로 연출';}
 else{const dt=t-4,k=Math.min(replay.states.length-1,Math.floor(dt/.5)),f=Math.min(1,dt/.5-k),s=replay.states[k],n=replay.states[Math.min(k+1,replay.states.length-1)],a=replay.actions[k]??0,p=position(s),q=position(n);landed=k===replay.states.length-1;success=landed&&replay.result.success;
 ctx.strokeStyle='#7ee8ca';ctx.beginPath();replay.states.slice(0,k+1).forEach((v,i)=>{const z=position(v);i?ctx.lineTo(z.x,z.y):ctx.moveTo(z.x,z.y);});ctx.stroke();
 rocket(p.x+(q.x-p.x)*f,p.y+(q.y-p.y)*f,landed?0:(a===1?-.18:a===2?.18:0),'#e1eced',a===3&&!landed);rocket(initial.x+dt*32,initial.y-dt*30+dt*dt*2,.3,'#93abc4',false,true);
 $('phase').textContent=landed?'에피소드 종료':`착륙 게임 · ${Arcade.ACTIONS[a]} · 감속 자원 ${s.f}`;
 if(landed)$('result').textContent=`${success?'목표 착륙 성공':'회수 실패'} · 손상 점수 ${pct(replay.result.damage)} · 목표 오차 ${Math.abs(s.x)}칸 · 접촉 속도 단계 ${s.v}`;
 }}else{rocket(170,530,0,'#e1eced',false);$('phase').textContent='준비 · 학습 후 재생하세요';}
 ctx.fillStyle=landed?(success?'#7ee8ca':'#f08d79'):'#76b9c5';ctx.fillRect(450,555,100,5);ctx.font='14px system-ui';ctx.fillText('TARGET',470,586);ctx.fillStyle='#a8c1d4';ctx.fillText('고정 전체 시점 · 게임 격자 / 실제 단위 아님',25,30);requestAnimationFrame(draw);
}
update();chart();requestAnimationFrame(draw);
