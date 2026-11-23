// Vite bundles shared constants; online Actor-Critic RL runs directly in browser.
import physicsConfig from '../../shared/physics_config.json' with { type: 'json' };

const STORAGE_KEY = 'virtual_launch_lab_online_rl_v2';

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function randn() {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

class OnlineActorCritic {
  constructor(inDim = 8, hiddenDim = 24, outDim = 2) {
    this.inDim = inDim;
    this.hiddenDim = hiddenDim;
    this.outDim = outDim;

    this.episodeCount = 0;
    this.successCount = 0;
    this.recentSuccesses = [];
    this.bestReward = -Infinity;
    this.lastReward = 0;

    this.W1 = new Float32Array(hiddenDim * inDim);
    this.b1 = new Float32Array(hiddenDim);
    this.W2 = new Float32Array(outDim * hiddenDim);
    this.b2 = new Float32Array(outDim);
    this.WV = new Float32Array(hiddenDim);
    this.bV = 0.0;

    this._initWeights();
    this._initAdam();
  }

  _initWeights() {
    const scale1 = Math.sqrt(2.0 / (this.inDim + this.hiddenDim));
    for (let i = 0; i < this.W1.length; i++) this.W1[i] = randn() * scale1;
    this.b1.fill(0);

    for (let i = 0; i < this.W2.length; i++) this.W2[i] = randn() * 0.08;
    this.b2[0] = 0.15;
    this.b2[1] = 0.0;

    for (let i = 0; i < this.WV.length; i++) this.WV[i] = randn() * 0.05;
    this.bV = 0.0;
  }

  _initAdam() {
    this.adamStep = 0;
    this.mW1 = new Float32Array(this.W1.length);
    this.vW1 = new Float32Array(this.W1.length);
    this.mb1 = new Float32Array(this.b1.length);
    this.vb1 = new Float32Array(this.b1.length);

    this.mW2 = new Float32Array(this.W2.length);
    this.vW2 = new Float32Array(this.W2.length);
    this.mb2 = new Float32Array(this.b2.length);
    this.vb2 = new Float32Array(this.b2.length);

    this.mWV = new Float32Array(this.WV.length);
    this.vWV = new Float32Array(this.WV.length);
    this.mbV = 0.0;
    this.vbV = 0.0;
  }

  reset() {
    this.episodeCount = 0;
    this.successCount = 0;
    this.recentSuccesses = [];
    this.bestReward = -Infinity;
    this.lastReward = 0;
    this._initWeights();
    this._initAdam();
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore storage errors
    }
  }

  saveToStorage() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          episodeCount: this.episodeCount,
          successCount: this.successCount,
          recentSuccesses: this.recentSuccesses,
          bestReward: this.bestReward,
          lastReward: this.lastReward,
          W1: Array.from(this.W1),
          b1: Array.from(this.b1),
          W2: Array.from(this.W2),
          b2: Array.from(this.b2),
          WV: Array.from(this.WV),
          bV: this.bV
        })
      );
    } catch {
      // Ignore quota/private mode errors
    }
  }

  loadFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.W1) || data.W1.length !== this.W1.length) return false;

      this.episodeCount = data.episodeCount ?? 0;
      this.successCount = data.successCount ?? 0;
      this.recentSuccesses = Array.isArray(data.recentSuccesses) ? data.recentSuccesses : [];
      this.bestReward = Number.isFinite(data.bestReward) ? data.bestReward : -Infinity;
      this.lastReward = Number.isFinite(data.lastReward) ? data.lastReward : 0;

      this.W1.set(data.W1);
      this.b1.set(data.b1);
      this.W2.set(data.W2);
      this.b2.set(data.b2);
      this.WV.set(data.WV);
      this.bV = data.bV ?? 0.0;
      return true;
    } catch {
      return false;
    }
  }

  getExplorationStd() {
    const decay = Math.exp(-this.episodeCount / 85.0);
    return 0.08 + 0.34 * decay;
  }

  extractFeatures(stateArray) {
    const [x, y, vx, vy, theta, omega] = stateArray;
    const safeY = Math.max(0, y);
    const desiredVy = -Math.max(1.2, Math.sqrt(12.0 * safeY));
    return Float32Array.from([
      clamp(x / 50.0, -3, 3),
      clamp(y / 200.0, -0.2, 2.0),
      clamp(vx / 20.0, -3, 3),
      clamp(vy / 25.0, -3, 3),
      clamp(theta / 0.5, -4, 4),
      clamp(omega / 1.5, -4, 4),
      clamp((x + vx * 1.4) / 50.0, -3, 3),
      clamp((vy - desiredVy) / 20.0, -3, 3)
    ]);
  }

  forward(features) {
    const { inDim, hiddenDim, outDim, W1, b1, W2, b2, WV, bV } = this;
    const h1 = new Float32Array(hiddenDim);
    for (let j = 0; j < hiddenDim; j++) {
      let sum = b1[j];
      const offset = j * inDim;
      for (let i = 0; i < inDim; i++) sum += W1[offset + i] * features[i];
      h1[j] = Math.tanh(sum);
    }

    const mu = new Float32Array(outDim);
    for (let k = 0; k < outDim; k++) {
      let sum = b2[k];
      const offset = k * hiddenDim;
      for (let j = 0; j < hiddenDim; j++) sum += W2[offset + j] * h1[j];
      mu[k] = Math.tanh(sum);
    }

    let value = bV;
    for (let j = 0; j < hiddenDim; j++) value += WV[j] * h1[j];

    return { h1, mu, value };
  }

  selectAction(stateArray) {
    const features = this.extractFeatures(stateArray);
    const { h1, mu, value } = this.forward(features);
    const sigma = this.getExplorationStd();

    const action = new Float32Array(this.outDim);
    for (let k = 0; k < this.outDim; k++) {
      action[k] = clamp(mu[k] + sigma * randn(), -1.0, 1.0);
    }
    return { features, h1, mu, value, action, sigma };
  }

  trainEpisode(trajectory, terminalBonus, landed) {
    const T = trajectory.length;
    this.episodeCount += 1;
    this.recentSuccesses.push(landed ? 1 : 0);
    if (this.recentSuccesses.length > 20) this.recentSuccesses.shift();
    if (landed) this.successCount += 1;

    if (T < 3) return;

    trajectory[T - 1].reward += terminalBonus;

    let totalReward = 0;
    for (let t = 0; t < T; t++) totalReward += trajectory[t].reward;
    this.lastReward = totalReward;
    if (totalReward > this.bestReward) this.bestReward = totalReward;

    const gamma = 0.99;
    const returns = new Float32Array(T);
    const advantages = new Float32Array(T);
    let runningReturn = 0;
    for (let t = T - 1; t >= 0; t--) {
      runningReturn = trajectory[t].reward + gamma * runningReturn;
      returns[t] = runningReturn;
      advantages[t] = runningReturn - trajectory[t].value;
    }

    let meanAdv = 0;
    for (let t = 0; t < T; t++) meanAdv += advantages[t];
    meanAdv /= T;
    let varAdv = 0;
    for (let t = 0; t < T; t++) {
      const d = advantages[t] - meanAdv;
      varAdv += d * d;
    }
    const stdAdv = Math.sqrt(varAdv / T + 1e-8);
    for (let t = 0; t < T; t++) advantages[t] = (advantages[t] - meanAdv) / stdAdv;

    const { inDim, hiddenDim, outDim } = this;
    const gW1 = new Float32Array(this.W1.length);
    const gb1 = new Float32Array(this.b1.length);
    const gW2 = new Float32Array(this.W2.length);
    const gb2 = new Float32Array(this.b2.length);
    const gWV = new Float32Array(this.WV.length);
    let gbV = 0.0;

    for (let t = 0; t < T; t++) {
      const { features, h1, mu, value, action, sigma } = trajectory[t];
      const adv = advantages[t];
      const ret = returns[t];
      const invVar = 1.0 / (sigma * sigma + 1e-6);

      const dRawMu = new Float32Array(outDim);
      for (let k = 0; k < outDim; k++) {
        const dLogPi = (action[k] - mu[k]) * invVar;
        const dTanh = 1.0 - mu[k] * mu[k];
        dRawMu[k] = -adv * dLogPi * dTanh;

        gb2[k] += dRawMu[k];
        const offset = k * hiddenDim;
        for (let j = 0; j < hiddenDim; j++) gW2[offset + j] += dRawMu[k] * h1[j];
      }

      const dVal = clamp(value - ret, -5.0, 5.0) * 0.5;
      gbV += dVal;
      for (let j = 0; j < hiddenDim; j++) gWV[j] += dVal * h1[j];

      for (let j = 0; j < hiddenDim; j++) {
        let dh = dVal * this.WV[j];
        for (let k = 0; k < outDim; k++) dh += dRawMu[k] * this.W2[k * hiddenDim + j];
        const dz1 = dh * (1.0 - h1[j] * h1[j]);
        gb1[j] += dz1;
        const offset = j * inDim;
        for (let i = 0; i < inDim; i++) gW1[offset + i] += dz1 * features[i];
      }
    }

    this._applyAdam(gW1, gb1, gW2, gb2, gWV, gbV, 1.0 / T);
    this.saveToStorage();
  }

  _applyAdam(gW1, gb1, gW2, gb2, gWV, gbV, scale) {
    this.adamStep += 1;
    const lr = 0.004;
    const beta1 = 0.9;
    const beta2 = 0.999;
    const eps = 1e-8;
    const bc1 = 1.0 - Math.pow(beta1, this.adamStep);
    const bc2 = 1.0 - Math.pow(beta2, this.adamStep);

    const updateArr = (w, m, v, g) => {
      for (let i = 0; i < w.length; i++) {
        const grad = clamp(g[i] * scale, -1.0, 1.0);
        m[i] = beta1 * m[i] + (1.0 - beta1) * grad;
        v[i] = beta2 * v[i] + (1.0 - beta2) * grad * grad;
        w[i] -= (lr * (m[i] / bc1)) / (Math.sqrt(v[i] / bc2) + eps);
      }
    };

    updateArr(this.W1, this.mW1, this.vW1, gW1);
    updateArr(this.b1, this.mb1, this.vb1, gb1);
    updateArr(this.W2, this.mW2, this.vW2, gW2);
    updateArr(this.b2, this.mb2, this.vb2, gb2);
    updateArr(this.WV, this.mWV, this.vWV, gWV);

    const gradV = clamp(gbV * scale, -1.0, 1.0);
    this.mbV = beta1 * this.mbV + (1.0 - beta1) * gradV;
    this.vbV = beta2 * this.vbV + (1.0 - beta2) * gradV * gradV;
    this.bV -= (lr * (this.mbV / bc1)) / (Math.sqrt(this.vbV / bc2) + eps);
  }

  getStats() {
    const recentRate =
      this.recentSuccesses.length > 0
        ? Math.round((this.recentSuccesses.reduce((a, b) => a + b, 0) / this.recentSuccesses.length) * 100)
        : 0;
    return {
      episodeCount: this.episodeCount,
      successCount: this.successCount,
      recentRate,
      lastReward: this.lastReward,
      bestReward: Number.isFinite(this.bestReward) ? this.bestReward : null,
      sigma: this.getExplorationStd()
    };
  }

  getSummaryText() {
    const s = this.getStats();
    return `RUN #${s.episodeCount} | 성공률 ${s.recentRate}% | 보상 ${s.lastReward.toFixed(1)} (최고 ${
      s.bestReward !== null ? s.bestReward.toFixed(1) : '-'
    })`;
  }
}

