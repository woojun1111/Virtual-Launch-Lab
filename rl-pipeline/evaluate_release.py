"""Evaluate the read-only release and regenerate its Markdown report."""
import hashlib
import json
from collections import Counter
from pathlib import Path

import numpy as np
import onnxruntime as ort

from env.rocket_landing_env import RocketLandingEnv

ROOT = Path(__file__).resolve().parents[1]
OUTCOMES = {
    "landed": "is_success",
    "out_of_bounds": "out_of_bounds",
    "crashed": "crash",
    "time_limit": "timeout",
}
SCENARIOS = (
    ("기본 조건", 1.0, 0.0),
    ("초기 조건 범위 1.5배", 1.5, 0.0),
    ("측풍 −5 m/s", 1.0, -5.0),
    ("측풍 +5 m/s", 1.0, 5.0),
)


def evaluate(env, infer, expansion, wind):
    rows = []
    for seed in range(100):
        env.reset(seed=seed)
        start = env.state.copy()
        if expansion != 1:
            center = np.array([0, 200, 0, -15, 0])
            start[:5] = center + expansion * (start[:5] - center)
        obs, _ = env.reset(options={"initial_state": start, "wind_speed": wind})
        while True:
            obs, _, terminated, truncated, info = env.step(infer(obs))
            if terminated or truncated:
                break
        rows.append((seed, start[:5], OUTCOMES[info["outcome"]],
                     info.get("impact_state"), float(env.state[6])))
    return rows


def format_stats(values):
    if not len(values):
        return "— | — | — | —"
    return " | ".join(f"{value:.6f}" for value in (
        np.mean(values), np.std(values), np.min(values), np.max(values)
    ))


def report(evaluations, assets):
    lines = [
        "# 배포 정책 평가",
        "",
        "각 조건을 시드 0–99에서 실행했다. 1.5배 조건은 기본 초기 상태의 분포 중심을 기준으로 "
        "각 편차를 확대했다. 측풍의 두 방향은 각각 기본 조건과 같은 초기 상태를 사용했다.",
        "",
        "측풍은 수평 가속도에 `0.1 × 풍속`을 더하는 가상 외란이다. "
        "접지는 환경이 처음 `y ≤ 0`을 관측한 물리 스텝에서 기록했다. "
        "허용 여유율은 각 접지에서 `100 × (1 − 절댓값 / 임계값)`으로 계산하며 "
        "음수는 해당 기준 초과를 뜻한다. 표준편차는 모집단 방식이다.",
        "",
        "| 조건 | 성공률 | out_of_bounds | crash | timeout | 접지 표본 |",
        "|---|---:|---:|---:|---:|---:|",
    ]
    for name, rows in evaluations:
        counts = Counter(row[2] for row in rows)
        contacts = sum(row[3] is not None for row in rows)
        lines.append(f"| {name} | {counts['is_success']}/{len(rows)} | "
                     f"{counts['out_of_bounds']} | {counts['crash']} | {counts['timeout']} | {contacts} |")
    for name, rows in evaluations:
        contacts = [impact for _, _, _, impact, _ in rows if impact is not None]
        lines.extend([
            "", f"## {name}", "",
            "| 접지 지표 | 임계값 | 평균 | 표준편차 | 최소 | 최대 |",
            "|---|---:|---:|---:|---:|---:|",
        ])
        for index, metric, unit in ((0, "x", "m"), (2, "vx", "m/s"), (3, "vy", "m/s"), (4, "theta", "rad")):
            limit = RocketLandingEnv.LANDING_LIMITS[metric]
            values = np.array([abs(impact[index]) for impact in contacts])
            lines.append(f"| 절대 {metric} ({unit}) | {limit:g} | {format_stats(values)} |")
            lines.append(f"| {metric} 여유 (%) | — | {format_stats(100 * (1 - values / limit))} |")
        lines.append(f"| 접지 잔여 연료 (kg) | — | {format_stats([s[6] for s in contacts])} |")
        lines.append(f"| 전체 종료 잔여 연료 (kg) | — | {format_stats([row[4] for row in rows])} |")
        lines.extend([
            "", "<details>", f"<summary>에피소드별 초기·접지 상태 ({len(rows)}회)</summary>", "",
            "| 시드 | x0 | y0 | vx0 | vy0 | theta0 | 종료 사유 | 절대 x | 절대 vx | 절대 vy | 절대 theta | 종료 연료 kg |",
            "|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|",
        ])
        for seed, start, outcome, impact, fuel in rows:
            initial = " | ".join(f"{v:.6f}" for v in start)
            impact_values = " | ".join(f"{abs(impact[i]):.6f}" for i in (0, 2, 3, 4)) if impact is not None else "— | — | — | —"
            lines.append(f"| {seed} | {initial} | {outcome} | {impact_values} | {fuel:.6f} |")
        lines.extend(["", "</details>"])
    lines.extend(["", "## 평가 파일 SHA-256", ""])
    for name in ("rocket_policy.onnx", "norm_stats.json"):
        digest = hashlib.sha256((assets / name).read_bytes()).hexdigest()
        lines.append(f"- `{name}` · `{digest}`")
    return "\n".join(lines) + "\n"


def main():
    assets = ROOT / "public" / "models"
    stats = json.loads((assets / "norm_stats.json").read_text(encoding="utf-8"))
    mean = np.asarray(stats["obs_mean"])
    scale = np.sqrt(np.asarray(stats["obs_var"]) + stats["epsilon"])
    clip = stats["clip_obs"]
    options = ort.SessionOptions()
    options.intra_op_num_threads = 1
    session = ort.InferenceSession(str(assets / "rocket_policy.onnx"), options, providers=["CPUExecutionProvider"])

    def infer(obs):
        normalized = np.clip((obs - mean) / scale, -clip, clip).astype(np.float32)
        action, = session.run(["action"], {"obs": normalized[None, :]})
        return action[0].clip(-1, 1)

    env = RocketLandingEnv()
    try:
        evaluations = [(name, evaluate(env, infer, expansion, wind)) for name, expansion, wind in SCENARIOS]
    finally:
        env.close()
    markdown = report(evaluations, assets)
    (ROOT / "docs" / "evaluation-report.md").write_text(markdown, encoding="utf-8")
    print(markdown, end="")


if __name__ == "__main__":
    main()
