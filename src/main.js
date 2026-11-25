import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ManualRocketController } from './controls/ManualRocketController.js';
import { TelemetryHUD } from './ui/TelemetryHUD.js';
import { TrajectoryVisualizer } from './scene/TrajectoryVisualizer.js';
import { ExhaustPlumeParticles } from './scene/ExhaustPlumeParticles.js';
import { RocketVisual } from './scene/RocketMeshBuilder.js';
import { SimulationController } from './simulationController.js';

export class VirtualLaunchLabApp {
  constructor() {
    this.container = document.getElementById('app') || document.body;
    this.manualController = new ManualRocketController({
      onToggleMode: () => {
        void this.controller.changeMode(this.controller.controlMode === 'AI' ? 'MANUAL' : 'AI');
      }
    });
    this.hud = new TelemetryHUD({
      onReset: () => this.controller.resetSimulation(),
      onModeChange: (mode) => { void this.controller.changeMode(mode); },
      onWindChange: (speed) => this.controller.sim.setWindSpeed(speed),
      onAutoBenchmarkToggle: (enabled) => this.controller.setAutoBenchmark(enabled)
    });
    this.controller = new SimulationController({
      view: this,
      hud: this.hud,
      manualController: this.manualController,
      requestedMode: new URLSearchParams(location.search).get('mode') === 'ppo' ? 'AI' : 'MANUAL'
    });
    this._createControls();
    this.hud.setResetEnabled(false);
    this.hud.setMessage('INITIALIZING');
    this._initScene();
    this._initEnvironment();
    this._bindEvents();
  }

  start() {
    return this.controller.start();
  }

  configureScene(config) {
    this.rocketVisual = new RocketVisual(config.rocket_length);
    this.scene.add(this.rocketVisual.rootGroup);
    this.trajectoryVis.gravity = config.gravity;
  }

  resetScene(state) {
    this.rocketVisual.resetVisuals();
    this.trajectoryVis.reset();
    this.exhaustParticles.reset();
    this.recordTrajectory(state);
    this.camera.position.set(state.x * 0.5, 110, 330);
    this.controls.target.set(0, 100, 0);
  }

  renderFrame(state, timestamp, visualDt) {
    if (state) {
      this.rocketVisual.updateVisuals(state, timestamp / 1000);
      this.hud.update(state);
      this.trajectoryVis.updatePrediction(state, state.time);
      this.rocketVisual.getNozzleWorldPosition(this.nozzlePosition);
      this.exhaustParticles.update(state, visualDt, this.nozzlePosition);
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  setPlayLabel(label) {
    this.playButton.textContent = label;
  }

  focusScene() {
    this.renderer.domElement.focus();
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x030712);
    this.scene.fog = new THREE.FogExp2(0x030712, 0.0018);

    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1500);
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

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.target.set(0, 40, 0);

    const ambientLight = new THREE.AmbientLight(0x94a3b8, 0.8);
    this.scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.8);
    dirLight.position.set(80, 150, 100);
    dirLight.castShadow = true;
    this.scene.add(dirLight);

