export class TelemetryHUD {
  constructor({ onReset, onModeChange, initialFuel = 500.0, initialMode = 'MANUAL' } = {}) {
    if (!Number.isFinite(initialFuel) || initialFuel <= 0) throw new Error('initialFuel must be positive');
    this.onReset = onReset;
    this.onModeChange = onModeChange;
    this.initialFuel = initialFuel;
    this._injectStyles();
    this._createDOM();
    this._createModeControls();
    this.setMode(initialMode, false);
  }

  _injectStyles() {
    if (document.getElementById('vll-hud-style')) return;

    const style = document.createElement('style');
    style.id = 'vll-hud-style';
    style.textContent = `
      .vll-hud-root {
        position: fixed;
        inset: 0;
        pointer-events: none;
        font-family: 'JetBrains Mono', 'Fira Code', Consolas, monospace;
        color: #e2e8f0;
        user-select: none;
        z-index: 100;
      }

      /* 좌측 상단: 미션 타이틀 & 제어 버튼 */
      .vll-top-left {
        position: absolute;
        top: 20px;
        left: 20px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        pointer-events: auto;
      }

      .vll-badge {
        background: rgba(15, 23, 42, 0.78);
        border: 1px solid rgba(56, 189, 248, 0.35);
        backdrop-filter: blur(8px);
        padding: 10px 14px;
        border-radius: 6px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
      }

      .vll-title {
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.08em;
        color: #38bdf8;
        margin-bottom: 4px;
      }

      .vll-subtitle {
        font-size: 11px;
        color: #94a3b8;
      }

      .vll-btn-reset {
        background: rgba(14, 165, 233, 0.2);
        border: 1px solid #38bdf8;
        color: #f8fafc;
        font-family: inherit;
        font-size: 12px;
        font-weight: 600;
        padding: 8px 14px;
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.15s ease;
        text-align: center;
      }

      .vll-btn-reset:hover {
        background: rgba(56, 189, 248, 0.35);
        transform: translateY(-1px);
      }

      .vll-btn-reset:active {
        transform: translateY(0);
      }

      /* 우측 상단: 실시간 텔레메트리 수치 패널 */
      .vll-telemetry-panel {
        position: absolute;
        top: 20px;
        right: 20px;
        width: 260px;
        background: rgba(15, 23, 42, 0.78);
        border: 1px solid rgba(148, 163, 184, 0.25);
        backdrop-filter: blur(8px);
        border-radius: 8px;
        padding: 14px 16px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .vll-panel-header {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.1em;
        color: #94a3b8;
        border-bottom: 1px solid rgba(148, 163, 184, 0.2);
        padding-bottom: 6px;
        display: flex;
        justify-content: space-between;
      }

      .vll-status-dot {
        color: #22c55e;
      }

      .vll-metric-row {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        font-size: 12px;
      }

      .vll-metric-label {
        color: #94a3b8;
      }

      .vll-metric-value {
        font-size: 14px;
        font-weight: 700;
        color: #f8fafc;
        font-variant-numeric: tabular-nums;
      }

      .vll-unit {
        font-size: 11px;
        font-weight: 400;
        color: #64748b;
        margin-left: 3px;
      }

      /* 게이지 바 (연료 & 추력) */
      .vll-gauge-block {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin-top: 2px;
      }

      .vll-gauge-track {
        width: 100%;
        height: 8px;
        background: rgba(30, 41, 59, 0.9);
        border-radius: 4px;
        overflow: hidden;
        border: 1px solid rgba(148, 163, 184, 0.2);
      }

      .vll-gauge-fill-fuel {
        height: 100%;
        width: 100%;
        background: linear-gradient(90deg, #ef4444 0%, #eab308 35%, #22c55e 100%);
        transition: width 0.08s linear;
      }

      .vll-gauge-fill-thrust {
        height: 100%;
        width: 0%;
        background: linear-gradient(90deg, #f97316, #fbbf24);
        transition: width 0.05s linear;
      }

      /* 중앙 결과 배너 (LANDED / CRASHED) */
      .vll-result-banner {
        position: absolute;
        top: 22%;
        left: 50%;
        transform: translate(-50%, -50%) scale(0.95);
        padding: 18px 34px;
        border-radius: 10px;
        text-align: center;
        backdrop-filter: blur(10px);
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.25s ease, transform 0.25s ease;
      }

      .vll-result-banner.visible {
        opacity: 1;
        transform: translate(-50%, -50%) scale(1);
        pointer-events: auto;
      }

      .vll-result-banner.landed {
        background: rgba(6, 78, 59, 0.88);
        border: 2px solid #10b981;
        box-shadow: 0 0 35px rgba(16, 185, 129, 0.4);
      }

      .vll-result-banner.crashed {
        background: rgba(127, 29, 29, 0.88);
        border: 2px solid #ef4444;
        box-shadow: 0 0 35px rgba(239, 68, 68, 0.4);
      }

      .vll-result-title {
        font-size: 26px;
        font-weight: 800;
        letter-spacing: 0.12em;
        margin-bottom: 6px;
      }

      .vll-result-banner.landed .vll-result-title { color: #6ee7b7; }
      .vll-result-banner.crashed .vll-result-title { color: #fca5a5; }

      .vll-result-detail {
        font-size: 12px;
        color: #e2e8f0;
        margin-bottom: 12px;
      }
    `;
    style.textContent += `
      .vll-hud-root * { box-sizing: border-box; }
      .vll-btn-reset:focus-visible { outline: 3px solid #fbbf24; outline-offset: 3px; }
      @media (max-width: 640px) {
        .vll-top-left { top: 8px; left: 8px; max-width: calc(100% - 16px); max-height: 44vh; overflow: auto; }
        .vll-telemetry-panel { top: auto; bottom: 8px; right: 8px; width: 220px; padding: 10px; gap: 5px; }
        .vll-result-banner { width: calc(100% - 24px); top: 28%; padding: 12px; }
      }
    `;
    document.head.appendChild(style);
  }

