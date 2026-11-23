// Vite bundles shared constants; only trained model artifacts use HTTP.
import physicsConfig from '../../shared/physics_config.json' with { type: 'json' };

export class RocketRLController {
  constructor({modelUrl = '/models/rocket_policy.onnx',
    statsUrl = '/models/norm_stats.json',
    sessionOptions = {executionProviders: ['wasm']}} = {}) {
    this.urls = {modelUrl, statsUrl};
    this.sessionOptions = sessionOptions;
    this.session = null;
    this.config = null;
    this.normStats = null;
    this._initPromise = null;
    this.isReady = false;
    this.loadStatus = 'idle';
    this.loadMessage = '';
  }

  async init() {
    if (this.session) return this;
    if (this._initPromise) return this._initPromise;
    this.loadStatus = 'loading';
    this.loadMessage = '';
    this._initPromise = (async () => {
      const config = physicsConfig;
      const response = await fetch(this.urls.statsUrl);
      const missingModelMessage = '모델 파일(public/models/norm_stats.json)이 없습니다. export_onnx.py를 먼저 실행하세요.';
      // Static hosts may serve index.html with HTTP 200 for a missing asset.
      const contentType = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
      if (!response.ok || !(contentType === 'application/json' || /^application\/[a-z0-9!#$&^_.+-]+\+json$/.test(contentType))) {
        throw new Error(missingModelMessage);
      }
      let stats;
      try { stats = await response.json(); }
      catch { throw new Error('모델 정규화 파일(public/models/norm_stats.json)이 올바른 JSON이 아닙니다. export_onnx.py를 다시 실행하세요.'); }
      if (!stats || typeof stats !== 'object' || Array.isArray(stats)) throw new Error('Invalid normalization statistics');
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
      const modelResponse = await fetch(this.urls.modelUrl);
      const modelType = (modelResponse.headers.get('content-type') ?? '').toLowerCase();
      if (!modelResponse.ok || modelType.includes('text/html'))
        throw new Error('모델 파일(public/models/rocket_policy.onnx)이 없습니다. export_onnx.py를 먼저 실행하세요.');
      const modelBytes = await modelResponse.arrayBuffer();
      const prefix = new TextDecoder().decode(new Uint8Array(modelBytes,0,Math.min(128,modelBytes.byteLength)));
      if (!modelBytes.byteLength || /^\s*(?:<!doctype\s+html|<html)/i.test(prefix))
        throw new Error('ONNX 모델 대신 HTML 또는 빈 파일이 반환되었습니다. public/models/rocket_policy.onnx를 확인하세요.');
      const ort = this.ort = await import('onnxruntime-web');
      // Works without cross-origin isolation headers on ordinary static hosting.
      ort.env.wasm.numThreads = 1;
      const session = await ort.InferenceSession.create(modelBytes, this.sessionOptions);
      if (!session.inputNames.includes('obs') || !session.outputNames.includes('action')) {
        await session.release();
        throw new Error('Expected ONNX inputs obs and outputs action');
      }
      this.config = Object.freeze({...config});
      this.normStats = stats;
      this.session = session;
      this.isReady = true;
      this.loadStatus = 'ready';
      return this;
    })().catch(error => {
      this.isReady = false;
      this.loadStatus = 'unavailable';
      this.loadMessage = error instanceof Error ? error.message : String(error);
      console.warn('[PPO unavailable]', this.loadMessage);
      return this;
    });
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
    this.isReady = false;
    this.loadStatus = 'idle';
    this.loadMessage = '';
  }
}

export default RocketRLController;
