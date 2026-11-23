import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RocketLandingSim } from './simulation/RocketLandingSim.js';
import physicsConfig from '../shared/physics_config.json';
import RocketRLController from './ai/RocketRLController.js';
import { ManualRocketController } from './controls/ManualRocketController.js';
import { TelemetryHUD } from './ui/TelemetryHUD.js';
import { TrajectoryVisualizer } from './scene/TrajectoryVisualizer.js';
import { ExhaustPlumeParticles } from './scene/ExhaustPlumeParticles.js';
import { RocketVisual } from './scene/RocketMeshBuilder.js';

export class VirtualLaunchLabApp {
  constructor() {
    this.container = document.getElementById('app') || document.body;
    this.requestedMode = new URLSearchParams(location.search).get('mode') === 'ppo' ? 'AI' : 'MANUAL';
    this.controlMode = 'MANUAL';
    this.aiController = new RocketRLController();
    // Load constants without requiring ONNX artifacts for manual use.
    this.sim = new RocketLandingSim({
      config: Object.freeze({ ...physicsConfig }),
      async init() {},
      async predictAction() {
        throw new Error('AI model is not loaded; supply a manual action');
      }
    });
    this.manualController = new ManualRocketController({
      onToggleMode: () => {
        void this.changeMode(this.controlMode === 'AI' ? 'MANUAL' : 'AI');
      }
    });
    this.switchingMode = false;
    this.episodeVersion = 0;
    this.autoBenchmark = false;
    this.autoBenchmarkTimer = null;
    this.autoRestartRequested = false;
    this.simSpeed = 1;
    this.paused = true;
    this.rocketVisual = new RocketVisual(10.0);

    // 고정 물리 타임스텝 (RL 학습 dt = 0.05초와 일치)
    this.FIXED_DT = 0.05;
    this.accumulator = 0;
    this.lastFrame = null;
    this.pendingStep = null;
    this.resetRequested = false;
    this.running = false;
    this.disposed = false;
    this.failed = false;
    this.hud = new TelemetryHUD({
      onReset: () => this.resetSimulation(),
      initialMode: this.controlMode,
      onModeChange: (mode) => {
        void this.changeMode(mode);
      },
      onAutoBenchmarkToggle: (enabled) => this.setAutoBenchmark(enabled)
    });
    this._createControls();
    this.hud.setResetEnabled(false);
    this.hud.setMessage('INITIALIZING');
    this.latestState = null;

    this._initScene();
    this._initEnvironment();
    this._bindEvents();
  }