  _createDOM() {
    this.root = document.createElement('div');
    this.root.className = 'vll-hud-root';

    this.root.innerHTML = `
      <!-- 좌측 상단 컨트롤 -->
      <div class="vll-top-left">
        <div class="vll-badge">
          <div class="vll-title">VIRTUAL LAUNCH LAB // VTVL</div>
          <div class="vll-subtitle">AI AUTONOMOUS LANDING (PPO-ONNX)</div>
        </div>
        <button class="vll-btn-reset" data-reset="primary">↻ RESET DROP [R]</button>
      </div>

      <!-- 우측 상단 실시간 텔레메트리 -->
      <div class="vll-telemetry-panel">
        <div class="vll-panel-header">
          <span>TELEMETRY</span>
          <span class="vll-status-dot" data-hud="status">● ACTIVE</span>
        </div>

        <div class="vll-metric-row">
          <span class="vll-metric-label">ALTITUDE (Y)</span>
          <span class="vll-metric-value"><span data-hud="alt">0.0</span><span class="vll-unit">m</span></span>
        </div>

        <div class="vll-metric-row">
          <span class="vll-metric-label">CROSSRANGE (X)</span>
          <span class="vll-metric-value"><span data-hud="x">0.0</span><span class="vll-unit">m</span></span>
        </div>

        <div class="vll-metric-row">
          <span class="vll-metric-label">V-SPEED (Vy)</span>
          <span class="vll-metric-value"><span data-hud="vy">0.0</span><span class="vll-unit">m/s</span></span>
        </div>

        <div class="vll-metric-row">
          <span class="vll-metric-label">H-SPEED (Vx)</span>
          <span class="vll-metric-value"><span data-hud="vx">0.0</span><span class="vll-unit">m/s</span></span>
        </div>

        <div class="vll-metric-row">
          <span class="vll-metric-label">PITCH / GIMBAL</span>
          <span class="vll-metric-value">
            <span data-hud="theta">0.0</span>° / <span data-hud="gimbal">0.0</span>°
          </span>
        </div>

        <!-- 연료 게이지 -->
        <div class="vll-gauge-block">
          <div class="vll-metric-row">
            <span class="vll-metric-label">PROPELLANT</span>
            <span class="vll-metric-value"><span data-hud="fuel-pct">100</span><span class="vll-unit">%</span></span>
          </div>
          <div class="vll-gauge-track">
            <div class="vll-gauge-fill-fuel" data-hud="fuel-bar"></div>
          </div>
        </div>

        <!-- 추력 게이지 -->
        <div class="vll-gauge-block">
          <div class="vll-metric-row">
            <span class="vll-metric-label">ENGINE THROTTLE</span>
            <span class="vll-metric-value"><span data-hud="thrust-pct">0</span><span class="vll-unit">%</span></span>
          </div>
          <div class="vll-gauge-track">
            <div class="vll-gauge-fill-thrust" data-hud="thrust-bar"></div>
          </div>
        </div>
      </div>

      <!-- 착륙 결과 중앙 배너 -->
      <div class="vll-result-banner" data-hud="banner">
        <div class="vll-result-title" data-hud="banner-title">TOUCHDOWN</div>
        <div class="vll-result-detail" data-hud="banner-detail">Pad Offset: 0.0m | Impact Speed: 0.0m/s</div>
        <button class="vll-btn-reset" data-reset="banner">LAUNCH NEXT TEST</button>
      </div>
    `;

    document.body.appendChild(this.root);

    // DOM 참조 캐싱 (매 프레임 쿼리 비용 제거)
    this.els = {
      status: this.root.querySelector('[data-hud=\"status\"]'),
      alt: this.root.querySelector('[data-hud=\"alt\"]'),
      x: this.root.querySelector('[data-hud=\"x\"]'),
      vy: this.root.querySelector('[data-hud=\"vy\"]'),
      vx: this.root.querySelector('[data-hud=\"vx\"]'),
      theta: this.root.querySelector('[data-hud=\"theta\"]'),
      gimbal: this.root.querySelector('[data-hud=\"gimbal\"]'),
      fuelPct: this.root.querySelector('[data-hud=\"fuel-pct\"]'),
      fuelBar: this.root.querySelector('[data-hud=\"fuel-bar\"]'),
      thrustPct: this.root.querySelector('[data-hud=\"thrust-pct\"]'),
      thrustBar: this.root.querySelector('[data-hud=\"thrust-bar\"]'),
      banner: this.root.querySelector('[data-hud=\"banner\"]'),
      bannerTitle: this.root.querySelector('[data-hud=\"banner-title\"]'),
      bannerDetail: this.root.querySelector('[data-hud=\"banner-detail\"]')
    };

    this.els.banner.setAttribute('role', 'status');
    this.els.banner.setAttribute('aria-live', 'polite');
    // 리셋 버튼 이벤트 연결
    const handleReset = () => {
      if (this.onReset) this.onReset();
    };
    this.root.querySelector('[data-reset="primary"]').addEventListener('click', handleReset);
    this.root.querySelector('[data-reset="banner"]').addEventListener('click', handleReset);
  }

