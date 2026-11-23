// Vite bundles shared constants; only trained model artifacts use HTTP.
import physicsConfig from '../../shared/physics_config.json' with { type: 'json' };

export class RocketRLController {
  constructor({
    modelUrl = '/models/rocket_policy.onnx',
    statsUrl = '/models/norm_stats.json',
    sessionOptions = { executionProviders: ['wasm'] }
  } = {}) {
    this.urls = { modelUrl, statsUrl };
    this.sessionOptions = sessionOptions;
    this.session = null;
    this.config = null;
    this.normStats = null;
    this._initPromise = null;
    this.isReady = false;
    this.useBuiltinGuidance = false;
    this.loadStatus = 'idle';
    this.loadMessage = '';
  }

  _validateAndFreezeConfig(config) {
    for (const key of ['dt', 'dry_mass', 'max_thrust', 'rocket_length', 'moment_of_inertia']) {
      if (!Number.isFinite(config[key]) || config[key] <= 0) throw new Error(`Invalid ${key}`);
    }
    for (const key of ['gravity', 'initial_fuel_mass', 'max_gimbal_deg', 'fuel_consumption_rate']) {
      if (!Number.isFinite(config[key]) || config[key] < 0) throw new Error(`Invalid ${key}`);
    }
    if (!Number.isFinite(config.min_thrust_ratio) || config.min_thrust_ratio < 0 || config.min_thrust_ratio > 1) {
      throw new Error('Invalid min_thrust_ratio');
    }
    return Object.freeze({ ...config });
  }