  // 1. Three.js 씬, 카메라, 렌더러 초기화
  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x030712); // 야간/새벽 발사장 분위기
    this.scene.fog = new THREE.FogExp2(0x030712, 0.0018);

    this.camera = new THREE.PerspectiveCamera(
      50,
      window.innerWidth / window.innerHeight,
      0.1,
      1500
    );
    this.camera.position.set(0, 60, 140);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.container.appendChild(this.renderer.domElement);
    this.renderer.domElement.tabIndex = 0;

    // 카메라 오빗 컨트롤
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.target.set(0, 40, 0);

    // 조명 설정
    const ambientLight = new THREE.AmbientLight(0x94a3b8, 0.8);
    this.scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.8);
    dirLight.position.set(80, 150, 100);
    dirLight.castShadow = true;
    this.scene.add(dirLight);

    // 로켓 3D 모델 씬에 추가
    this.scene.add(this.rocketVisual.rootGroup);
    this.trajectoryVis = new TrajectoryVisualizer(this.scene);
    this.exhaustParticles = new ExhaustPlumeParticles(this.scene);
    this.nozzlePosition = new THREE.Vector3();
    this.exhaustParticles.setViewport(this.camera, this.renderer.domElement.height);
  }

  // 2. 지면 및 착륙 패드(LZ-1) 구성
  _initEnvironment() {
    // 지면 그리드
    const gridHelper = new THREE.GridHelper(400, 40, 0x334155, 0x1e293b);
    this.scene.add(gridHelper);

    // 콘크리트 착륙 패드 (반지름 12m 원형 패드)
    const padGeo = new THREE.CylinderGeometry(12, 12.5, 0.3, 32);
    const padMat = new THREE.MeshStandardMaterial({ color: 0x172233, roughness: 0.95 });
    const padMesh = new THREE.Mesh(padGeo, padMat);
    padMesh.receiveShadow = true;
    padMesh.position.y = -0.15;
    this.scene.add(padMesh);

    // 착륙 패드 중앙 타겟 링 (X 마크 대신 발광 링)
    const ringGeo = new THREE.RingGeometry(2.2, 2.7, 32);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.position.y = 0.01;
    this.scene.add(ringMesh);
    for (const radius of [3.3, 8.5, 11.7]) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(radius, radius + 0.055, 128).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.65, toneMapped: false })
      );
      ring.position.y = 0.02;
      this.scene.add(ring);
    }
    const backlight = new THREE.SpotLight(0x7dd3fc, 700, 150, Math.PI / 5, 0.8, 1.5);
    backlight.position.set(-25, 30, -22);
    backlight.target.position.set(0, 3, 0);
    this.scene.add(backlight, backlight.target);
  }

  // 3. 시뮬레이션 시작 및 AI 컨트롤러 초기화
  async start() {
    if (this.running || this.disposed) return;
    try {
      await this.sim.init();
      await this.aiController.init();
      if (this.disposed) return;
      if (Math.abs(this.sim.config.dt - this.FIXED_DT) > 1e-12) {
        throw new Error('physics_config.dt must be 0.05');
      }
      this.rocketVisual.dispose();
      this.rocketVisual = new RocketVisual(this.sim.config.rocket_length);
      this.scene.add(this.rocketVisual.rootGroup);
      this.trajectoryVis.gravity = this.sim.config.gravity;
      this.manualController.maxGimbalRad = (this.sim.config.max_gimbal_deg * Math.PI) / 180;
      this.manualController.minThrustRatio = this.sim.config.min_thrust_ratio;
      this.hud.initialFuel = this.sim.config.initial_fuel_mass;
      this.running = true;
      this.hud.setResetEnabled(true);
      this._updateRLPanel();
      this.resetSimulation();
      this.frameId = requestAnimationFrame((t) => this._animate(t));
      if (this.requestedMode === 'AI') await this.changeMode('AI');
    } catch (error) {
      this._showError(error);
    }
    return this;
  }

  resetSimulation({ automatic = false } = {}) {
    this._clearAutoRestart();
    if (!automatic) this.setAutoBenchmark(false);
    this.autoRestartRequested = automatic;
    if (!this.running || this.disposed) return;
    // A pending inference owns the old state until it completes.
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
    this.rocketVisual.resetVisuals();
    this.trajectoryVis.reset();
    this.exhaustParticles.reset();
    this._recordTrajectory(this.latestState);
    this.hud.hideBanner();
    this.hud.setResetEnabled(true);
    this.paused = true;
    if (this.autoRestartRequested) this.paused = false;
    this.autoRestartRequested = false;
    this.playButton.textContent = this.paused ? '시뮬레이션 시작' : '일시정지';
    // Frame the full initial drop and landing pad.
    this.camera.position.set(this.latestState.x * 0.5, 110, 330);
    this.controls.target.set(0, 100, 0);
    this._updateRLPanel();
  }

  _animate(timestamp) {
    if (this.disposed) return;
    this.frameId = requestAnimationFrame((t) => this._animate(t));
    const dt = this.lastFrame === null ? 0 : Math.max(0, (timestamp - this.lastFrame) / 1000);
    this.lastFrame = timestamp;
    if (!this.paused && !document.hidden && !this.failed && this.latestState && !this.latestState.done) {
      // 배속(1x / 5x / 20x)에 맞춰 물리 타임스텝(FIXED_DT) 누적량 확장
      const maxBacklog = Math.min(2.5, 0.25 * this.simSpeed);
      this.accumulator = Math.min(maxBacklog, this.accumulator + dt * this.simSpeed);
      this._pumpPhysics();
    }
    if (this.latestState) {
      this.rocketVisual.updateVisuals(this.latestState, timestamp / 1000);
      this.hud.update(this.latestState);
      this.trajectoryVis.updatePrediction(this.latestState, this.latestState.time);
      this.rocketVisual.getNozzleWorldPosition(this.nozzlePosition);
      this.exhaustParticles.update(
        this.latestState,
        this.paused || document.hidden || this.failed ? 0 : dt * Math.min(this.simSpeed, 4),
        this.nozzlePosition
      );
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
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
          this._recordTrajectory(state);
          if (state.done) {
            if (this.controlMode === 'AI' && typeof this.aiController.notifyEpisodeEnd === 'function') {
              const finalArr = [state.x, state.y, state.vx, state.vy, state.theta, state.omega, state.fuel];
              this.aiController.notifyEpisodeEnd(
                finalArr,
                typeof state.landed === 'boolean' ? state.landed : null
              );
              this._updateRLPanel();
            }
            this.hud.recordResult(state, this.episodeVersion);
            this._scheduleAutoRestart();
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

  _recordTrajectory(state) {
    this.rocketVisual.setPose(state);
    this.rocketVisual.getNozzleWorldPosition(this.nozzlePosition);
    this.trajectoryVis.recordStep(state, this.nozzlePosition);
  }

  _setSimSpeed(speed) {
    this.simSpeed = speed;
    if (this.speedButtons) {
      for (const [s, btn] of Object.entries(this.speedButtons)) {
        const active = Number(s) === speed;
        btn.style.background = active ? 'rgba(56, 189, 248, 0.25)' : 'rgba(15, 23, 42, 0.85)';
        btn.style.borderColor = active ? '#38bdf8' : 'rgba(148, 163, 184, 0.35)';
        btn.style.color = active ? '#e0f2fe' : '#94a3b8';
      }
    }
    if (this.autoBenchmark && this.latestState?.done) {
      this._clearAutoRestart();
      this._scheduleAutoRestart();
    }
  }

  _updateRLPanel() {
    if (!this.rlStatsText || !this.rlStatusTag) return;
    const isAI = this.controlMode === 'AI';
    this.rlStatusTag.textContent = isAI ? (this.autoBenchmark ? 'AUTO LEARNING' : 'AI ACTIVE') : 'STANDBY';
    this.rlStatusTag.style.color = isAI ? '#38bdf8' : '#94a3b8';

    if (typeof this.aiController.getStats === 'function') {
      const s = this.aiController.getStats();
      const bestStr = s.bestReward !== null ? s.bestReward.toFixed(1) : '-';
      this.rlStatsText.textContent = `RUN #${s.episodeCount} · 최근 성공률 ${s.recentRate}% · 보상 ${s.lastReward.toFixed(1)} (최고 ${bestStr})`;
    }
  }

  _createControls() {
    const panel = this.hud.root.querySelector('.vll-top-left');
    if (!panel) return;

    this.playButton = document.createElement('button');
    this.playButton.className = 'vll-btn-action';
    this.playButton.textContent = '시뮬레이션 시작';
    this.playButton.onclick = () => {
      if (!this.running || this.switchingMode || this.failed || this.latestState?.done) return;
      this.paused = !this.paused;
      this.accumulator = 0;
      this.lastFrame = null;
      this.playButton.textContent = this.paused ? '계속 실행' : '일시정지';
      this.manualController.keys.clear();
      this.renderer.domElement.focus();
    };
    panel.appendChild(this.playButton);

    // 온라인 강화학습 현황 및 배속 제어 패널
    const rlCard = document.createElement('div');
    rlCard.className = 'vll-panel vll-badge';
    rlCard.style.display = 'flex';
    rlCard.style.flexDirection = 'column';
    rlCard.style.gap = '6px';
    rlCard.style.maxWidth = '310px';
    rlCard.style.padding = '8px 10px';

    const headerRow = document.createElement('div');
    headerRow.style.display = 'flex';
    headerRow.style.justifyContent = 'space-between';
    headerRow.style.alignItems = 'center';
    headerRow.style.fontSize = '11px';
    headerRow.style.fontWeight = '700';
    headerRow.style.letterSpacing = '0.06em';

    const titleSpan = document.createElement('span');
    titleSpan.textContent = 'ONLINE RL TRAINING';
    titleSpan.style.color = '#e2e8f0';

    this.rlStatusTag = document.createElement('span');
    this.rlStatusTag.textContent = 'STANDBY';
    this.rlStatusTag.style.color = '#94a3b8';

    headerRow.append(titleSpan, this.rlStatusTag);

    this.rlStatsText = document.createElement('div');
    this.rlStatsText.style.fontSize = '11px';
    this.rlStatsText.style.color = '#cbd5e1';
    this.rlStatsText.textContent = 'RUN #0 · 최근 성공률 0% · 보상 0.0 (최고 -)';

    const btnRow = document.createElement('div');
    btnRow.style.display = 'flex';
    btnRow.style.gap = '5px';
    btnRow.style.alignItems = 'center';

    this.speedButtons = {};
    for (const speed of [1, 5, 20]) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = `${speed}x`;
      btn.style.padding = '3px 8px';
      btn.style.fontSize = '11px';
      btn.style.fontWeight = '700';
      btn.style.borderRadius = '4px';
      btn.style.border = '1px solid rgba(148, 163, 184, 0.35)';
      btn.style.cursor = 'pointer';
      btn.onclick = () => this._setSimSpeed(speed);
      this.speedButtons[speed] = btn;
      btnRow.appendChild(btn);
    }

    const resetRLBtn = document.createElement('button');
    resetRLBtn.type = 'button';
    resetRLBtn.textContent = 'AI 초기화';
    resetRLBtn.style.marginLeft = 'auto';
    resetRLBtn.style.padding = '3px 8px';
    resetRLBtn.style.fontSize = '11px';
    resetRLBtn.style.fontWeight = '600';
    resetRLBtn.style.borderRadius = '4px';
    resetRLBtn.style.border = '1px solid rgba(248, 113, 113, 0.45)';
    resetRLBtn.style.background = 'rgba(127, 29, 29, 0.35)';
    resetRLBtn.style.color = '#fecaca';
    resetRLBtn.style.cursor = 'pointer';
    resetRLBtn.onclick = () => {
      if (typeof this.aiController.resetTraining === 'function') {
        this.aiController.resetTraining();
        this._updateRLPanel();
        this.hud.setMessage('ONLINE RL RESET', '신경망 가중치가 초기화되었습니다. RUN #1부터 다시 학습합니다.');
        if (this.controlMode === 'AI') {
          this.resetSimulation({ automatic: !this.paused });
        }
      }
    };
    btnRow.appendChild(resetRLBtn);

    rlCard.append(headerRow, this.rlStatsText, btnRow);
    panel.appendChild(rlCard);
    this._setSimSpeed(1);

    const note = document.createElement('div');
    note.className = 'vll-panel vll-badge';
    note.textContent = '하강 착륙 실험 · 2D 물리 / 3D 표시 · R: 초기화';
    panel.append(note);

    const legend = document.createElement('div');
    legend.className = 'vll-panel vll-badge';
    legend.style.maxWidth = '290px';
    legend.textContent =
      '파랑: 노즐 궤적 · 점선/링: 추력·항력 제외 낙하지점. 초록 ≤2.5m / 주황 ≤12m / 빨강 >12m. 초록은 착륙 성공을 뜻하지 않습니다.';
    panel.append(legend);
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
        this.hud.setMessage('INITIALIZING ONLINE RL');
        await this.aiController.init();
        if (!this.aiController.isReady) {
          if (!this.disposed) {
            this.hud.setMode(this.controlMode, false);
            this.hud.setMessage(
              'MODEL UNAVAILABLE',
              this.aiController.loadMessage + ' 수동 조종은 계속 사용할 수 있습니다.'
            );
            this.playButton.textContent = '계속 실행';
          }
          return;
        }
        // The physics constants loaded for both controllers must match.
        for (const [key, value] of Object.entries(this.sim.config)) {
          if (this.aiController.config[key] !== value) throw new Error(`Physics mismatch: ${key}`);
        }
      }
      if (this.disposed) return;
      this.controlMode = mode;
      if (mode === 'AI') this.sim.controller = this.aiController;
      this.manualController.reset();
      this.manualController.setEnabled(mode === 'MANUAL');
      this.hud.setMode(mode, false);
      this.hud.setMessage(
        mode === 'AI' ? 'ONLINE RL READY' : 'MANUAL READY',
        mode === 'AI' ? this.aiController.loadMessage : ''
      );
      this.failed = false;
      // Never resume an episode which was reset while the model was loading.
      this.paused = this.episodeVersion !== episodeVersion ? true : wasPaused;
      this.playButton.textContent = this.paused ? '계속 실행' : '일시정지';
      if (mode === 'AI') {
        this.setAutoBenchmark(true);
      }
      this._updateRLPanel();
      this.renderer.domElement.focus();
    } catch (error) {
      if (!this.disposed) {
        this.hud.setMode(this.controlMode, false);
        this.hud.setMessage(`모드 전환 실패: ${error.message}`);
        this.playButton.textContent = '계속 실행';
      }
    } finally {
      this.switchingMode = false;
      this.lastFrame = null;
      this.accumulator = 0;
      if (!this.disposed) this.hud.setModeBusy(false);
    }
  }

  setAutoBenchmark(enabled) {
    this._clearAutoRestart();
    // AI 모드(온라인 RL 또는 ONNX 세션)가 준비된 상태에서 자동 연속 실행 허용
    const aiReady = Boolean(this.aiController.isReady || this.aiController.session);
    this.autoBenchmark = Boolean(enabled && this.controlMode === 'AI' && aiReady && !this.failed);
    this.hud.setAutoBenchmark(this.autoBenchmark);
    this._updateRLPanel();
    if (enabled && !this.autoBenchmark) {
      this.hud.setMessage('자동 반복은 AI AUTOPILOT 모드에서 사용할 수 있습니다.');
    }
    if (this.autoBenchmark) this._scheduleAutoRestart();
  }

  _clearAutoRestart() {
    if (this.autoBenchmarkTimer !== null) clearTimeout(this.autoBenchmarkTimer);
    this.autoBenchmarkTimer = null;
  }

  _scheduleAutoRestart() {
    if (
      !this.autoBenchmark ||
      !this.latestState?.done ||
      this.disposed ||
      document.hidden ||
      this.autoBenchmarkTimer !== null
    ) {
      return;
    }
    const episode = this.episodeVersion;
    const delayMs = this.simSpeed >= 10 ? 80 : this.simSpeed > 1 ? 300 : 1200;
    this.autoBenchmarkTimer = setTimeout(() => {
      this.autoBenchmarkTimer = null;
      if (
        episode === this.episodeVersion &&
        this.autoBenchmark &&
        !this.disposed &&
        !document.hidden &&
        !this.switchingMode
      ) {
        this.resetSimulation({ automatic: true });
      }
    }, delayMs);
  }

  _showError(error) {
    this.setAutoBenchmark(false);
    this.failed = true;
    this.accumulator = 0;
    this.hud.setMessage(`ERROR: ${error.message}`);
    console.error(error);
  }

  _bindEvents() {
    this.onResize = () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.exhaustParticles.setViewport(this.camera, this.renderer.domElement.height);
    };
    this.onKey = (event) => {
      const target = event.target;
      if (
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        target?.isContentEditable ||
        /INPUT|TEXTAREA|SELECT/.test(target?.tagName)
      ) {
        return;
      }
      if (event.key.toLowerCase() === 'r') this.resetSimulation();
    };
    this.onVisibility = () => {
      this.accumulator = 0;
      this.lastFrame = null;
      this.manualController.keys.clear();
      if (document.hidden) this._clearAutoRestart();
      else this._scheduleAutoRestart();
    };
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKey);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  async dispose() {
    this._clearAutoRestart();
    this.disposed = true;
    this.running = false;
    cancelAnimationFrame(this.frameId);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKey);
    document.removeEventListener('visibilitychange', this.onVisibility);
    await this.pendingStep;
    this.rocketVisual.dispose();
    this.trajectoryVis.dispose();
    this.exhaustParticles.dispose();
    this.scene.traverse((object) => {
      object.geometry?.dispose();
      if (object.material) {
        (Array.isArray(object.material) ? object.material : [object.material]).forEach((m) => m.dispose());
      }
    });
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.manualController.dispose();
    this.hud.dispose();
    if (this.aiController._initPromise) await this.aiController._initPromise.catch(() => {});
    await this.aiController.dispose();
  }
}

export const app = new VirtualLaunchLabApp();
void app.start();
