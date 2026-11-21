(function(root){'use strict';
function rocket(){const T=root.THREE,g=new T.Group(),white=new T.MeshStandardMaterial({color:0xe0e9ed,metalness:.35,roughness:.3}),dark=new T.MeshStandardMaterial({color:0x263744,metalness:.7,roughness:.3}),silver=new T.MeshStandardMaterial({color:0x9eb6c5,metalness:.85,roughness:.2}),mint=new T.MeshStandardMaterial({color:0x5ce5c1,metalness:.35,roughness:.35});
const add=(geo,mat,y)=>{const m=new T.Mesh(geo,mat);m.position.y=y;m.castShadow=true;m.receiveShadow=true;g.add(m);return m;};
const shell=add(new T.CylinderGeometry(.14,.14,1.0,64,1,true),white,.99);const upperShell=add(new T.CylinderGeometry(.14,.14,.7,64),white.clone(),1.85);add(new T.CylinderGeometry(.142,.16,.22,64),dark,.39);
const profile=[];for(let i=0;i<=24;i++){const u=i/24;profile.push(new T.Vector2(.14*Math.sqrt(Math.max(0,1-u*u)),u*.46));}const nose=add(new T.LatheGeometry(profile,64),white,2.20);
for(const y of [.51,.95,1.70,2.19])add(new T.TorusGeometry(.143,.008,8,64),silver,y).rotation.x=Math.PI/2;
add(new T.CylinderGeometry(.144,.144,.11,64),dark,1.85);
const bell=add(new T.LatheGeometry([new T.Vector2(.10,0),new T.Vector2(.08,.06),new T.Vector2(.04,.15),new T.Vector2(.04,.20)],48),silver,.13);
for(let i=0;i<4;i++){const a=i*Math.PI/2,shape=new T.Shape();shape.moveTo(.13,0);shape.lineTo(.35,0);shape.lineTo(.15,.43);shape.closePath();const fin=new T.Mesh(new T.ExtrudeGeometry(shape,{depth:.014,bevelEnabled:true,bevelSegments:2,steps:1,bevelSize:.004,bevelThickness:.004}),dark);fin.position.y=.35;fin.rotation.y=a;fin.castShadow=true;g.add(fin);}
const tank=add(new T.CylinderGeometry(.118,.118,.85,40),new T.MeshStandardMaterial({color:0x36c7b0,transparent:true,opacity:.7,metalness:.15,roughness:.25}),1.00);
const stripe=add(new T.BoxGeometry(.08,.40,.008),mint,1.30);stripe.position.z=.144;
const plume=new T.Group();for(let i=0;i<3;i++){const mesh=new T.Mesh(new T.ConeGeometry(.085-i*.018,.8-i*.16,32,1,true),new T.MeshBasicMaterial({color:[0xffa24b,0x8ccaff,0xeaf9ff][i],transparent:true,opacity:.45+i*.1,depthWrite:false,side:T.DoubleSide,blending:T.AdditiveBlending}));mesh.rotation.z=Math.PI;mesh.position.y=-.25+i*.08;plume.add(mesh);}g.add(plume);
const booster=new T.Group(),upper=new T.Group();for(const child of [...g.children]){(child===nose||child===upperShell||child.position.y>1.55?upper:booster).add(child);}for(const child of upper.children)child.position.y-=1.5;upper.position.y=1.5;g.add(booster,upper);
return {group:g,booster,upper,shell,tank,plume,nose,bell};}
class View{
 constructor(container){const T=root.THREE;this.container=container;this.scene=new T.Scene();this.scene.fog=new T.FogExp2(0x102237,.006);this.camera=new T.PerspectiveCamera(38,1,.05,2000);this.renderer=new T.WebGLRenderer({antialias:true,alpha:true});this.renderer.setPixelRatio(Math.min(root.devicePixelRatio||1,1.75));this.renderer.outputColorSpace=T.SRGBColorSpace;this.renderer.toneMapping=T.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.25;this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=T.PCFSoftShadowMap;this.canvas=this.renderer.domElement;container.prepend(this.canvas);this.canvas.tabIndex=0;this.canvas.setAttribute('aria-label','로켓 3D 보기. 드래그 또는 방향키로 회전하고 휠 또는 +/-로 확대');
 this.scene.add(new T.HemisphereLight(0xc4e5ff,0x223c42,2.6));const sun=new T.DirectionalLight(0xffecd5,3.5);sun.position.set(6,10,8);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-7;sun.shadow.camera.right=7;sun.shadow.camera.top=7;sun.shadow.camera.bottom=-7;this.scene.add(sun);const rim=new T.DirectionalLight(0x65aaff,2);rim.position.set(-5,4,-5);this.scene.add(rim);
 this.rocket=rocket();this.scene.add(this.rocket.group);this.ground();this.trailPoints=[];this.line=new T.Line(new T.BufferGeometry(),new T.LineBasicMaterial({color:0x78ddc3,transparent:true,opacity:.35}));this.scene.add(this.line);
 const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(new Float32Array(180*3),3));this.smoke=new T.Points(geo,new T.PointsMaterial({color:0xb7c6cf,size:.12,transparent:true,opacity:.15,depthWrite:false}));this.scene.add(this.smoke);
 this.mode='facilities';this.illustration=true;this.lookTarget=null;this.theta=.8;this.phi=.18;this.distance=7.8;this.cutaway=false;this.showTrail=true;this.showExhaust=true;
 this.bind();this.resize=new ResizeObserver(()=>this.fit());this.resize.observe(container);this.fit();this.canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();const el=document.getElementById('render-error');el.hidden=false;el.textContent='그래픽 연결이 중단되었습니다. 페이지를 새로고침하세요.';});
 }
 ground(){const T=root.THREE,mat=new T.MeshStandardMaterial({color:0x273c4b,roughness:.9}),pad=new T.Mesh(new T.CylinderGeometry(2.2,2.4,.18,64),mat);pad.position.y=-.09;pad.receiveShadow=true;this.scene.add(pad);const land=new T.Mesh(new T.PlaneGeometry(1000,1000),new T.MeshStandardMaterial({color:0x142a35,roughness:1}));land.rotation.x=-Math.PI/2;land.position.y=-.2;land.receiveShadow=true;this.scene.add(land);const grid=new T.GridHelper(80,80,0x426075,0x243d4e);grid.position.y=-.19;this.scene.add(grid);
 const marks=[];for(let h=0;h<=160;h+=5){marks.push(new T.Vector3(-2.7,h,0),new T.Vector3(-2.7+(h%10===0?.45:.2),h,0));}marks.push(new T.Vector3(-2.7,0,0),new T.Vector3(-2.7,160,0));this.scene.add(new T.LineSegments(new T.BufferGeometry().setFromPoints(marks),new T.LineBasicMaterial({color:0x527489,transparent:true,opacity:.45})));

 for(const r of [1,1.8]){const m=new T.Mesh(new T.TorusGeometry(r,.012,8,100),new T.MeshBasicMaterial({color:0xc9a969}));m.rotation.x=Math.PI/2;m.position.y=.008;this.scene.add(m);}
 const structure=new T.MeshStandardMaterial({color:0x5a7488,metalness:.6,roughness:.5});for(const x of [-.22,.22])for(const z of [-.22,.22]){const m=new T.Mesh(new T.BoxGeometry(.05,3.3,.05),structure);m.position.set(x-1.1,1.65,z);m.castShadow=true;this.scene.add(m);}for(let i=0;i<8;i++){const m=new T.Mesh(new T.BoxGeometry(.5,.035,.5),structure);m.position.set(-1.1,i*.43,0);this.scene.add(m);}
 const recovery=new T.Group();recovery.name='recovery-pad';recovery.position.x=8;this.scene.add(recovery);this.recoveryPad=recovery;
 const deck=new T.Mesh(new T.CylinderGeometry(2.2,2.4,.18,64),new T.MeshStandardMaterial({color:0x25594e,roughness:.8}));deck.position.y=-.09;recovery.add(deck);
 const ring=new T.Mesh(new T.TorusGeometry(1.8,.025,8,80),new T.MeshBasicMaterial({color:0x85efd0}));ring.rotation.x=Math.PI/2;ring.position.y=.015;recovery.add(ring);
 for(const x of [-.45,.45]){const bar=new T.Mesh(new T.BoxGeometry(.12,.025,1.3),new T.MeshBasicMaterial({color:0xe0fff2}));bar.position.set(x,.02,0);recovery.add(bar);}
 const crossbar=new T.Mesh(new T.BoxGeometry(.9,.025,.12),new T.MeshBasicMaterial({color:0xe0fff2}));crossbar.position.y=.02;recovery.add(crossbar);
 const arm=new T.Mesh(new T.BoxGeometry(.75,.05,.08),structure);arm.position.set(-.7,2.25,0);this.scene.add(arm);
 }
 fit(){const r=this.container.getBoundingClientRect();if(!r.width||!r.height)return;this.camera.aspect=r.width/r.height;this.camera.updateProjectionMatrix();this.renderer.setSize(r.width,r.height,false);}
 bind(){let drag=null;this.canvas.addEventListener('pointerdown',e=>{drag=[e.clientX,e.clientY];this.canvas.setPointerCapture(e.pointerId);});this.canvas.addEventListener('pointermove',e=>{if(!drag)return;this.theta-=(e.clientX-drag[0])*.006;this.phi=Math.max(-.15,Math.min(1.3,this.phi+(e.clientY-drag[1])*.005));drag=[e.clientX,e.clientY];});for(const name of ['pointerup','pointercancel'])this.canvas.addEventListener(name,()=>drag=null);this.canvas.addEventListener('wheel',e=>{e.preventDefault();this.distance=Math.max(3,Math.min(30,this.distance*Math.exp(e.deltaY*.001)));},{passive:false});this.canvas.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','-','='].includes(e.key))return;e.preventDefault();if(e.key==='ArrowLeft')this.theta-=.1;if(e.key==='ArrowRight')this.theta+=.1;if(e.key==='ArrowUp')this.phi=Math.min(1.3,this.phi+.1);if(e.key==='ArrowDown')this.phi=Math.max(-.15,this.phi-.1);if(['+','='].includes(e.key))this.distance=Math.max(3,this.distance*.9);if(e.key==='-')this.distance=Math.min(30,this.distance*1.1);});}
 reset(){this.lookTarget=null;this.trailPoints=[];this.line.geometry.dispose();this.line.geometry=new THREE.BufferGeometry();}
 update(o,renderDt=1/60){const T=root.THREE,presentation=LaunchPresentation.pose(o,this.illustration);
 const poseStage=(group,height,center,p)=>{group.rotation.set(p.roll,0,p.angle);const pivot=new T.Vector3(0,center,0).applyQuaternion(group.quaternion);group.position.set(p.x-pivot.x,height+center-pivot.y,-pivot.z);group.updateMatrixWorld(true);
 // Render-only floor clearance; the model remains a point-contact simplification.
 const box=new T.Box3().setFromObject(group);if(box.min.y<0)group.position.y-=box.min.y;};
 poseStage(this.rocket.booster,o.boosterHeight??o.height,.8,presentation.booster);
 poseStage(this.rocket.upper,o.upperHeight??(o.height+1.5),.55,presentation.upper);
 this.rocket.shell.material.transparent=this.cutaway;this.rocket.shell.material.opacity=this.cutaway?.16:1;this.rocket.shell.material.depthWrite=!this.cutaway;this.rocket.tank.visible=this.cutaway;const f=Math.max(.001,o.fuel/2);this.rocket.tank.scale.y=f;this.rocket.tank.position.y=.575+.425*f;
 const strength=o.thrust/100;this.rocket.plume.visible=this.showExhaust&&strength>0;this.rocket.plume.scale.set(1,Math.max(.05,strength*(1+.07*Math.sin(o.time*44))),1);
 this.smoke.visible=this.showExhaust&&strength>0;const p=this.smoke.geometry.attributes.position;for(let i=0;i<p.count;i++){const u=(i*.618+o.time*.7)%1,a=i*2.4;p.setXYZ(i,Math.cos(a)*u*.75,o.height+.08-u*1.2,Math.sin(a)*u*.75);}p.needsUpdate=true;
 if(o.height>0&&(this.trailPoints.length===0||Math.abs(o.height-this.trailPoints[this.trailPoints.length-1].y)>.5)){this.trailPoints.push(new T.Vector3(0,o.height,0));this.line.geometry.dispose();this.line.geometry=new T.BufferGeometry().setFromPoints(this.trailPoints);}
 this.line.visible=this.showTrail;let target=o.height+1.2,tx=presentation.booster.x;let spread=0;
 if(this.mode==='upper'){target=(o.upperHeight??o.height)+1.8;tx=presentation.upper.x;}
 if(this.mode==='overview'){target=((o.upperHeight??o.height)+(o.boosterHeight??o.height))/2+1.2;tx=0;spread=Math.abs((o.upperHeight??o.height)-(o.boosterHeight??o.height))*1.8;}
 if(this.mode==='world'){target=Math.max(o.upperHeight??o.height,o.height)/2+1;tx=0;spread=Math.max(o.upperHeight??o.height,o.height)*1.8;}
 if(this.mode==='pad'){target=1.2;tx=0;}
 if(this.mode==='recovery'){target=1.2;tx=8;}
 if(this.mode==='facilities'){target=1.2;tx=4;spread=12;}
 const phi=this.mode==='top'?1.45:this.phi,dist=Math.max(this.distance,spread+5)*Math.max(1,1.25/this.camera.aspect);const desired=new T.Vector3(tx+Math.sin(this.theta)*Math.cos(phi)*dist,target+Math.sin(phi)*dist,Math.cos(this.theta)*Math.cos(phi)*dist),look=new T.Vector3(tx,target,0);
 if(!this.lookTarget){this.lookTarget=look;this.camera.position.copy(desired);}else{const alpha=1-Math.exp(-Math.max(0,renderDt)/.16);this.lookTarget.lerp(look,alpha);this.camera.position.lerp(desired,alpha);}this.camera.lookAt(this.lookTarget);
 this.renderer.render(this.scene,this.camera);

 }
}
root.LaunchScene={View,rocket};
})(globalThis);
