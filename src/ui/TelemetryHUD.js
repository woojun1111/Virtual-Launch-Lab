export class TelemetryHUD {
  constructor({ onReset, onModeChange, onWindChange, onAutoBenchmarkToggle, initialFuel = 500.0, initialMode = 'MANUAL' } = {}) {
    if (!Number.isFinite(initialFuel) || initialFuel <= 0) throw new Error('Invalid initial fuel');
    this.lastRecordedEpisode = null;
    this.onReset = onReset;
    this.onModeChange = onModeChange;
    this.onWindChange = onWindChange;
    this.onAutoBenchmarkToggle = onAutoBenchmarkToggle;
    this.initialFuel = initialFuel;
    this.mode = initialMode; // 'AI' | 'MANUAL'
    this.windSpeed = 0.0;
    this.isAutoBenchmark = false;

    // 벤치마크 통계 데이터
    this.stats = {
      runs: 0,
      successes: 0,
      totalOffset: 0,
      totalFuelLeft: 0,
    };

    this._injectFontsAndStyles();
    this._createDOM();
    this.setMode(this.mode, false);
    this.els.windSlider.disabled = !this.onWindChange;
    this.els.windVal.textContent = this.onWindChange ? '0.0 m/s' : 'NOT CONNECTED';
    this.els.windSlider.title = this.onWindChange ? 'Crosswind' : '측풍 물리는 연결되어 있지 않습니다.';
    this.els.windSlider.setAttribute('aria-label','측풍');
    this.els.benchmarkToggle.setAttribute('aria-label','자동 반복 실행');
    this.els.outcome.setAttribute('role','status');
    this.els.outcome.setAttribute('aria-live','polite');
  }

  // 1. Google Fonts 및 SpaceX 스타일 CSS 주입
  _injectFontsAndStyles() {
    // 폰트 로드
    if (!document.getElementById('vll-fonts')) {
      const link = document.createElement('link');
      link.id = 'vll-fonts';
      link.rel = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Space+Grotesk:wght@400;500;700&display=swap';
      document.head.appendChild(link);
    }

    if (document.getElementById('vll-hud-style')) return;

    const style = document.createElement('style');
    style.id = 'vll-hud-style';
    style.textContent = `
      .vll-hud-root {
        position: fixed;
        inset: 0;
        pointer-events: none;
        font-family: 'Space Grotesk', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        color: #f1f5f9;
        user-select: none;
        z-index: 100;
        font-size: 13px;
      }

      /* 대화형 요소 활성화 */
      .vll-interactive {
        pointer-events: auto;
      }

      /* 블러 & 보이지 않는 미세한 1px 테두리 (SpaceX 스타일) */
      .vll-panel {
        background: rgba(3, 7, 18, 0.72);
        border: 1px solid rgba(56, 189, 248, 0.18);
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        border-radius: 4px;
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.65);
        padding: 14px 16px;
        transition: border-color 0.3s ease, box-shadow 0.3s ease;
      }

      .vll-panel:hover {
        border-color: rgba(56, 189, 248, 0.3);
        box-shadow: 0 12px 48px rgba(56, 189, 248, 0.1);
      }

      /* 좌측 영역 */
      .vll-left-sidebar {
        position: absolute;
        top: 20px;
        left: 20px;
        display: flex;
        flex-direction: column;
        gap: 12px;
        width: 280px;
      }

      /* 최상단 GNC 헤더 뱃지 */
      .vll-badge {
        border-left: 3px solid #38bdf8;
        padding-left: 12px;
      }

      .vll-title {
        font-size: 14px;
        font-weight: 700;
        letter-spacing: 0.08em;
        color: #f8fafc;
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .vll-title span {
        color: #38bdf8;
      }

      .vll-subtitle {
        font-size: 10px;
        font-weight: 500;
        color: #64748b;
        letter-spacing: 0.05em;
        margin-top: 2px;
      }

      /* 자율/수동 토글 */
      .vll-mode-switch {
        display: grid;
        grid-template-columns: 1fr 1fr;
        background: rgba(15, 23, 42, 0.6);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 4px;
        padding: 3px;
        gap: 3px;
      }

      .vll-mode-btn {
        background: transparent;
        border: none;
        color: #64748b;
        font-family: inherit;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.05em;
        padding: 8px 4px;
        border-radius: 3px;
        cursor: pointer;
        transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      }

      .vll-mode-btn:hover {
        color: #cbd5e1;
      }

      /* AI 모드 활성화 (일렉트릭 사이버 블루) */
      .vll-mode-btn.active-ai {
        background: rgba(14, 165, 233, 0.15);
        color: #38bdf8;
        box-shadow: inset 0 0 0 1px rgba(56, 189, 248, 0.4);
        text-shadow: 0 0 8px rgba(56, 189, 248, 0.5);
      }

      /* 수동 모드 활성화 (스페이스X 오렌지) */
      .vll-mode-btn.active-manual {
        background: rgba(245, 158, 11, 0.12);
        color: #fbbf24;
        box-shadow: inset 0 0 0 1px rgba(245, 158, 11, 0.4);
        text-shadow: 0 0 8px rgba(245, 158, 11, 0.5);
      }

      /* 제어 가이드 */
      .vll-guide-box {
        display: none;
        background: rgba(245, 158, 11, 0.03);
        border: 1px dashed rgba(245, 158, 11, 0.25);
        border-radius: 4px;
        padding: 10px 12px;
        font-size: 11px;
        color: #fde68a;
        line-height: 1.6;
      }

      .vll-guide-box.visible {
        display: block;
      }

      .vll-keycap {
        background: rgba(245, 158, 11, 0.15);
        border: 1px solid rgba(245, 158, 11, 0.3);
        border-radius: 3px;
        padding: 0 5px;
        font-size: 10px;
        font-weight: 700;
        color: #ffffff;
        margin: 0 2px;
      }

      /* 리셋 버튼 */
      .vll-btn-action {
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(255, 255, 255, 0.12);
        color: #cbd5e1;
        font-family: inherit;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.08em;
        padding: 10px;
        border-radius: 4px;
        cursor: pointer;
        transition: all 0.2s ease;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
      }

      .vll-btn-action:hover {
        background: rgba(56, 189, 248, 0.1);
        border-color: rgba(56, 189, 248, 0.5);
        color: #ffffff;
      }

      /* 통계 패널 (격자 배경) */
      .vll-stats-panel {
        background-image: radial-gradient(rgba(255, 255, 255, 0.025) 1px, transparent 0);
        background-size: 12px 12px;
      }

      .vll-stats-header {
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.12em;
        color: #64748b;
        margin-bottom: 10px;
        text-transform: uppercase;
      }

      .vll-stats-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px 12px;
        margin-bottom: 10px;
      }

      .vll-stat-item {
        display: flex;
        flex-direction: column;
      }

      .vll-stat-label {
        font-size: 10px;
        color: #475569;
        font-weight: 500;
        letter-spacing: 0.02em;
      }

      .vll-stat-val {
        font-size: 18px;
        font-weight: 700;
        color: #cbd5e1;
        font-family: 'JetBrains Mono', monospace;
      }

      .vll-stat-val.success {
        color: #10b981;
        text-shadow: 0 0 10px rgba(16, 185, 129, 0.3);
      }

      .vll-stats-footer {
        font-size: 10.5px;
        color: #475569;
        display: flex;
        gap: 12px;
        border-top: 1px solid rgba(255, 255, 255, 0.05);
        padding-top: 8px;
        font-family: 'JetBrains Mono', monospace;
      }

      /* 환경 제어 영역 */
      .vll-env-header {
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.12em;
        color: #64748b;
        margin-bottom: 12px;
      }

      .vll-slider-wrapper {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-bottom: 14px;
      }

      .vll-slider-label {
        display: flex;
        justify-content: space-between;
        font-size: 11px;
        color: #94a3b8;
      }

      .vll-slider-label span:last-child {
        font-family: 'JetBrains Mono', monospace;
        color: #38bdf8;
      }

      .vll-slider {
        -webkit-appearance: none;
        appearance: none;
        width: 100%;
        height: 3px;
        background: rgba(255, 255, 255, 0.1);
        border-radius: 2px;
        outline: none;
      }

      .vll-slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: #38bdf8;
        cursor: pointer;
        box-shadow: 0 0 8px rgba(56, 189, 248, 0.8);
        transition: transform 0.1s ease;
      }

      .vll-slider::-webkit-slider-thumb:hover {
        transform: scale(1.2);
      }

      /* 자동 벤치마크 토글 */
      .vll-toggle-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 11px;
        color: #cbd5e1;
        font-weight: 500;
      }

      .vll-switch {
        position: relative;
        display: inline-block;
        width: 34px;
        height: 18px;
      }

      .vll-switch input {
        opacity: 0;
        width: 0;
        height: 0;
      }

      .vll-slider-toggle {
        position: absolute;
        cursor: pointer;
        inset: 0;
        background-color: rgba(255, 255, 255, 0.1);
        transition: .2s;
        border-radius: 18px;
        border: 1px solid rgba(255, 255, 255, 0.05);
      }

      .vll-slider-toggle:before {
        position: absolute;
        content: "";
        height: 12px;
        width: 12px;
        left: 2px;
        bottom: 2px;
        background-color: #64748b;
        transition: .2s cubic-bezier(0.16, 1, 0.3, 1);
        border-radius: 50%;
      }

      input:checked + .vll-slider-toggle {
        background-color: rgba(56, 189, 248, 0.18);
        border-color: rgba(56, 189, 248, 0.4);
      }

      input:checked + .vll-slider-toggle:before {
        transform: translateX(16px);
        background-color: #38bdf8;
        box-shadow: 0 0 8px rgba(56, 189, 248, 0.8);
      }

      /* 우측 텔레메트리 패널 */
      .vll-right-panel {
        position: absolute;
        top: 20px;
        right: 20px;
        width: 280px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .vll-telemetry-header {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.12em;
        color: #64748b;
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        padding-bottom: 6px;
      }

      .vll-tele-active {
        color: #10b981;
        text-shadow: 0 0 10px rgba(16, 185, 129, 0.4);
        font-size: 10px;
      }

      /* 수치 목록 행 */
      .vll-data-row {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        font-size: 12px;
        border-bottom: 1px dashed rgba(255, 255, 255, 0.04);
        padding-bottom: 4px;
      }

      .vll-data-label {
        color: #94a3b8;
        font-weight: 500;
      }

      .vll-data-val {
        font-family: 'JetBrains Mono', monospace;
        font-weight: 700;
        color: #f1f5f9;
        font-variant-numeric: tabular-nums;
      }

      .vll-data-val span {
        font-size: 10px;
        color: #475569;
        margin-left: 2px;
        font-weight: 400;
      }

      /* 프로그레스 / 게이지 바 */
      .vll-gauge-container {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin-top: 2px;
      }

      .vll-gauge-header {
        display: flex;
        justify-content: space-between;
        font-size: 10px;
        font-weight: 700;
        color: #64748b;
        letter-spacing: 0.02em;
      }

      .vll-gauge-header span:last-child {
        font-family: 'JetBrains Mono', monospace;
        color: #f1f5f9;
      }

      .vll-gauge-bg {
        width: 100%;
        height: 6px;
        background: rgba(255, 255, 255, 0.06);
        border-radius: 1px;
        overflow: hidden;
      }

      .vll-gauge-fill {
        height: 100%;
        width: 100%;
        transition: width 0.08s linear;
      }

      .vll-fill-fuel {
        background: linear-gradient(90deg, #38bdf8 0%, #0369a1 100%);
        box-shadow: 0 0 8px rgba(56, 189, 248, 0.3);
      }

      .vll-fill-thrust {
        background: linear-gradient(90deg, #f97316 0%, #ea580c 100%);
        box-shadow: 0 0 8px rgba(249, 115, 22, 0.3);
        width: 0%;
      }

      /* 터치다운 결과 배너 */
      .vll-outcome-overlay {
        position: absolute;
        top: 24%;
        left: 50%;
        transform: translate(-50%, -50%) scale(0.96);
        width: 320px;
        padding: 20px;
        border-radius: 4px;
        text-align: center;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.3s cubic-bezier(0.16, 1, 0.3, 1), transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      }

      .vll-outcome-overlay.visible {
        opacity: 1;
        transform: translate(-50%, -50%) scale(1);
        pointer-events: auto;
      }

      /* 성공 (SpaceX 그린) */
      .vll-outcome-overlay.landed {
        background: rgba(2, 44, 34, 0.85);
        border: 1px solid #10b981;
        box-shadow: 0 0 35px rgba(16, 185, 129, 0.25);
      }

      /* 실패 (SpaceX 레드) */
      .vll-outcome-overlay.crashed {
        background: rgba(69, 10, 10, 0.85);
        border: 1px solid #ef4444;
        box-shadow: 0 0 35px rgba(239, 68, 68, 0.25);
      }

      .vll-outcome-status {
        font-size: 18px;
        font-weight: 700;
        letter-spacing: 0.12em;
        margin-bottom: 6px;
      }

      .vll-outcome-overlay.landed .vll-outcome-status { color: #34d399; }
      .vll-outcome-overlay.crashed .vll-outcome-status { color: #fca5a5; }

      .vll-outcome-stats {
        font-size: 11px;
        color: #94a3b8;
        font-family: 'JetBrains Mono', monospace;
        line-height: 1.5;
        margin-bottom: 14px;
      }
    `;
    style.textContent += `
      .vll-hud-root * { box-sizing: border-box; }
      .vll-panel { background-color:rgba(11,15,25,.72); position:relative; }
      .vll-panel::before { content:''; position:absolute; top:0; left:8%; right:8%; height:1px; background:linear-gradient(90deg,transparent,#38bdf8,transparent); }
      .vll-left-sidebar { width:300px; max-height:calc(100vh - 40px); overflow:auto; scrollbar-width:thin; }
      .vll-right-panel { width:300px; }
      .vll-stat-label,.vll-stats-footer,.vll-gauge-header,.vll-stats-header,.vll-env-header { color:#94a3b8; }
      .vll-mode-btn,.vll-btn-action,.vll-data-row,.vll-toggle-row,.vll-slider-label { font-size:14px; }
      .vll-subtitle,.vll-guide-box,.vll-stats-header,.vll-env-header,.vll-outcome-stats { font-size:12px; }
      .vll-data-val span:first-child { font-size:15px; color:#f1f5f9; font-weight:700; }
      .vll-data-row { border-bottom:1px dashed rgba(148,163,184,.1); }
      .vll-mode-btn.active-manual { color:#6ee7b7; background:rgba(16,185,129,.12); box-shadow:inset 0 0 0 1px #10b981; }
      .vll-fill-fuel { background:linear-gradient(90deg,#38bdf8,#5eead4); }
      .vll-fill-thrust { background:linear-gradient(90deg,#f97316,#fbbf24); }
      .vll-slider { background:repeating-linear-gradient(90deg,#334155 0 5px,transparent 5px 8px); }
      .vll-slider::-moz-range-thumb { background:#38bdf8; border:0; width:12px; height:12px; border-radius:50%; box-shadow:0 0 8px #38bdf8; }
      .vll-hud-root button:focus-visible,.vll-slider:focus-visible { outline:2px solid #67e8f9; outline-offset:3px; }
      .vll-switch input:focus-visible + span { outline:2px solid #67e8f9; outline-offset:3px; }
      .vll-hud-root button:disabled,.vll-slider:disabled { opacity:.45; cursor:not-allowed; }
      .vll-outcome-stats { white-space:pre-line; }
      @media(max-width:800px) {
        .vll-left-sidebar { left:8px;top:8px;width:min(300px,46vw);max-height:52vh; }
        .vll-right-panel { right:8px;top:8px;width:46vw;max-height:52vh;overflow:auto; }
        .vll-panel { padding:10px; } .vll-mode-switch { grid-template-columns:1fr; }
        .vll-outcome-overlay { top:auto;bottom:12px;transform:translateX(-50%);width:min(320px,94vw); }
        .vll-outcome-overlay.visible { transform:translateX(-50%); }
        .vll-stats-footer { flex-wrap:wrap; }
      }
      @media(prefers-reduced-motion:reduce) { .vll-hud-root * { transition:none!important; } }
    `;
    document.head.appendChild(style);
  }

  // 2. DOM 요소 생성 및 UI 렌더링
  _createDOM() {
    this.root = document.createElement('div');
    this.root.className = 'vll-hud-root';

    this.root.innerHTML = `
      <!-- 좌측 제어 및 분석 바 -->
      <div class="vll-left-sidebar vll-top-left vll-interactive">

        <!-- 로고 및 모드 정보 -->
        <div class="vll-panel vll-badge">
          <div class="vll-title">VLL <span>// BOOSTER GNC OPERATIONS</span></div>
          <div class="vll-subtitle" data-ui="hud-mode-sub">AI AUTOPILOT (PPO) ACTIVE</div>
        </div>

        <!-- 주행 모드 스위치 -->
        <div class="vll-mode-switch">
          <button class="vll-mode-btn active-ai" data-ui="vll-btn-ai">[ AI AUTOPILOT ]</button>
          <button class="vll-mode-btn" data-ui="vll-btn-manual">MANUAL [M]</button>
        </div>

        <!-- 수동 모드 키 가이드 -->
        <div class="vll-guide-box" data-ui="vll-guide">
          <div><span class="vll-keycap">SPACE</span> / <span class="vll-keycap">↑</span> 점화 (추력)</div>
          <div><span class="vll-keycap">←</span> / <span class="vll-keycap">→</span> 짐벌 노즐 조향</div>
          <div><span class="vll-keycap">↑</span> / <span class="vll-keycap">↓</span> 출력 미세 조종</div>
        </div>

        <!-- 리셋 단축키 -->
        <button class="vll-btn-action" data-ui="vll-reset">
          ↻ RESET DROP [R]
        </button>

        <!-- 연속 통계 분석 (벤치마크) -->
        <div class="vll-panel vll-stats-panel">
          <div class="vll-stats-header">Benchmark Statistics · ALL MODES</div><div class="vll-subtitle">완료된 실행만 집계 · 시간 제한 포함 · 수동/AI 혼합</div>
          <div class="vll-stats-grid">
            <div class="vll-stat-item">
              <span class="vll-stat-label">RUNS</span>
              <span class="vll-stat-val" data-ui="st-runs">0</span>
            </div>
            <div class="vll-stat-item">
              <span class="vll-stat-label">SUCCESS</span>
              <span class="vll-stat-val success" data-ui="st-success">0.0%</span>
            </div>
          </div>
          <div class="vll-stats-footer">
            <div>AVG FINAL X: <span data-ui="st-offset">0.0m</span></div>
            <div>AVG FUEL: <span data-ui="st-fuel">0%</span></div>
          </div>
        </div>

        <!-- 환경 제어기 -->
        <div class="vll-panel">
          <div class="vll-env-header">Environment Controls</div>
          <div class="vll-slider-wrapper">
            <div class="vll-slider-label">
              <span>CROSSWIND</span>
              <span data-ui="vll-wind-val">0.0 m/s [ GUSTING ]</span>
            </div>
            <input type="range" class="vll-slider" data-ui="vll-wind-slider" min="-15" max="15" step="0.5" value="0">
          </div>
          <div class="vll-toggle-row">
            <span>AUTO-BENCHMARK</span>
            <label class="vll-switch">
              <input type="checkbox" data-ui="vll-benchmark-toggle">
              <span class="vll-slider-toggle"></span>
            </label>
          </div>
        </div>

      </div>

      <!-- 우측 미션 데이터 텔레메트리 바 -->
      <div class="vll-right-panel vll-interactive">
        <div class="vll-panel">
          <div class="vll-telemetry-header">
            <span>MISSION DATA TELEMETRY</span>
            <span class="vll-tele-active" data-ui="hud-status">● ACTIVE</span>
          </div>

          <div style="display: flex; flex-direction: column; gap: 6px; margin: 12px 0;">
            <div class="vll-data-row">
              <span class="vll-data-label">ALTITUDE</span>
              <span class="vll-data-val"><span data-ui="v-alt">0.0</span><span>m</span></span>
            </div>
            <div class="vll-data-row">
              <span class="vll-data-label">CROSSRANGE (X)</span>
              <span class="vll-data-val"><span data-ui="v-x">0.0</span><span>m</span></span>
            </div>
            <div class="vll-data-row">
              <span class="vll-data-label">V-SPEED (Vy)</span>
              <span class="vll-data-val"><span data-ui="v-vy">0.0</span><span>m/s</span></span>
            </div>
            <div class="vll-data-row">
              <span class="vll-data-label">H-SPEED (Vx)</span>
              <span class="vll-data-val"><span data-ui="v-vx">0.0</span><span>m/s</span></span>
            </div>
            <div class="vll-data-row">
              <span class="vll-data-label">PITCH / GIMBAL</span>
              <span class="vll-data-val">
                <span data-ui="v-pitch">0.0</span>°<span>/</span> <span data-ui="v-gimbal">0.0</span>°
              </span>
            </div>
          </div>

          <!-- 추진제 (프로펠런트) 바 -->
          <div class="vll-gauge-container" style="margin-bottom: 8px;">
            <div class="vll-gauge-header">
              <span>PROPELLANT</span>
              <span data-ui="v-fuel-pct">100%</span>
            </div>
            <div class="vll-gauge-bg">
              <div class="vll-gauge-fill vll-fill-fuel" data-ui="v-fuel-bar"></div>
            </div>
          </div>

          <!-- 추력 (스러스트) 바 -->
          <div class="vll-gauge-container">
            <div class="vll-gauge-header">
              <span>THRUST</span>
              <span data-ui="v-thrust-pct">0.0%</span>
            </div>
            <div class="vll-gauge-bg">
              <div class="vll-gauge-fill vll-fill-thrust" data-ui="v-thrust-bar"></div>
            </div>
          </div>
        </div>
      </div>

      <!-- 터치다운 비주얼 알림 팝업 -->
      <div class="vll-outcome-overlay vll-interactive" data-ui="hud-outcome">
        <div class="vll-outcome-status" data-ui="out-title">BOOSTER LANDED</div>
        <div class="vll-outcome-stats" data-ui="out-detail">
          PAD OFFSET: 0.0m<br>
          IMPACT SPEED: 0.0m/s
        </div>
        <button class="vll-btn-action" data-ui="out-action" style="width: 100%;">
          LAUNCH NEXT TEST
        </button>
      </div>
    `;

    document.body.appendChild(this.root);

    // 가볍게 바인딩할 DOM 노드 캐싱
    this.els = {
      modeSub: this.root.querySelector('[data-ui="hud-mode-sub"]'),
      btnAi: this.root.querySelector('[data-ui="vll-btn-ai"]'),
      btnManual: this.root.querySelector('[data-ui="vll-btn-manual"]'),
      guide: this.root.querySelector('[data-ui="vll-guide"]'),
      status: this.root.querySelector('[data-ui="hud-status"]'),
      alt: this.root.querySelector('[data-ui="v-alt"]'),
      x: this.root.querySelector('[data-ui="v-x"]'),
      vy: this.root.querySelector('[data-ui="v-vy"]'),
      vx: this.root.querySelector('[data-ui="v-vx"]'),
      pitch: this.root.querySelector('[data-ui="v-pitch"]'),
      gimbal: this.root.querySelector('[data-ui="v-gimbal"]'),
      fuelPct: this.root.querySelector('[data-ui="v-fuel-pct"]'),
      fuelBar: this.root.querySelector('[data-ui="v-fuel-bar"]'),
      thrustPct: this.root.querySelector('[data-ui="v-thrust-pct"]'),
      thrustBar: this.root.querySelector('[data-ui="v-thrust-bar"]'),

      // 벤치마크 & 환경
      windVal: this.root.querySelector('[data-ui="vll-wind-val"]'),
      windSlider: this.root.querySelector('[data-ui="vll-wind-slider"]'),
      benchmarkToggle: this.root.querySelector('[data-ui="vll-benchmark-toggle"]'),

      // 통계 UI
      stRuns: this.root.querySelector('[data-ui="st-runs"]'),
      stSuccess: this.root.querySelector('[data-ui="st-success"]'),
      stOffset: this.root.querySelector('[data-ui="st-offset"]'),
      stFuel: this.root.querySelector('[data-ui="st-fuel"]'),

      // 배너
      outcome: this.root.querySelector('[data-ui="hud-outcome"]'),
      outTitle: this.root.querySelector('[data-ui="out-title"]'),
      outDetail: this.root.querySelector('[data-ui="out-detail"]'),
    };

    this.messageDetail=document.createElement('div');
    this.messageDetail.className='vll-panel';
    this.messageDetail.style.cssText='font-size:13px;line-height:1.6;overflow-wrap:anywhere;color:#fbbf24';
    this.messageDetail.hidden=true;
    this.messageDetail.setAttribute('role','status');
    this.root.querySelector('.vll-right-panel').append(this.messageDetail);
    this.els.status.style.cssText='font-size:11px;max-width:110px;flex-shrink:0;text-align:right;overflow-wrap:anywhere';
    this._bindEvents();
  }

  // 3. 컨트롤러 이벤트 바인딩
  _bindEvents() {
    this.els.btnAi.addEventListener('click', () => this.setMode('AI', true));
    this.els.btnManual.addEventListener('click', () => this.setMode('MANUAL', true));

    // 리셋
    const triggerReset = () => {
      if (this.onReset) this.onReset();
    };
    this.root.querySelector('[data-ui="vll-reset"]').addEventListener('click', triggerReset);
    this.root.querySelector('[data-ui="out-action"]').addEventListener('click', triggerReset);

    // 바람 세기 슬라이더
    this.els.windSlider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      this.windSpeed = val;
      const absVal = Math.abs(val).toFixed(1);
      const suffix = val === 0 ? '' : (val > 0 ? ' [ EAST ]' : ' [ WEST ]');
      this.els.windVal.textContent = `${absVal} m/s${suffix}`;

      if (this.onWindChange) this.onWindChange(val);
    });

    // 오토 벤치마크 토글
    this.els.benchmarkToggle.addEventListener('change', (e) => {
      this.isAutoBenchmark = e.target.checked;
      if (this.onAutoBenchmarkToggle) this.onAutoBenchmarkToggle(this.isAutoBenchmark);
    });
  }

  hideBanner() {
    this.messageDetail.hidden=true;
    this.els.outcome.classList.remove('visible', 'landed', 'crashed');
    this.els.status.textContent = '● ACTIVE';
    this.els.status.style.color = '#10b981';
  }

  // AI vs 수동 제어 모드 갱신
  setMode(newMode, notify = true) {
    if (!['AI','MANUAL'].includes(newMode)) throw new Error('Unknown control mode');
    if (notify && this.onModeChange) { this.onModeChange(newMode); return; }
    this.mode = newMode;
    const isManual = newMode === 'MANUAL';

    this.els.btnAi.classList.toggle('active-ai', !isManual);
    this.els.btnManual.classList.toggle('active-manual', isManual);
    this.els.guide.classList.toggle('visible', isManual);

    this.els.modeSub.textContent = isManual
      ? 'MANUAL FLIGHT CONTROL (KEYBOARD)'
      : 'PPO-ONNX · POLICY INFERENCE';
    this.els.btnAi.setAttribute('aria-pressed',String(!isManual));
    this.els.btnManual.setAttribute('aria-pressed',String(isManual));

    if (notify && this.onModeChange) {
      this.onModeChange(newMode);
    }
  }

  // Cached DOM references; text formatting still allocates strings.
  update(state) {
    if (!state) return;

    const { x, y, vx, vy, theta, gimbalRad, thrustRatio, fuel, status } = state;

    this.els.alt.textContent = Math.max(0, y).toFixed(1);
    this.els.x.textContent = (x >= 0 ? '+' : '') + x.toFixed(1);
    this.els.vy.textContent = vy.toFixed(1);
    this.els.vx.textContent = (vx >= 0 ? '+' : '') + vx.toFixed(1);

    this.els.pitch.textContent = ((theta * 180) / Math.PI).toFixed(1);
    this.els.gimbal.textContent = ((gimbalRad * 180) / Math.PI).toFixed(1);

    // 추진제 게이지
    const fuelPct = Math.max(0, Math.min(100, (fuel / this.initialFuel) * 100));
    this.els.fuelPct.textContent = `${fuelPct.toFixed(0)}%`;
    this.els.fuelBar.style.width = `${fuelPct}%`;

    // 추력 게이지
    const activeThrust = !state.done && status === 'FLYING' && state.thrust > 0 ? Math.max(0,Math.min(100,thrustRatio*100)) : 0;
    this.els.thrustPct.textContent = `${activeThrust.toFixed(1)}%`;
    this.els.thrustBar.style.width = `${activeThrust}%`;

    // 결과 팝업 트리거
    if ((state.done || status !== 'FLYING') && !this.els.outcome.classList.contains('visible')) {
      this._showResult(state);
    }
  }

  // 착륙 결과 패널 데이터 처리
  _showResult(state) {
    const { x, vx, vy, theta, fuel, status } = state;
    const isLanded = status === 'LANDED';
    const impactSpeed = Math.hypot(vx, vy);
    const tiltDeg = Math.abs((theta * 180) / Math.PI).toFixed(1);

    // 팝업 표시
    this.els.outcome.classList.add('visible', isLanded ? 'landed' : 'crashed');
    this.els.outTitle.textContent = isLanded ? 'BOOSTER LANDED' : state.truncated ? 'TIME LIMIT' : state.outcome==='out_of_bounds' ? 'OUT OF BOUNDS' : 'VEHICLE LOST (CRASHED)';
    this.els.outDetail.innerHTML = `
      PAD OFFSET: ${Math.abs(x).toFixed(2)}m<br>
      IMPACT SPEED: ${impactSpeed.toFixed(2)}m/s<br>
      TILT ANGLE: ${tiltDeg}°
    `;

    this.els.status.textContent = isLanded ? '● LANDED' : state.truncated ? '● TIME LIMIT' : '● LOST';
    this.els.status.style.color = isLanded ? '#10b981' : '#ef4444';
  }
  recordResult(state, episodeId) {
    if (!state?.done || this.lastRecordedEpisode === episodeId) return;
    this.lastRecordedEpisode = episodeId;
    const {x,fuel,status}=state;
    const isLanded=status==='LANDED';
    // 벤치마크 통계 집계
    this.stats.runs += 1;
    if (isLanded) {
      this.stats.successes += 1;
    }
    this.stats.totalOffset += Math.abs(x);
    this.stats.totalFuelLeft += (fuel / this.initialFuel) * 100;

    // 실시간 누적 통계 UI 갱신
    const successRate = ((this.stats.successes / this.stats.runs) * 100).toFixed(1);
    const avgOffset = (this.stats.totalOffset / this.stats.runs).toFixed(1);
    const avgFuel = (this.stats.totalFuelLeft / this.stats.runs).toFixed(0);

    this.els.stRuns.textContent = this.stats.runs;
    this.els.stSuccess.textContent = `${successRate}%`;
    this.els.stOffset.textContent = `${avgOffset}m`;
    this.els.stFuel.textContent = `${avgFuel}%`;

  }

  setAutoBenchmark(enabled) {
    this.isAutoBenchmark=enabled;
    this.els.benchmarkToggle.checked=enabled;
  }
  setModeBusy(busy) {this.els.btnAi.disabled=busy;this.els.btnManual.disabled=busy;}
  setMessage(message, detail='') {
    const long=message.length>32;
    this.els.status.textContent=long?'NOTICE':message;
    this.els.status.style.color='#fbbf24';
    this.messageDetail.textContent=detail || (long?message:'');
    this.messageDetail.hidden=!this.messageDetail.textContent;
  }
  setResetEnabled(enabled) {
    for (const id of ['vll-reset','out-action']) this.root.querySelector(`[data-ui="${id}"]`).disabled=!enabled;
  }
  dispose() {
    this.root.remove();
    this.onReset=this.onModeChange=this.onWindChange=this.onAutoBenchmarkToggle=null;
    if (!document.querySelector('.vll-hud-root')) {
      document.getElementById('vll-hud-style')?.remove();
      document.getElementById('vll-fonts')?.remove();
    }
  }
}
