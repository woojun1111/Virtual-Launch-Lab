import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RocketLandingSim } from './simulation/RocketLandingSim.js';
import { ManualController } from './ai/ManualController.js';
import { TelemetryHUD } from './ui/TelemetryHUD.js';
import { RocketVisual } from './scene/RocketMeshBuilder.js';

export class VirtualLaunchLabApp {
  constructor() {
    this.container = document.getElementById('app') || document.body;
    this.mode = new URLSearchParams(location.search).get('mode') === 'ppo' ? 'ppo' : 'manual';
    this.manual = this.mode === 'manual' ? new ManualController() : null;
    this.sim = new RocketLandingSim(this.manual ?? undefined);
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
    this.hud = new TelemetryHUD({ onReset: () => this.resetSimulation() });
    this._createControls();
    this.hud.setResetEnabled(false);
    this.hud.setMessage(this.manual ? 'INITIALIZING' : 'LOADING PPO MODEL');
    this.latestState = null;

    this._initScene();
    this._initEnvironment();
    this._bindEvents();
  }

  // 1. Three.js 씬, 카메라, 렌더러 초기화
  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b1120); // 야간/새벽 발사장 분위기
    this.scene.fog = new THREE.FogExp2(0x0b1120, 0.0018);

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
    this.container.appendChild(this.renderer.domElement);

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
  }

  // 2. 지면 및 착륙 패드(LZ-1) 구성
  _initEnvironment() {
    // 지면 그리드
    const gridHelper = new THREE.GridHelper(400, 40, 0x334155, 0x1e293b);
    this.scene.add(gridHelper);

    // 콘크리트 착륙 패드 (반지름 12m 원형 패드)
    const padGeo = new THREE.CylinderGeometry(12, 12.5, 0.3, 32);
    const padMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.8 });
    const padMesh = new THREE.Mesh(padGeo, padMat);
    padMesh.receiveShadow = true;
    padMesh.position.y = -.15;
    this.scene.add(padMesh);

    // 착륙 패드 중앙 타겟 링 (X 마크 대신 발광 링)
    const ringGeo = new THREE.RingGeometry(2.2, 2.7, 32);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.position.y = 0.01;
    this.scene.add(ringMesh);
  }

  // 3. 시뮬레이션 시작 및 AI 모델 로드
  async start() {
    if (this.running || this.disposed) return;
    try {
      await this.sim.init();
      if (Math.abs(this.sim.config.dt-this.FIXED_DT) > 1e-12)
        throw new Error('physics_config.dt must be 0.05');
      this.rocketVisual.dispose();
      this.rocketVisual = new RocketVisual(this.sim.config.rocket_length);
      this.scene.add(this.rocketVisual.rootGroup);
      this.hud.initialFuel = this.sim.config.initial_fuel_mass;
      this.running = true;
      this.hud.setResetEnabled(true);
      this.resetSimulation();
      this.frameId = requestAnimationFrame(t => this._animate(t));
    } catch (error) {
      this._showError(error);
    }
    return this;
  }

  resetSimulation() {
    if (!this.running || this.disposed) return;
    // A pending inference owns the old state until it completes.
    this.resetRequested = true;
    this.hud.setResetEnabled(false);
    if (!this.pendingStep) this._applyReset();
  }

  _applyReset() {
    this.resetRequested = false;
    this.failed = false;
    this.accumulator = 0;
    this.lastFrame = null;
    const random = (a,b) => a+Math.random()*(b-a);
    this.latestState = this.sim.reset({
      x: random(-50,50), y: random(150,250),
      vx: random(-10,10), vy: random(-25,-5),
      theta: random(-.2,.2), omega: 0,
      fuel: this.sim.config.initial_fuel_mass,
    });
    this.rocketVisual.resetVisuals();
    this.hud.hideBanner();
    this.hud.setResetEnabled(true);
    this.paused = true;
    this.playButton.textContent = '시뮬레이션 시작';
    // Frame the full initial drop and landing pad.
    this.camera.position.set(this.latestState.x*.5, 110, 330);
    this.controls.target.set(0,100,0);
  }

  _animate(timestamp) {
    if (this.disposed) return;
    this.frameId = requestAnimationFrame(t => this._animate(t));
    const dt = this.lastFrame === null ? 0 : Math.max(0,(timestamp-this.lastFrame)/1000);
    this.lastFrame = timestamp;
    if (!this.paused && !document.hidden && !this.failed && this.latestState && !this.latestState.done) {
      // Cap backlog to 5 ticks: slow hardware slows wall-clock playback, never
      // increases the physics dt or skips an inference within a simulated tick.
      this.accumulator = Math.min(.25, this.accumulator+dt);
      this._pumpPhysics();
    }
    if (this.latestState) {
      this.rocketVisual.updateVisuals(this.latestState, timestamp/1000);
      this.hud.update(this.latestState);
    }
    this.controls.update();
    this.renderer.render(this.scene,this.camera);
  }

  _pumpPhysics() {
    if (this.paused || this.pendingStep || this.resetRequested || this.failed || document.hidden ||
        this.latestState.done || this.accumulator+1e-12 < this.FIXED_DT) return;
    this.accumulator = Math.max(0,this.accumulator-this.FIXED_DT);
    this.pendingStep = this.sim.step(this.FIXED_DT)
      .then(state => {
        if (!this.disposed) this.latestState = state;
        if (state.done) this.accumulator = 0;
      })
      .catch(error => { if (!this.disposed) this._showError(error); })
      .finally(() => {
        this.pendingStep = null;
        if (this.disposed) return;
        if (this.resetRequested) this._applyReset();
        else this._pumpPhysics();
      });
  }

  _createControls() {
    const panel = this.hud.root.querySelector('.vll-top-left');
    this.hud.root.querySelector('.vll-subtitle').textContent = this.manual
      ? '수동 물리 실험 · 학습된 정책 아님' : 'PPO 추론 · 브라우저에서 학습하지 않음';
    const modes = document.createElement('div');
    modes.innerHTML = '<a href="?mode=manual">수동 실험</a> · <a href="?mode=ppo">PPO 모델 실행</a>';
    modes.style.cssText = 'background:#0f172a;padding:10px;border-radius:6px';
    modes.querySelectorAll('a').forEach(a => {a.style.color='#7dd3fc';});
    panel.appendChild(modes);
    this.playButton = document.createElement('button');
    this.playButton.className = 'vll-btn-reset';
    this.playButton.textContent = '시뮬레이션 시작';
    this.playButton.onclick = () => {
      if (!this.running || this.failed || this.latestState?.done) return;
      this.paused = !this.paused;
      this.accumulator = 0; this.lastFrame = null;
      this.playButton.textContent = this.paused ? '계속 실행' : '일시정지';
    };
    panel.appendChild(this.playButton);
    if (this.manual) {
      const box = document.createElement('div'); box.className='vll-badge';
      for (const [key,label,min,max,value] of [['rawThrust','추력',-1,1,0],['rawGimbal','짐벌',-1,1,0]]) {
        const row = document.createElement('label'); row.style.display='block';
        const text = document.createElement('span');
        const input = document.createElement('input');
        input.type='range'; input.min=min; input.max=max; input.step=.01; input.value=value;
        input.setAttribute('aria-label',label); input.style.width='150px';
        const update = () => {
          this.manual[key]=Number(input.value);
          text.textContent = key === 'rawThrust' ? `추력 ${Math.round((.4+(Number(input.value)+1)*.3)*100)}% ` : `짐벌 ${(Number(input.value)*15).toFixed(1)}° `;
        };
        input.oninput=update; update(); row.append(text,input); box.append(row);
      }
      panel.append(box);
    }
    const note=document.createElement('div'); note.className='vll-badge';
    note.textContent='하강 착륙 실험 · 2D 물리 / 3D 표시 · R: 초기화';
    panel.append(note);
  }

  _showError(error) {
    this.failed = true;
    this.accumulator = 0;
    this.hud.setMessage(`ERROR: ${error.message}`);
    if (!this.manual) this.hud.root.querySelector('.vll-subtitle').textContent = '모델 로드 실패: ONNX와 norm_stats.json을 확인하거나 수동 실험을 선택하세요.';
    console.error(error);
  }

  _bindEvents() {
    this.onResize = () => {
      this.camera.aspect = window.innerWidth/window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth,window.innerHeight);
    };
    this.onKey = event => {
      const target = event.target;
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey ||
          target?.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(target?.tagName)) return;
      if (event.key.toLowerCase() === 'r') this.resetSimulation();
    };
    this.onVisibility = () => { this.accumulator=0; this.lastFrame=null; };
    window.addEventListener('resize',this.onResize);
    window.addEventListener('keydown',this.onKey);
    document.addEventListener('visibilitychange',this.onVisibility);
  }

  async dispose() {
    this.disposed = true;
    this.running = false;
    cancelAnimationFrame(this.frameId);
    window.removeEventListener('resize',this.onResize);
    window.removeEventListener('keydown',this.onKey);
    document.removeEventListener('visibilitychange',this.onVisibility);
    await this.pendingStep;
    this.rocketVisual.dispose();
    this.scene.traverse(object => {
      object.geometry?.dispose();
      if (object.material) (Array.isArray(object.material) ? object.material : [object.material]).forEach(m => m.dispose());
    });
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.hud.dispose();
    await this.sim.controller.dispose();
  }
}

// Load this entry with an ESM bundler (three + onnxruntime-web). Serve exported
// public/models assets at /models/. This does not replace the old dist page.
// The browser executes an exported policy; it does not perform PPO training.
// Matching equations/dt is not a guarantee of bitwise Python/ONNX equivalence.
export const app = new VirtualLaunchLabApp();
void app.start();