  async init() {
    if (this.isReady && (this.session || this.useBuiltinGuidance)) return this;
    if (this._initPromise) return this._initPromise;
    this.loadStatus = 'loading';
    this.loadMessage = '';

    this._initPromise = (async () => {
      const frozenConfig = this._validateAndFreezeConfig(physicsConfig);
      this.config = frozenConfig;

      const response = await fetch(this.urls.statsUrl);
      const missingModelMessage = 'ONNX 모델 미탑재 - 내장 ZEM/ZEV 자율 착륙 제어기로 동작합니다.';
      const contentType = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
      if (!response.ok || !(contentType === 'application/json' || /^application\/[a-z0-9!#$&^_.+-]+\+json$/.test(contentType))) {
        throw new Error(missingModelMessage);
      }

      let stats;
      try {
        stats = await response.json();
      } catch {
        throw new Error('norm_stats.json 파싱 실패 - 내장 자율 착륙 제어기로 동작합니다.');
      }

      if (!stats || typeof stats !== 'object' || Array.isArray(stats)) {
        throw new Error('Invalid normalization statistics');
      }
      for (const key of ['obs_mean', 'obs_var']) {
        if (!Array.isArray(stats[key]) || stats[key].length !== 7 || !stats[key].every(Number.isFinite)) {
          throw new Error(`Invalid ${key}`);
        }
      }
      if (
        stats.obs_var.some((x) => x < 0) ||
        !Number.isFinite(stats.epsilon) ||
        stats.epsilon <= 0 ||
        !Number.isFinite(stats.clip_obs) ||
        stats.clip_obs <= 0
      ) {
        throw new Error('Invalid normalization statistics');
      }

      const modelResponse = await fetch(this.urls.modelUrl);
      const modelType = (modelResponse.headers.get('content-type') ?? '').toLowerCase();
      if (!modelResponse.ok || modelType.includes('text/html')) {
        throw new Error(missingModelMessage);
      }

      const modelBytes = await modelResponse.arrayBuffer();
      const prefix = new TextDecoder().decode(new Uint8Array(modelBytes, 0, Math.min(128, modelBytes.byteLength)));
      if (!modelBytes.byteLength || /^\s*(?:<!doctype\s+html|<html)/i.test(prefix)) {
        throw new Error(missingModelMessage);
      }

      const ort = (this.ort = await import('onnxruntime-web'));
      ort.env.wasm.numThreads = 1;
      const session = await ort.InferenceSession.create(modelBytes, this.sessionOptions);
      if (!session.inputNames.includes('obs') || !session.outputNames.includes('action')) {
        await session.release();
        throw new Error('Expected ONNX inputs obs and outputs action');
      }

      this.normStats = stats;
      this.session = session;
      this.useBuiltinGuidance = false;
      this.isReady = true;
      this.loadStatus = 'ready';
      return this;
    })().catch((error) => {
      // ONNX 파일이 없어도 에러로 중단하지 않고 내장 자율 착륙 제어기로 즉시 활성화
      if (!this.config) {
        this.config = Object.freeze({ ...physicsConfig });
      }
      this.session = null;
      this.useBuiltinGuidance = true;
      this.isReady = true;
      this.loadStatus = 'ready';
      this.loadMessage = error instanceof Error ? error.message : String(error);
      console.info('[Autopilot Built-in]', this.loadMessage);
      return this;
    });

    try {
      return await this._initPromise;
    } finally {
      this._initPromise = null;
    }
  }

  normalizeObs(rawObs) {
    if (!this.normStats) throw new Error('Call init() first');
    if (!rawObs || rawObs.length !== 7 || !Array.from(rawObs).every(Number.isFinite)) {
      throw new Error('Expected seven finite state values');
    }
    const { obs_mean, obs_var, epsilon, clip_obs } = this.normStats;
    return Float32Array.from(rawObs, (value, i) => {
      const input = Math.fround(value);
      if (!Number.isFinite(input)) throw new Error('Observation exceeds float32 range');
      const z = (input - obs_mean[i]) / Math.sqrt(obs_var[i] + epsilon);
      return Math.max(-clip_obs, Math.min(clip_obs, z));
    });
  }

  async predictAction(stateArray) {
    if (!this.isReady || !this.config) throw new Error('Call init() first');
    if (!stateArray || stateArray.length !== 7 || !Array.from(stateArray).every(Number.isFinite)) {
      throw new Error('Expected seven finite state values');
    }

    if (this.useBuiltinGuidance || !this.session) {
      return this._predictBuiltinGuidance(stateArray);
    }

    const obs = new this.ort.Tensor('float32', this.normalizeObs(stateArray), [1, 7]);
    let outputs;
    try {
      outputs = await this.session.run({ obs });
      const tensor = outputs.action;
      if (!tensor || tensor.dims.length !== 2 || tensor.dims[0] !== 1 || tensor.dims[1] !== 2) {
        throw new Error('Expected action shape [1, 2]');
      }
      const [a, b] = tensor.data;
      if (![a, b].every(Number.isFinite)) throw new Error('Non-finite model output');
      const rawThrust = Math.max(-1, Math.min(1, a));
      const rawGimbal = Math.max(-1, Math.min(1, b));
      const c = this.config;
      const thrustRatio = c.min_thrust_ratio + (rawThrust + 1) * 0.5 * (1 - c.min_thrust_ratio);
      return {
        thrust: stateArray[6] <= 0 ? 0 : c.max_thrust * thrustRatio,
        thrustRatio,
        gimbalRad: rawGimbal * ((c.max_gimbal_deg * Math.PI) / 180)
      };
    } finally {
      obs.dispose();
      if (outputs) for (const tensor of Object.values(outputs)) tensor.dispose();
    }
  }

  _predictBuiltinGuidance(stateArray) {
    const [x, y, vx, vy, theta, omega, fuel] = stateArray;
    const c = this.config;
    const maxGimbalRad = (c.max_gimbal_deg * Math.PI) / 180;
    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

    if (fuel <= 0) {
      return { thrust: 0, thrustRatio: 0, gimbalRad: 0 };
    }

    // 1. ZEM/ZEV 수평 유도 -> 목표 자세각(targetTheta)
    const tGo = Math.max(0.8, y / Math.max(5.0, -vy));
    const axCmd = (-6.0 * (x + vx * tGo)) / (tGo * tGo) - (4.0 * vx) / tGo;
    const targetTheta =
      y < 12.0
        ? 0.0
        : clamp(Math.asin(clamp(-axCmd / 18.0, -0.9, 0.9)), -0.35, 0.35);

    // 2. 자세 PD 제어 -> 짐벌 노즐 각도(gimbalRad)
    const gimbalRad = clamp(
      4.5 * (theta - targetTheta) + 2.2 * omega,
      -maxGimbalRad,
      maxGimbalRad
    );

    // 3. 제동 거리 기반 호버슬램(Hoverslam) 추력 제어
    const totalMass = c.dry_mass + Math.max(0, fuel);
    const effectiveAccel = (c.max_thrust / totalMass) * Math.max(0.5, Math.cos(theta)) - c.gravity;
    const stopDist = vy < 0 ? (vy * vy) / (2.0 * Math.max(1.0, effectiveAccel) * 0.8) : 0;

    let thrustRatio = 0;
    if (y <= stopDist + 3.0 || vy <= -28.0) {
      const targetVy = -Math.max(
        0.8,
        Math.sqrt(2.0 * Math.max(1.0, effectiveAccel) * 0.8 * Math.max(0, y))
      );
      thrustRatio = clamp(0.85 + (targetVy - vy) * 0.25, c.min_thrust_ratio, 1.0);
    }

    return {
      thrust: c.max_thrust * thrustRatio,
      thrustRatio,
      gimbalRad
    };
  }

  async dispose() {
    if (this.session) await this.session.release();
    this.session = null;
    this.normStats = null;
    this.config = null;
    this.isReady = false;
    this.useBuiltinGuidance = false;
    this.loadStatus = 'idle';
    this.loadMessage = '';
  }
}

export default RocketRLController;
