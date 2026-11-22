import * as THREE from 'three';

/** Visual reference only: constant gravity, no thrust, drag or attitude control. */
export class TrajectoryVisualizer {
  constructor(scene, {gravity = 9.81, maxPoints = 1200} = {}) {
    if (!Number.isFinite(gravity) || gravity <= 0 || !Number.isInteger(maxPoints) || maxPoints < 2)
      throw new Error('Positive gravity and maxPoints >= 2 required');
    this.scene = scene; this.gravity = gravity; this.maxPoints = maxPoints;
    this.positions = new Float32Array(maxPoints*3);
    this.lineGeo = new THREE.BufferGeometry();
    this.lineGeo.setAttribute('position',new THREE.BufferAttribute(this.positions,3).setUsage(THREE.DynamicDrawUsage));
    this.lineMat = new THREE.LineBasicMaterial({color:0x38bdf8,transparent:true,opacity:.8});
    this.trajectoryLine = new THREE.Line(this.lineGeo,this.lineMat);
    this.trajectoryLine.frustumCulled = false;
    this.iipGroup = new THREE.Group(); this.iipGroup.position.y = .22;
    this.ringMat = new THREE.MeshBasicMaterial({color:0xef4444,side:THREE.DoubleSide,transparent:true,opacity:.9});
    this.iipRing = new THREE.Mesh(new THREE.RingGeometry(1.1,1.55,32).rotateX(-Math.PI/2),this.ringMat);
    this.iipCenter = new THREE.Mesh(new THREE.RingGeometry(.15,.35,16).rotateX(-Math.PI/2),this.ringMat);
    this.iipGroup.add(this.iipRing,this.iipCenter);
    this.projGeo = new THREE.BufferGeometry();
    this.projGeo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(6),3).setUsage(THREE.DynamicDrawUsage));
    this.projGeo.setAttribute('lineDistance',new THREE.BufferAttribute(new Float32Array(2),1).setUsage(THREE.DynamicDrawUsage));
    this.projMat = new THREE.LineDashedMaterial({color:0xef4444,dashSize:2,gapSize:1.5,transparent:true,opacity:.55});
    this.projLine = new THREE.Line(this.projGeo,this.projMat); this.projLine.frustumCulled = false;
    scene.add(this.trajectoryLine,this.iipGroup,this.projLine);
    this.reset();
  }

  reset() {
    this.pointCount = 0; this.lastTime = null; this.prediction = null;
    this.lineGeo.setDrawRange(0,0);
    this.iipGroup.visible = this.projLine.visible = false;
  }

  // Call once per completed physics tick, including the terminal tick.
  // nozzlePosition is the actual nozzle exit in WORLD coordinates.
  // If omitted, records the simulated point instead (not a nozzle estimate).
  recordStep(state, nozzlePosition = state) {
    if (!state || !nozzlePosition) return;
    if (Number.isFinite(state.time) && state.time === this.lastTime) return;
    const {x,y} = nozzlePosition, z = nozzlePosition.z ?? 0;
    if (![x,y,z].every(Number.isFinite)) return;
    if (this.pointCount === this.maxPoints) this.positions.copyWithin(0,3);
    else this.pointCount++;
    const i = (this.pointCount-1)*3;
    this.positions[i]=x; this.positions[i+1]=y; this.positions[i+2]=z;
    this.lastTime = Number.isFinite(state.time) ? state.time : null;
    this.lineGeo.setDrawRange(0,this.pointCount);
    this.lineGeo.attributes.position.needsUpdate = true;
  }

  updatePrediction(state, elapsedTime = 0) {
    this.prediction = null;
    if (!state || state.done || state.truncated || state.status !== 'FLYING' || state.y <= 0 ||
        ![state.x,state.y,state.vx,state.vy].every(Number.isFinite)) {
      this.iipGroup.visible = this.projLine.visible = false; return null;
    }
    const {x,y,vx,vy}=state;
    const root = Math.sqrt(vy*vy+2*this.gravity*y);
    // Algebraically equivalent positive root; avoids cancellation for fast descent.
    const tImpact = vy < 0 ? 2*y/(root-vy) : (vy+root)/this.gravity;
    const xImpact = x+vx*tImpact;
    if (!Number.isFinite(tImpact) || !Number.isFinite(xImpact)) {
      this.iipGroup.visible = this.projLine.visible = false; return null;
    }
    const offset=Math.abs(xImpact);
    const color=offset<=2.5?0x10b981:offset<=12?0xf59e0b:0xef4444;
    this.iipGroup.visible = this.projLine.visible = true;
    this.iipGroup.position.x=xImpact;
    const pulse=1+Math.sin(elapsedTime*8)*.08;
    this.iipRing.scale.set(pulse,1,pulse);
    this.ringMat.color.setHex(color);this.projMat.color.setHex(color);
    const p=this.projGeo.attributes.position;
    p.setXYZ(0,x,y,0);p.setXYZ(1,xImpact,.22,0);p.needsUpdate=true;
    // Straight guide to the predicted point, NOT a predicted ballistic arc.
    const d=this.projGeo.attributes.lineDistance;
    d.setX(0,0);d.setX(1,Math.hypot(xImpact-x,y-.22));d.needsUpdate=true;
    this.prediction={tImpact,xImpact,color};return this.prediction;
  }

  dispose() {
    this.scene.remove(this.trajectoryLine,this.iipGroup,this.projLine);
    this.lineGeo.dispose();this.lineMat.dispose();this.projGeo.dispose();this.projMat.dispose();
    this.iipRing.geometry.dispose();this.iipCenter.geometry.dispose();this.ringMat.dispose();
  }
}