export class RocketRLController {
  constructor(options = {}) {
    this.options = options;
    this.config = null;
    this.agent = new OnlineActorCritic(8, 24, 2);
    this.isReady = false;
    this.loadStatus = 'idle';
    this.loadMessage = '';

    this.trajectory = [];
    this.prevState = null;
    this.prevPotential = null;
    this._episodeFinalized = false;

    if (typeof window !== 'undefined') {
      window.resetRocketRL = () => this.resetTraining();
    }
  }

  async init() {
    this.config = Object.freeze({ ...physicsConfig });
    const loaded = this.agent.loadFromStorage();
    this.isReady = true;
    this.loadStatus = 'ready';
    this.loadMessage = loaded
      ? `온라인 RL 이어서 학습 (${this.agent.getSummaryText()})`
      : '온라인 RL 시작 (RUN #1 - 매 실행마다 자동 최적화)';
    return this;
  }

  getStats() {
    return this.agent.getStats();
  }

  resetTraining() {
    this.agent.reset();
    this.trajectory = [];
    this.prevState = null;
    this.prevPotential = null;
    this._episodeFinalized = false;
    this.loadMessage = '온라인 RL 초기화 완료 (RUN #1부터 재시작)';
    return this.getStats();
  }

  _computePotential(stateArray) {
    const [x, y, vx, vy, theta, omega] = stateArray;
    const safeY = Math.max(0, y);
    const targetVy = -Math.max(1.2, Math.sqrt(12.0 * safeY));
    return -(
      2.0 * (Math.abs(x) / 50.0) +
      1.5 * (safeY / 200.0) +
      1.5 * (Math.abs(vx) / 20.0) +
      2.2 * (Math.abs(vy - targetVy) / 20.0) +
      3.8 * Math.abs(theta) +
      1.0 * Math.abs(omega)
    );
  }

