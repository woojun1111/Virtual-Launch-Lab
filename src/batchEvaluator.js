export class BatchEvaluator {
  constructor({ getContext, restart, onChange }) {
    this.getContext = getContext;
    this.restart = restart;
    this.onChange = onChange;
    this.enabled = false;
    this.timer = null;
    this.runCount = 0;
    this.recentLandings = [];
  }

  setEnabled(enabled) {
    this.cancelRestart();
    this.enabled = enabled;
    this.onChange();
    this.scheduleRestart();
  }

  record(isSuccess) {
    this.runCount++;
    this.recentLandings.push(Number(isSuccess));
    if (this.recentLandings.length > 20) this.recentLandings.shift();
    this.onChange();
  }

  resetStats() {
    this.runCount = 0;
    this.recentLandings.length = 0;
    this.onChange();
  }

  get successRate() {
    const count = this.recentLandings.length;
    return count ? Math.round(100 * this.recentLandings.reduce((a, b) => a + b, 0) / count) : 0;
  }

  cancelRestart() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  scheduleRestart() {
    if (!this.enabled || this.timer !== null) return;
    const { eligible, episode, speed } = this.getContext();
    if (!eligible) return;
    const delay = speed >= 10 ? 120 : speed > 1 ? 400 : 1200;
    this.timer = setTimeout(() => {
      this.timer = null;
      const current = this.getContext();
      if (this.enabled && current.eligible && episode === current.episode) this.restart();
    }, delay);
  }
}
