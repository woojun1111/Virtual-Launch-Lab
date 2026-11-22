/** Keyboard input only; actions are sampled once per fixed physics tick. */
export class ManualRocketController {
  constructor({maxGimbalDeg=15,minThrustRatio=.4,onToggleMode,target=globalThis.window}={}) {
    if (!Number.isFinite(maxGimbalDeg) || maxGimbalDeg<0 || !Number.isFinite(minThrustRatio) || minThrustRatio<0 || minThrustRatio>1)
      throw new Error('Invalid manual actuator limits');
    this.maxGimbalRad=maxGimbalDeg*Math.PI/180;this.minThrustRatio=minThrustRatio;
    this.onToggleMode=onToggleMode;this.target=target;this.keys=new Set();this.enabled=true;
    this.controlKeys=new Set(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space']);
    this.reset();
    this.onDown=e=>{
      if (e.ctrlKey || e.metaKey || e.altKey || e.target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(e.target?.tagName)) return;
      if (e.code==='KeyM' && !e.repeat) this.onToggleMode?.();
      if (this.enabled && this.controlKeys.has(e.code)) {e.preventDefault();this.keys.add(e.code);}
    };
    this.onUp=e=>{this.keys.delete(e.code);};
    this.onBlur=()=>this.keys.clear();
    target?.addEventListener('keydown',this.onDown);
    target?.addEventListener('keyup',this.onUp);
    target?.addEventListener('blur',this.onBlur);
  }
  reset(){this.keys.clear();this.currentGimbalNorm=0;this.throttleSetting=1;}
  setEnabled(enabled){this.enabled=enabled;this.keys.clear();}
  update(dt){
    if (!Number.isFinite(dt) || dt<=0) throw new Error('Positive dt required');
    const target=(this.keys.has('ArrowRight')?1:0)-(this.keys.has('ArrowLeft')?1:0);
    this.currentGimbalNorm+=(target-this.currentGimbalNorm)*Math.min(1,dt*14);
    const change=(this.keys.has('ArrowUp')?1:0)-(this.keys.has('ArrowDown')?1:0);
    this.throttleSetting=Math.max(this.minThrustRatio,Math.min(1,this.throttleSetting+change*dt*.8));
    const firing=this.enabled&&(this.keys.has('Space')||this.keys.has('ArrowUp'));
    return {thrustRatio:firing?this.throttleSetting:0,gimbalRad:this.currentGimbalNorm*this.maxGimbalRad,throttleSetting:this.throttleSetting};
  }
  dispose(){
    this.keys.clear();this.target?.removeEventListener('keydown',this.onDown);
    this.target?.removeEventListener('keyup',this.onUp);this.target?.removeEventListener('blur',this.onBlur);
    this.onToggleMode=null;
  }
}