  notifyEpisodeEnd(finalState, explicitLanded = null) {
    if (this._episodeFinalized || this.trajectory.length === 0) return this.getStats();
    const state = finalState || this.prevState;
    if (!state) return this.getStats();

    const [x, y, vx, vy, theta] = state;
    const landed =
      typeof explicitLanded === 'boolean'
        ? explicitLanded
        : y <= 1.2 && Math.abs(x) < 4.5 && Math.abs(vy) < 4.5 && Math.abs(vx) < 3.0 && Math.abs(theta) < 0.22;

    const terminalBonus = landed ? 25.0 + Math.max(0, 10.0 * (1.0 - Math.abs(x) / 4.5)) : -15.0;
    this.agent.trainEpisode(this.trajectory, terminalBonus, landed);
    this.loadMessage = this.agent.getSummaryText();
    this._episodeFinalized = true;

    this.trajectory = [];
    this.prevState = null;
    this.prevPotential = null;
    return this.getStats();
  }

  async predictAction(stateArray) {
    if (!this.isReady || !this.config) await this.init();

    // 새 에피소드로 리셋되었는지 자동 감지 (수동 RESET 버튼 대응)
    if (this.prevState && !this._episodeFinalized) {
      const altitudeJumped = stateArray[1] - this.prevState[1] > 40.0;
      const fuelRefilled = stateArray[6] - this.prevState[6] > 50.0;
      if (altitudeJumped || fuelRefilled) {
        this.notifyEpisodeEnd(this.prevState);
      }
    }
    this._episodeFinalized = false;

    const currentPotential = this._computePotential(stateArray);
    if (this.trajectory.length > 0 && this.prevPotential !== null) {
      const prevStep = this.trajectory[this.trajectory.length - 1];
      prevStep.reward = (currentPotential - this.prevPotential) * 10.0 - 0.02 * prevStep.thrustRatio;
    }

    const stepData = this.agent.selectAction(stateArray);
    const [rawThrust, rawGimbal] = stepData.action;
    const c = this.config;
    const thrustRatio = c.min_thrust_ratio + (rawThrust + 1.0) * 0.5 * (1.0 - c.min_thrust_ratio);
    const gimbalRad = rawGimbal * ((c.max_gimbal_deg * Math.PI) / 180);

    this.trajectory.push({
      ...stepData,
      thrustRatio,
      reward: 0
    });

    this.prevState = Array.from(stateArray);
    this.prevPotential = currentPotential;

    return {
      thrust: stateArray[6] <= 0 ? 0 : c.max_thrust * thrustRatio,
      thrustRatio,
      gimbalRad
    };
  }

  async dispose() {
    this.trajectory = [];
    this.prevState = null;
    this.prevPotential = null;
    this._episodeFinalized = false;
    this.isReady = false;
    this.loadStatus = 'idle';
  }
}

export default RocketRLController;
