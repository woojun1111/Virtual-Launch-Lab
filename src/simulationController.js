import { RocketLandingSim } from './simulation/RocketLandingSim.js';
import physicsConfig from '../shared/physics_config.json';
import RocketRLController from './ai/RocketRLController.js';
import { BatchEvaluator } from './batchEvaluator.js';

export class SimulationController {
  constructor({ view, hud, manualController, requestedMode }) {
    this.view = view;
    this.hud = hud;
    this.manualController = manualController;
    this.requestedMode = requestedMode;
    this.controlMode = 'MANUAL';
    this.aiController = new RocketRLController();
    this.sim = new RocketLandingSim({
      config: Object.freeze({ ...physicsConfig }),
      async init() {},
      async predictAction() {
        throw new Error('AI model is not loaded; supply a manual action');
      }
    });
    this.switchingMode = false;
    this.episodeVersion = 0;
    this.autoRestartRequested = false;
    this.simSpeed = 1;
    this.paused = true;

    this.FIXED_DT = physicsConfig.dt;
    this.accumulator = 0;
    this.lastFrame = null;
    this.pendingStep = null;
    this.resetRequested = false;
    this.running = false;
    this.disposed = false;
    this.failed = false;
    this.latestState = null;
    this.batch = new BatchEvaluator({
      getContext: () => ({
        eligible: this.latestState?.done && !this.disposed && !document.hidden && !this.switchingMode,
        episode: this.episodeVersion,
        speed: this.simSpeed
      }),
      restart: () => this.resetSimulation({ automatic: true }),
      onChange: () => this._updateBenchmarkPanel()
    });
  }

  async start() {
    if (this.running || this.disposed) return;
    try {
      await this.sim.init();
      if (this.disposed) return;
      this.view.configureScene(this.sim.config);
      this.manualController.maxGimbalRad = (this.sim.config.max_gimbal_deg * Math.PI) / 180;
      this.manualController.minThrustRatio = this.sim.config.min_thrust_ratio;
      this.hud.initialFuel = this.sim.config.initial_fuel_mass;
      this.running = true;
      this.hud.setResetEnabled(true);
      this._updateBenchmarkPanel();
      this.resetSimulation();
      this.frameId = requestAnimationFrame((t) => this._animate(t));
      if (this.requestedMode === 'AI') await this.changeMode('AI');
    } catch (error) {
      this._showError(error);
    }
    return this;
  }

  resetSimulation({ automatic = false } = {}) {
    this.batch.cancelRestart();
    if (!automatic) this.setAutoBenchmark(false);
    this.autoRestartRequested = automatic;
    if (!this.running || this.disposed) return;
    this.resetRequested = true;
    this.hud.setResetEnabled(false);
    if (!this.pendingStep) this._applyReset();
  }

  _applyReset() {
    this.episodeVersion++;
    this.resetRequested = false;
    this.failed = false;
    this.accumulator = 0;
    this.lastFrame = null;
    const random = (a, b) => a + Math.random() * (b - a);
    this.latestState = this.sim.reset({
      x: random(-50, 50),
      y: random(150, 250),
      vx: random(-10, 10),
      vy: random(-25, -5),
      theta: random(-0.2, 0.2),
      omega: 0,
      fuel: this.sim.config.initial_fuel_mass
    });
    this.manualController.reset();
    this.view.resetScene(this.latestState);
    this.hud.hideBanner();
    this.hud.setResetEnabled(true);
    this.paused = true;
    if (this.autoRestartRequested) this.paused = false;
    this.autoRestartRequested = false;
    this.view.setPlayLabel(this.paused ? '시뮬레이션 시작' : '일시정지');
    this._updateBenchmarkPanel();
  }

  _animate(timestamp) {
    if (this.disposed) return;
    this.frameId = requestAnimationFrame((t) => this._animate(t));
    const dt = this.lastFrame === null ? 0 : Math.max(0, (timestamp - this.lastFrame) / 1000);
    this.lastFrame = timestamp;
    if (!this.paused && !document.hidden && !this.failed && this.latestState && !this.latestState.done) {
      const maxBacklog = Math.min(2.5, 0.25 * this.simSpeed);
      this.accumulator = Math.min(maxBacklog, this.accumulator + dt * this.simSpeed);
      this._pumpPhysics();
    }
    const visualDt = this.paused || document.hidden || this.failed ? 0 : dt * Math.min(this.simSpeed, 4);
    this.view.renderFrame(this.latestState, timestamp, visualDt);
  }