    this.trajectoryVis = new TrajectoryVisualizer(this.scene);
    this.exhaustParticles = new ExhaustPlumeParticles(this.scene);
    this.nozzlePosition = new THREE.Vector3();
    this.exhaustParticles.setViewport(this.camera, this.renderer.domElement.height);
  }

  _initEnvironment() {
    const gridHelper = new THREE.GridHelper(400, 40, 0x334155, 0x1e293b);
    this.scene.add(gridHelper);

    const padGeo = new THREE.CylinderGeometry(12, 12.5, 0.3, 32);
    const padMat = new THREE.MeshStandardMaterial({ color: 0x172233, roughness: 0.95 });
    const padMesh = new THREE.Mesh(padGeo, padMat);
    padMesh.receiveShadow = true;
    padMesh.position.y = -0.15;
    this.scene.add(padMesh);

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

  recordTrajectory(state) {
    this.rocketVisual.setPose(state);
    this.rocketVisual.getNozzleWorldPosition(this.nozzlePosition);
    this.trajectoryVis.recordStep(state, this.nozzlePosition);
  }

  _setSimSpeed(speed) {
    this.controller.setSimSpeed(speed);
    if (this.speedButtons) {
      for (const [s, btn] of Object.entries(this.speedButtons)) {
        const active = Number(s) === speed;
        btn.style.background = active ? 'rgba(56, 189, 248, 0.25)' : 'rgba(15, 23, 42, 0.85)';
        btn.style.borderColor = active ? '#38bdf8' : 'rgba(148, 163, 184, 0.35)';
        btn.style.color = active ? '#e0f2fe' : '#94a3b8';
      }
    }
  }

  updateBenchmarkPanel(mode, batch) {
    if (!this.benchStatsText || !this.benchStatusTag) return;
    const isAI = mode === 'AI';
    this.benchStatusTag.textContent = isAI ? (batch.enabled ? 'AUTO RUN' : 'AI READY') : 'STANDBY';
    this.benchStatusTag.style.color = isAI ? '#38bdf8' : '#94a3b8';
    this.benchStatsText.textContent = `RUN #${batch.runCount} · 최근 20회 착륙 성공률 ${batch.successRate}%`;
  }

  _createControls() {
    const panel = this.hud.root.querySelector('.vll-top-left');
    if (!panel) return;

    this.playButton = document.createElement('button');
    this.playButton.className = 'vll-btn-action';
    this.playButton.textContent = '시뮬레이션 시작';
    this.playButton.onclick = () => this.controller.togglePlayback();
    panel.appendChild(this.playButton);

    const benchCard = document.createElement('div');
    benchCard.className = 'vll-panel vll-badge';
    benchCard.style.display = 'flex';
    benchCard.style.flexDirection = 'column';
    benchCard.style.gap = '6px';
    benchCard.style.maxWidth = '310px';
    benchCard.style.padding = '8px 10px';

    const headerRow = document.createElement('div');
    headerRow.style.display = 'flex';
    headerRow.style.justifyContent = 'space-between';
    headerRow.style.alignItems = 'center';
    headerRow.style.fontSize = '11px';
    headerRow.style.fontWeight = '700';
    headerRow.style.letterSpacing = '0.06em';

    const titleSpan = document.createElement('span');
    titleSpan.textContent = 'PPO POLICY BENCHMARK';
    titleSpan.style.color = '#e2e8f0';

    this.benchStatusTag = document.createElement('span');
    this.benchStatusTag.textContent = 'STANDBY';
    this.benchStatusTag.style.color = '#94a3b8';

    headerRow.append(titleSpan, this.benchStatusTag);

    this.benchStatsText = document.createElement('div');
    this.benchStatsText.style.fontSize = '11px';
    this.benchStatsText.style.color = '#cbd5e1';
    this.benchStatsText.textContent = 'RUN #0 · 최근 20회 착륙 성공률 0%';

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

    const resetCountBtn = document.createElement('button');
    resetCountBtn.type = 'button';
    resetCountBtn.textContent = '기록 초기화';
    resetCountBtn.style.marginLeft = 'auto';
    resetCountBtn.style.padding = '3px 8px';
    resetCountBtn.style.fontSize = '11px';
    resetCountBtn.style.fontWeight = '600';
    resetCountBtn.style.borderRadius = '4px';
    resetCountBtn.style.border = '1px solid rgba(148, 163, 184, 0.45)';
    resetCountBtn.style.background = 'rgba(30, 41, 59, 0.6)';
    resetCountBtn.style.color = '#e2e8f0';
    resetCountBtn.style.cursor = 'pointer';
    resetCountBtn.onclick = () => this.controller.batch.resetStats();
    btnRow.appendChild(resetCountBtn);

    benchCard.append(headerRow, this.benchStatsText, btnRow);
    panel.appendChild(benchCard);
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
      if (event.key.toLowerCase() === 'r') this.controller.resetSimulation();
    };
    this.onVisibility = () => this.controller.handleVisibility();
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKey);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  async dispose() {
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKey);
    document.removeEventListener('visibilitychange', this.onVisibility);
    await this.controller.dispose();
    this.rocketVisual?.dispose();
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

  }
}

export const app = new VirtualLaunchLabApp();
void app.start();
