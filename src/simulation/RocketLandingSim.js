import RocketRLController from '../ai/RocketRLController.js';

/** Discrete simulation counterpart to rl-pipeline/env/rocket_landing_env.py.
 * step() is async: await it once per simulation tick, not once per render frame.
 * State is float64 JS Number; only policy observations are converted to float32.
 * A timeout is truncated=true, status=FLYING (not a fabricated crash).
 */
export class RocketLandingSim {
  constructor(controller = new RocketRLController()) {
    this.controller = controller;
    this.config = null;
    this.state = null;
    this.stepCount = 0;
    this._stepping = false;
    this.windSpeed = 0;
  }

  async init() {
    await this.controller.init();
    this.config = this.controller.config;
    return this;
  }

  reset(initialState) {
    if (!this.config) throw new Error('Call init() first');
    if (this._stepping) throw new Error('Await the pending step before reset');
    // Supply the same initial state as Python for trajectory comparison.
    // This deterministic default does not reproduce Python's random reset.
    const s = initialState ?? [0, 200, 0, -10, 0, 0, this.config.initial_fuel_mass];
    const values = Array.isArray(s) || ArrayBuffer.isView(s) ? Array.from(s) :
      [s.x, s.y, s.vx, s.vy, s.theta, s.omega, s.fuel];
    if (values.length !== 7 || !values.every(Number.isFinite)) throw new Error('Invalid initial state');
    const [x,y,vx,vy,theta,omega,fuel] = values;
    if (y <= 0 || Math.abs(x) > 150 || Math.abs(theta) > 1.2 || fuel < 0 || fuel > this.config.initial_fuel_mass)
      throw new Error('Initial state is outside the active episode bounds');
    this.state = {x,y,vx,vy,theta,omega,fuel, status:'FLYING', time:0,
      thrust:0, thrustRatio:0, gimbalRad:0, reward:0, outcome:'running',
      terminated:false, truncated:false, done:false, isSuccess:false};
    this.stepCount = 0;
    return this.getState();
  }

  setWindSpeed(speed) {
    if (!Number.isFinite(speed)) throw new Error('Wind speed must be finite');
    this.windSpeed = speed;
  }

  getState() { return this.state ? {...this.state} : null; }

  async step(fixedDt = this.config?.dt, manualAction = null) {
    if (!this.state) throw new Error('Call init() and reset() first');
    if (this._stepping) throw new Error('Concurrent step() calls are not allowed');
    if (this.state.done) throw new Error('Episode ended; call reset()');
    if (!Number.isFinite(fixedDt) || Math.abs(fixedDt-this.config.dt) > 1e-12)
      throw new Error('fixedDt must equal physics_config.dt');
    this._stepping = true;
    try {
      const old = this.state, c = this.config, dt = c.dt;
      const windSpeed = this.windSpeed;
      let a;
      if (manualAction !== null) {
        if (![manualAction.thrustRatio,manualAction.gimbalRad].every(Number.isFinite))
          throw new Error('Manual action must contain finite thrustRatio and gimbalRad');
        const ratio=Math.max(0,Math.min(1,manualAction.thrustRatio));
        const limit=c.max_gimbal_deg*Math.PI/180;
        a={thrust:old.fuel>0?c.max_thrust*ratio:0,thrustRatio:old.fuel>0?ratio:0,
          gimbalRad:Math.max(-limit,Math.min(limit,manualAction.gimbalRad))};
      } else {
        a = await this.controller.predictAction([
          old.x,old.y,old.vx,old.vy,old.theta,old.omega,old.fuel,
        ]);
      }
      const {thrust,thrustRatio,gimbalRad} = a;
      if (![thrust,thrustRatio,gimbalRad].every(Number.isFinite)) throw new Error('Invalid action');
      const mass = c.dry_mass+old.fuel;
      const fx = -thrust*Math.sin(old.theta+gimbalRad) + mass*c.wind_acceleration_per_mps*windSpeed;
      const fy = thrust*Math.cos(old.theta+gimbalRad)-mass*c.gravity;
      const torque = -thrust*Math.sin(gimbalRad)*(c.rocket_length/2);
      // Explicit Euler, using OLD velocities and OLD mass throughout.
      const x=old.x+old.vx*dt, y=old.y+old.vy*dt;
      const vx=old.vx+fx/mass*dt, vy=old.vy+fy/mass*dt;
      const theta=old.theta+old.omega*dt, omega=old.omega+torque/c.moment_of_inertia*dt;
      const fuelUsed=Math.min(old.fuel,thrust*c.fuel_consumption_rate*dt);
      const fuel=Math.max(0,old.fuel-fuelUsed);
      if (![x,y,vx,vy,theta,omega,fuel].every(Number.isFinite)) throw new Error('Non-finite physics state');
      const contact=y<=0;
      const success=contact&&Math.abs(x)<2.5&&Math.abs(vy)<2.5&&Math.abs(vx)<1.5&&Math.abs(theta)<.1;
      const outside=Math.abs(x)>150||Math.abs(theta)>1.2;
      const terminated=success||contact||outside;
      const count=this.stepCount+1, truncated=count>=600&&!terminated;
      const distance=Math.hypot(x,y), speed=Math.hypot(vx,vy);
      const dense=-.05*distance-.1*speed-.5*Math.abs(theta)-.02*thrustRatio;
      const bonus=success?200:terminated?-100:0;
      this.stepCount=count;
      this.state={x,y,vx,vy,theta,omega,fuel,time:count*dt,thrust,thrustRatio,gimbalRad,
        torque,forceX:fx,forceY:fy,fuelUsed,distanceToPad:distance,speed,
        reward:dense+bonus,rewardDense:dense,rewardTerminal:bonus,
        status:success?'LANDED':terminated?'CRASHED':'FLYING',
        outcome:success?'landed':contact?'crashed':outside?'out_of_bounds':truncated?'time_limit':'running',
        terminated,truncated,done:terminated||truncated,isSuccess:success};
      return this.getState();
    } finally { this._stepping=false; }
  }
}

/* Three.js integration (rocket model's long axis must be local +Y):
 * const sim = await new RocketLandingSim().init();
 * let state = sim.reset();
 * At each fixed simulation tick, await sim.step(0.05), then:
 * rocket.position.set(state.x, state.y, 0);
 * rocket.rotation.z = state.theta;
 * nozzle.rotation.z = state.gimbalRad; // nozzle is a child of rocket
 * flame.visible = state.thrust > 0;
 * flame.scale.y = state.thrust > 0 ? state.thrustRatio : 0;
 *
 * Render animate() independently. Use ONE serialized async simulation loop
 * or an accumulator with an in-flight guard; do not fire unawaited step calls
 * from every requestAnimationFrame. Pause the simulation when state.done.
 * Visual meshes never feed back into physics. Do not clamp y or theta here.
 * When resuming, do not accumulate hidden-tab elapsed time into many steps.
 */
export default RocketLandingSim;