  hideBanner() {
    this.els.banner.classList.remove('visible', 'landed', 'crashed');
    this.els.status.textContent = '● ACTIVE';
    this.els.status.style.color = '#22c55e';
  }

  // 매 프레임 시뮬레이션 상태를 받아 UI 갱신
  update(state) {
    if (!state) return;

    const { x, y, vx, vy, theta, gimbalRad, thrustRatio, fuel, status } = state;

    this.els.alt.textContent = Math.max(0, y).toFixed(1);
    this.els.x.textContent = (x >= 0 ? '+' : '') + x.toFixed(1);
    this.els.vy.textContent = vy.toFixed(1);
    this.els.vx.textContent = (vx >= 0 ? '+' : '') + vx.toFixed(1);

    // 라디안 -> 도(deg) 변환 표시
    const thetaDeg = ((theta * 180) / Math.PI).toFixed(1);
    const gimbalDeg = ((gimbalRad * 180) / Math.PI).toFixed(1);
    this.els.theta.textContent = thetaDeg;
    this.els.gimbal.textContent = gimbalDeg;

    // 연료 퍼센트 & 바 업데이트
    const fuelPercent = Math.max(0, Math.min(100, (fuel / this.initialFuel) * 100));
    this.els.fuelPct.textContent = fuelPercent.toFixed(0);
    this.els.fuelBar.style.width = `${fuelPercent}%`;

    // 추력 퍼센트 & 바 업데이트
    const activeThrust = !state.done && status === 'FLYING' && state.thrust > 0
      ? Math.max(0, Math.min(100, thrustRatio * 100)) : 0;
    this.els.thrustPct.textContent = activeThrust.toFixed(0);
    this.els.thrustBar.style.width = `${activeThrust}%`;

    // 착륙 또는 추락 종료 시 배너 표시
    if ((state.done || status !== 'FLYING') && !this.els.banner.classList.contains('visible')) {
      this._showResult(state);
    }
  }

