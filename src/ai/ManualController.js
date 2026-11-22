import config from '../../shared/physics_config.json';
/** User input, not a trained policy. Shares the PPO environment's actuator mapping. */
export class ManualController {
  constructor() { this.config = Object.freeze({...config}); this.rawThrust = 0; this.rawGimbal = 0; }
  async init() { return this; }
  async predictAction(state) {
    const thrustRatio = this.config.min_thrust_ratio+(this.rawThrust+1)*.5*(1-this.config.min_thrust_ratio);
    return { thrust: state[6] > 0 ? thrustRatio*this.config.max_thrust : 0,
      thrustRatio, gimbalRad: this.rawGimbal*this.config.max_gimbal_deg*Math.PI/180 };
  }
  async dispose() {}
}
