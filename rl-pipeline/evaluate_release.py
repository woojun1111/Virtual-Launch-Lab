"""Evaluate the checked-in release on 50 fixed initial conditions."""
import json
from collections import Counter
from pathlib import Path

import numpy as np
import onnxruntime as ort

from env.rocket_landing_env import RocketLandingEnv


def main():
    assets = Path(__file__).resolve().parents[1] / "public" / "models"
    stats = json.loads((assets / "norm_stats.json").read_text(encoding="utf-8"))
    mean = np.asarray(stats["obs_mean"])
    scale = np.sqrt(np.asarray(stats["obs_var"]) + stats["epsilon"])
    clip = stats["clip_obs"]
    session = ort.InferenceSession(str(assets / "rocket_policy.onnx"), providers=["CPUExecutionProvider"])
    outcomes = Counter()
    env = RocketLandingEnv()
    try:
        for seed in range(1000, 1050):
            obs, _ = env.reset(seed=seed)
            while True:
                normalized = np.clip((obs - mean) / scale, -clip, clip).astype(np.float32)
                action, = session.run(["action"], {"obs": normalized[None, :]})
                obs, _, terminated, truncated, info = env.step(action[0].clip(-1, 1))
                if terminated or truncated:
                    outcomes[info["outcome"]] += 1
                    break
    finally:
        env.close()
    print(f"Seeds 1000–1049: {outcomes['landed']}/50 landed; {dict(outcomes)}")


if __name__ == "__main__":
    main()