  _showResult(state) {
    const { x, vx, vy, theta, status } = state;
    const isLanded = status === 'LANDED';
    const timeout = state.truncated;
    const outside = state.outcome === 'out_of_bounds';
    const impactSpeed = Math.hypot(vx, vy).toFixed(2);
    const tiltDeg = Math.abs((theta * 180) / Math.PI).toFixed(1);

    this.els.banner.classList.add('visible', isLanded ? 'landed' : 'crashed');
    this.els.bannerTitle.textContent = isLanded ? 'BOOSTER LANDED' : timeout ? 'TIME LIMIT' : outside ? 'OUT OF BOUNDS' : 'VEHICLE LOST (CRASHED)';
    this.els.bannerDetail.textContent =
      `Pad Offset: ${Math.abs(x).toFixed(2)}m | ${timeout || outside ? 'Final Speed' : 'Touchdown Speed'}: ${impactSpeed}m/s | Tilt: ${tiltDeg}°`;

    this.els.status.textContent = isLanded ? '● LANDED' : timeout ? '● TIME LIMIT' : '● LOST';
    this.els.status.style.color = isLanded ? '#10b981' : '#ef4444';
  }
  _createModeControls() {
    const panel=this.root.querySelector('.vll-top-left');
    const modes=document.createElement('div');modes.className='vll-mode-switch';
    modes.style.cssText='display:flex;gap:6px';
    this.modeButtons={};
    for (const mode of ['AI','MANUAL']) {
      const button=document.createElement('button');button.className='vll-btn-reset';
      button.textContent=mode==='AI'?'AI AUTOPILOT':'MANUAL [M]';
      button.onclick=()=>this.setMode(mode,true);modes.append(button);this.modeButtons[mode]=button;
    }
    this.manualGuide=document.createElement('div');this.manualGuide.className='vll-badge';
    this.manualGuide.style.maxWidth='290px';
    this.manualGuide.textContent='SPACE / ↑: 누르는 동안 점화 · ↑/↓: 출력 · ←/→: 짐벌 · M: 모드 · R: 초기화. 수동은 컷오프 0% 허용, PPO는 40~100%.';
    panel.append(modes,this.manualGuide);
  }

  setMode(mode, notify=true) {
    if (!['AI','MANUAL'].includes(mode)) throw new Error('Unknown control mode');
    // Requested changes are confirmed by the app after pending inference/model loading.
    if (notify && this.onModeChange) {this.onModeChange(mode);return;}
    this.mode=mode;
    for (const [name,button] of Object.entries(this.modeButtons)) {
      button.setAttribute('aria-pressed',String(name===mode));
      button.style.background=name===mode?'#155e75':'';
    }
    this.manualGuide.hidden=mode!=='MANUAL';
    this.root.querySelector('.vll-subtitle').textContent=mode==='MANUAL'
      ? '키보드 수동 조종 · 학습된 정책 아님' : 'PPO 정책 추론 · 브라우저 학습 아님';
  }

  setModeBusy(busy) {Object.values(this.modeButtons).forEach(b=>{b.disabled=busy;});}

  setMessage(message) {
    this.els.status.textContent = message;
    this.els.status.style.color = '#fbbf24';
  }

  setResetEnabled(enabled) {
    this.root.querySelectorAll('[data-reset]').forEach(button => { button.disabled = !enabled; });
  }

  dispose() {
    this.root.remove();
    this.onReset = null;
    this.onModeChange = null;
    if (!document.querySelector('.vll-hud-root')) document.getElementById('vll-hud-style')?.remove();
  }
}