  _pumpPhysics() {
    if (
      this.paused ||
      this.pendingStep ||
      this.resetRequested ||
      this.failed ||
      document.hidden ||
      this.latestState.done ||
      this.accumulator + 1e-12 < this.FIXED_DT
    ) {
      return;
    }
    this.accumulator = Math.max(0, this.accumulator - this.FIXED_DT);
    const manualAction = this.controlMode === 'MANUAL' ? this.manualController.update(this.FIXED_DT) : null;
    this.pendingStep = this.sim
      .step(this.FIXED_DT, manualAction)
      .then((state) => {
        if (!this.disposed && !this.resetRequested) {
          this.latestState = state;
          this.view.recordTrajectory(state);
          if (state.done) {
            if (this.controlMode === 'AI') this.batch.record(state.isSuccess);
            this.hud.recordResult(state, this.episodeVersion);
            this.batch.scheduleRestart();
          }
        }
        if (state.done) this.accumulator = 0;
      })
      .catch((error) => {
        if (!this.disposed) this._showError(error);
      })
      .finally(() => {
        this.pendingStep = null;
        if (this.disposed) return;
        if (this.resetRequested) this._applyReset();
        else this._pumpPhysics();
      });
  }

  async changeMode(mode) {
    if (!this.running || this.disposed || this.switchingMode || mode === this.controlMode) return;
    this.setAutoBenchmark(false);
    this.switchingMode = true;
    this.hud.setModeBusy(true);
    const wasPaused = this.paused;
    const episodeVersion = this.episodeVersion;
    this.paused = true;
    this.accumulator = 0;
    this.manualController.keys.clear();
    try {
      await this.pendingStep;
      if (mode === 'AI') {
        this.hud.setMessage('LOADING PPO MODEL');
        if (!this.aiController.isReady) this.hud.setModelConnection('ONNX 로딩 중');
        await this.aiController.init();
        if (!this.aiController.isReady) {
          if (!this.disposed) {
            this.hud.setMode(this.controlMode, false);
            this.hud.setModelConnection('로드 실패 · ' + this.aiController.loadMessage);
            this.hud.setMessage(
              'MODEL UNAVAILABLE',
              this.aiController.loadMessage + ' 수동 조종은 계속 사용할 수 있습니다.'
            );
            this.view.setPlayLabel('계속 실행');
          }
          return;
        }
        for (const [key, value] of Object.entries(this.sim.config)) {
          if (this.aiController.config[key] !== value) throw new Error(`Physics mismatch: ${key}`);
        }
      }
      if (this.disposed) return;
      this.controlMode = mode;
      if (mode === 'AI') {
        this.sim.controller = this.aiController;
        this.hud.setModelConnection('ONNX 로드 완료');
      }
      this.manualController.reset();
      this.manualController.setEnabled(mode === 'MANUAL');
      this.hud.setMode(mode, false);
      this.hud.setMessage(mode === 'AI' ? 'PPO READY' : 'MANUAL READY');
      this.failed = false;
      this.paused = this.episodeVersion !== episodeVersion ? true : wasPaused;
      this.view.setPlayLabel(this.paused ? '계속 실행' : '일시정지');
      if (mode === 'AI') {
        this.setAutoBenchmark(true);
      }
      this._updateBenchmarkPanel();
      this.view.focusScene();
    } catch (error) {
      if (!this.disposed) {
        this.hud.setMode(this.controlMode, false);
        this.hud.setMessage(`모드 전환 실패: ${error.message}`);
        this.view.setPlayLabel('계속 실행');
      }
    } finally {
      this.switchingMode = false;
      this.lastFrame = null;
      this.accumulator = 0;
      if (!this.disposed) {
        this.hud.setModeBusy(false);
        this.batch.scheduleRestart();
      }
    }
  }

  setAutoBenchmark(enabled) {
    const available = this.controlMode === 'AI' && Boolean(this.aiController.session) && !this.failed;
    this.batch.setEnabled(Boolean(enabled && available));
    this.hud.setAutoBenchmark(this.batch.enabled);
    if (enabled && !available) {
      this.hud.setMessage('자동 반복은 로드된 PPO 모드에서 사용할 수 있습니다.');
    }
  }

  _updateBenchmarkPanel() {
    this.view.updateBenchmarkPanel(this.controlMode, this.batch);
  }

  setSimSpeed(speed) {
    this.simSpeed = speed;
    if (this.latestState?.done) {
      this.batch.cancelRestart();
      this.batch.scheduleRestart();
    }
  }

  togglePlayback() {
    if (!this.running || this.switchingMode || this.failed || this.latestState?.done) return;
    this.paused = !this.paused;
    this.accumulator = 0;
    this.lastFrame = null;
    this.view.setPlayLabel(this.paused ? '계속 실행' : '일시정지');
    this.manualController.keys.clear();
    this.view.focusScene();
  }

  handleVisibility() {
    this.accumulator = 0;
    this.lastFrame = null;
    this.manualController.keys.clear();
    if (document.hidden) this.batch.cancelRestart();
    else this.batch.scheduleRestart();
  }

  _showError(error) {
    this.setAutoBenchmark(false);
    this.failed = true;
    this.accumulator = 0;
    this.hud.setMessage(`ERROR: ${error.message}`);
    console.error(error);
  }

  async dispose() {
    this.batch.cancelRestart();
    this.disposed = true;
    this.running = false;
    cancelAnimationFrame(this.frameId);
    await this.pendingStep;
    if (this.aiController._initPromise) await this.aiController._initPromise;
    await this.aiController.dispose();
  }
}
