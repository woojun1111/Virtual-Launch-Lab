'use strict';
(function(){
const host=document.getElementById('view3d'),message=document.getElementById('webgl-message');
try{
 const T=THREE,scene=new T.Scene();scene.background=new T.Color('#0b1727');
 const renderer=new T.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));host.appendChild(renderer.domElement);message.style.display='none';
 const camera=new T.PerspectiveCamera(45,1,.1,20000),body=new T.Group();scene.add(body);
 scene.add(new T.HemisphereLight(0xe1f2ff,0x354656,2));const light=new T.DirectionalLight(0xffffff,2);light.position.set(20,40,30);scene.add(light);
 const white=new T.MeshStandardMaterial({color:0xe2e9ed,metalness:.35,roughness:.5}),dark=new T.MeshStandardMaterial({color:0x263c50,metalness:.6,roughness:.4});
 function mesh(geo,mat,x,y,z){const m=new T.Mesh(geo,mat);m.position.set(x,y,z);body.add(m);return m;}
 mesh(new T.CylinderGeometry(1.5,1.5,24,32),white,0,0,0);mesh(new T.CylinderGeometry(1.52,1.52,2,32),dark,0,7,0);mesh(new T.ConeGeometry(1.5,4,32),white,0,14,0);mesh(new T.CylinderGeometry(.7,1.25,2,24),dark,0,-13,0);
 for(let i=0;i<4;i++){const a=i*Math.PI/2,leg=mesh(new T.BoxGeometry(.4,5,.4),dark,2.3*Math.cos(a),-11.8,2.3*Math.sin(a));leg.rotation.z=-.4*Math.cos(a);leg.rotation.x=.4*Math.sin(a);}
 const flame=mesh(new T.ConeGeometry(.8,6,24),new T.MeshBasicMaterial({color:0xffb55c,transparent:true,opacity:.8}),0,-17,0);flame.rotation.z=Math.PI;
 const pad=new T.Mesh(new T.CylinderGeometry(20,20,.4,64),dark);scene.add(pad);scene.add(new T.GridHelper(1000,40,0x40666d,0x233d50));
 let mode='follow',state;
 function draw(s){state=s;body.position.set(s.x,s.z,0);body.rotation.z=-s.th;flame.visible=s.u>0;flame.scale.y=Math.max(.01,s.u);flame.position.y=-14-3*s.u;
 if(mode==='follow'){camera.position.set(s.x+48,s.z+25,70);camera.lookAt(body.position);}else{camera.position.set(70,25,90);camera.lookAt(s.x,s.z,0);}
 const w=Math.max(200,host.clientWidth),h=360;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();renderer.render(scene,camera);}
 window.renderRecorded3D=draw;document.getElementById('camera-follow').onclick=()=>{mode='follow';if(state)draw(state);};document.getElementById('camera-pad').onclick=()=>{mode='pad';if(state)draw(state);};window.addEventListener('resize',()=>{if(state)draw(state);});
}catch(e){message.textContent='3D를 표시할 수 없습니다. 아래 2D 기록 재생을 사용하세요.';}
})();
