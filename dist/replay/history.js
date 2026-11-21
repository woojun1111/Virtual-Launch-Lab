'use strict';
fetch('training.json').then(r=>r.json()).then(rows=>{
 const slider=document.getElementById('generation'),canvas=document.getElementById('history'),g=canvas.getContext('2d');slider.max=rows.length-1;slider.value=rows.length-1;
 const returns=rows.map(r=>r.validationReturn),lo=Math.min(...returns),hi=Math.max(...returns);
 function draw(){const n=Number(slider.value),r=rows[n];g.clearRect(0,0,1000,260);g.strokeStyle='#38556e';g.strokeRect(40,20,920,200);
 for(const [color,fn] of [['#7ae7ce',r=>r.recovered],['#ffba68',r=>r.meanDamageProxy],['#7ba6ff',r=>(r.validationReturn-lo)/Math.max(1e-9,hi-lo)]]){g.strokeStyle=color;g.beginPath();rows.slice(0,n+1).forEach((r,i)=>{const x=40+920*i/(rows.length-1),y=220-200*fn(r);i?g.lineTo(x,y):g.moveTo(x,y);});g.stroke();}
 g.fillStyle='#d4e6f5';g.font='16px system-ui';g.fillText('0',10,225);g.fillText('1',10,25);g.fillText('세대 5 → 375',40,250);
 document.getElementById('generation-stats').textContent=`${r.totalGen}세대 · 검증 보상 ${r.validationReturn.toFixed(2)} · 성공 ${(100*r.recovered).toFixed(1)}% · 패드 ${(100*r.padHit).toFixed(1)}% · 평균 손상 ${r.meanDamageProxy.toFixed(3)}`;
 }slider.oninput=draw;draw();
}).catch(e=>{document.getElementById('generation-stats').textContent='학습 로그를 불러오지 못했습니다.';});
