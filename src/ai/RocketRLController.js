/** Requires onnxruntime-web in the frontend package (not installed here).
 * This repository currently has no root package.json or JS bundler.
 * Use an ESM bundler with onnxruntime-web and serve its WASM assets according
 * to that version's packaging instructions. Existing static pages do not
 * automatically load this module. public/models/* must be served at /models/*.
 */

export class RocketRLController {
  constructor({modelUrl = '/models/rocket_policy.onnx',
    statsUrl = '/models/norm_stats.json',
    configUrl = new URL('../../shared/physics_config.json', import.meta.url),
    sessionOptions = {executionProviders: ['wasm']}} = {}) {
    this.urls = {modelUrl, statsUrl, configUrl};
    this.sessionOptions = sessionOptions;
    this.session = null;
    this.config = null;
    this.normStats = null;
    this._initPromise = null;
  }

  async init() {
    if (this.session) return this;
    if (this._initPromise) return this._initPromise;
    this._initPromise = (async () => {
      const ort = this.ort = await import('onnxruntime-web');
      // Works on ordinary static hosting without cross-origin isolation headers.
      ort.env.wasm.numThreads = 1;
      const load = async url => {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Cannot load ${url}: HTTP ${response.status}`);
        return response.json();
      };
      const [config, stats] = await Promise.all([
        load(this.urls.configUrl), load(this.urls.statsUrl),
      ]);
      for (const key of ['dt', 'dry_mass', 'max_thrust', 'rocket_length', 'moment_of_inertia']) {
        if (!Number.isFinite(config[key]) || config[key] <= 0) throw new Error(`Invalid ${key}`);
      }
      for (const key of ['gravity', 'initial_fuel_mass', 'max_gimbal_deg', 'fuel_consumption_rate']) {
        if (!Number.isFinite(config[key]) || config[key] < 0) throw new Error(`Invalid ${key}`);
      }
      if (!Number.isFinite(config.min_thrust_ratio) || config.min_thrust_ratio < 0 || config.min_thrust_ratio > 1)
        throw new Error('Invalid min_thrust_ratio');
      for (const key of ['obs_mean', 'obs_var']) {
        if (!Array.isArray(stats[key]) || stats[key].length !== 7 || !stats[key].every(Number.isFinite))
          throw new Error(`Invalid ${key}`);
      }
      if (stats.obs_var.some(x => x < 0) || !Number.isFinite(stats.epsilon) || stats.epsilon <= 0 ||
          !Number.isFinite(stats.clip_obs) || stats.clip_obs <= 0) throw new Error('Invalid normalization statistics');
      const session = await ort.InferenceSession.create(this.urls.modelUrl, this.sessionOptions);
      if (!session.inputNames.includes('obs') || !session.outputNames.includes('action')) {
        await session.release();
        throw new Error('Expected ONNX inputs obs and outputs action');
      }
      this.config = Object.freeze({...config});
      this.normStats = stats;
      this.session = session;
      return this;
    })();
    try { return await this._initPromise; }
    finally { this._initPromise = null; }
  }

  normalizeObs(rawObs) {
    if (!this.normStats) throw new Error('Call init() first');
    if (!rawObs || rawObs.length !== 7 || !Array.from(rawObs).every(Number.isFinite))
      throw new Error('Expected seven finite state values');
    const {obs_mean, obs_var, epsilon, clip_obs} = this.normStats;
    return Float32Array.from(rawObs, (value, i) => {
      // Python emits float32 observations, then computes with float64 rms,
      // clips, and casts the normalized result back to float32.
      const input = Math.fround(value);
      if (!Number.isFinite(input)) throw new Error('Observation exceeds float32 range');
      const z = (input - obs_mean[i]) / Math.sqrt(obs_var[i] + epsilon);
      return Math.max(-clip_obs, Math.min(clip_obs, z));
    });
  }

  async predictAction(stateArray) {
    if (!this.session) throw new Error('Call init() first');
    const obs = new this.ort.Tensor('float32', this.normalizeObs(stateArray), [1, 7]);
    let outputs;
    try {
      outputs = await this.session.run({obs});
      const tensor = outputs.action;
      if (!tensor || tensor.dims.length !== 2 || tensor.dims[0] !== 1 || tensor.dims[1] !== 2)
        throw new Error('Expected action shape [1, 2]');
      const [a, b] = tensor.data;
      if (![a, b].every(Number.isFinite)) throw new Error('Non-finite model output');
      const rawThrust = Math.max(-1, Math.min(1, a));
      const rawGimbal = Math.max(-1, Math.min(1, b));
      const c = this.config;
      const thrustRatio = c.min_thrust_ratio + (rawThrust + 1)*0.5*(1-c.min_thrust_ratio);
      return {
        thrust: stateArray[6] <= 0 ? 0 : c.max_thrust*thrustRatio,
        thrustRatio, gimbalRad: rawGimbal*(c.max_gimbal_deg*Math.PI/180),
      };
    } finally {
      obs.dispose();
      if (outputs) for (const tensor of Object.values(outputs)) tensor.dispose();
    }
  }

  async dispose() {
    // Call only after all init()/predictAction() promises have finished.
    if (this.session) await this.session.release();
    this.session = null;
    this.normStats = null;
    this.config = null;
  }
}

export default RocketRLController;
