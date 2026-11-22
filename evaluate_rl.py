"""Evaluate one episode and export raw states for the synthetic landing task."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import gymnasium as gym
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
from stable_baselines3 import PPO
from stable_baselines3.common.vec_env import DummyVecEnv, VecNormalize

from env.rocket_landing_env import RocketLandingEnv


class RawStateInfo(gym.Wrapper):
    """Preserve raw terminal observations before DummyVecEnv auto-resets.

    Inverting clipped normalized observations can lose information, so keep an
    independent copy instead. This wrapper does not change physics or rewards.
    """
    def step(self, action):
        obs, reward, terminated, truncated, info = self.env.step(action)
        info = dict(info, raw_observation=obs.copy(), raw_reward=float(reward))
        return obs, reward, terminated, truncated, info


def row(obs, t, thrust, gimbal, force_theta):
    x, y, vx, vy, theta, _, _ = map(float, obs)
    return dict(t=float(t), x=x, y=y, vx=vx, vy=vy, theta=theta,
                thrust=float(thrust), gimbal=float(gimbal),
                force_theta=float(force_theta))


def plot_trajectory(rows, destination: Path) -> None:
    x = np.array([r['x'] for r in rows])
    y = np.array([r['y'] for r in rows])
    fig, axes = plt.subplots(1, 2, figsize=(12, 5))
    ax, tx = axes
    ax.plot(x, y, color='steelblue', label='Trajectory')
    ax.scatter(x[0], y[0], marker='o', label='Start')
    ax.scatter(x[-1], y[-1], marker='x', label='End')
    ax.plot([-2, 2], [0, 0], color='green', linewidth=4, label='Target pad')
    # The logged action applies during the preceding step: anchor arrows at
    # the preceding position and use the preceding attitude, not a later one.
    indices = np.arange(1, len(rows), max(1, (len(rows)-1)//30))
    if len(indices):
        forces = np.array([rows[i]['thrust'] for i in indices])
        angles = np.array([rows[i]['force_theta'] for i in indices])
        maximum = forces.max()
        if maximum > 0:
            arrow_m_per_n = max(float(np.ptp(x)), float(np.ptp(y)), 5.)*.1/maximum
            ax.quiver(x[indices-1], y[indices-1], -forces*np.sin(angles)*arrow_m_per_n,
                      forces*np.cos(angles)*arrow_m_per_n, angles='xy', scale_units='xy',
                      scale=1, color='darkorange', width=.004)
            fig.text(.05, .015, f'Arrow scale: {arrow_m_per_n:.3g} m / N (display only)', fontsize=9)
            margin = max(float(np.ptp(x)), float(np.ptp(y)), 5.) * .2
            ax.set_xlim(min(float(x.min()), -2)-margin, max(float(x.max()), 2)+margin)
            ax.set_ylim(min(float(y.min()), 0)-margin, float(y.max())+margin)
    ax.set(xlabel='x [m]', ylabel='y [m]', title='One deterministic-policy episode')
    ax.set_aspect('equal', adjustable='datalim')
    ax.grid(alpha=.2)
    ax.legend()
    tx.step([r['t'] for r in rows], [r['thrust'] for r in rows], where='pre')
    tx.set(xlabel='t [s]', ylabel='Applied thrust [N]', title='Step-averaged applied thrust')
    tx.grid(alpha=.2)
    fig.tight_layout(rect=(0, .05, 1, 1))
    fig.savefig(destination, dpi=160)
    plt.close(fig)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', type=Path, default=Path('models/ppo_landing_final.zip'))
    parser.add_argument('--vec-normalize', type=Path, default=Path('models/vec_normalize.pkl'))
    parser.add_argument('--seed', type=int, default=2026)
    parser.add_argument('--output', type=Path, default=Path('trajectory_log.json'))
    parser.add_argument('--plot', type=Path, default=Path('trajectory_plot.png'))
    args = parser.parse_args()
    for p in [args.model, args.vec_normalize]:
        if not p.is_file():
            parser.error(f'Missing input: {p}')
    for p in [args.output, args.plot]:
        if p.exists():
            parser.error(f'Refusing to overwrite {p}; choose another output path.')
    raw = DummyVecEnv([lambda: RawStateInfo(RocketLandingEnv())])
    try:
        env = VecNormalize.load(str(args.vec_normalize), raw)
    except Exception:
        raw.close()
        raise
    try:
        env.training = False
        env.norm_reward = False
        env.seed(args.seed)
        model = PPO.load(str(args.model), env=env, device='cpu')
        obs = env.reset()
        previous = env.get_original_obs()[0].copy()
        rows = [row(previous, 0, 0, 0, previous[4])]
        total_reward = 0.0
        while True:
            action, _ = model.predict(obs, deterministic=True)
            obs, _, dones, infos = env.step(action)
            info = infos[0]
            current = info['raw_observation']
            rows.append(row(current, info['time'], info['thrust'], info['gimbal_angle'],
                            float(previous[4])+info['gimbal_angle']))
            total_reward += info['raw_reward']
            previous = current.copy()
            if dones[0]:
                break
        for p in [args.output, args.plot]:
            p.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(rows, indent=2, allow_nan=False), encoding='utf-8')
        plot_trajectory(rows, args.plot)
        print(json.dumps(dict(seed=args.seed, steps=len(rows)-1, outcome=info['outcome'],
                              is_success=info['is_success'], episode_return=total_reward,
                              trajectory=str(args.output), plot=str(args.plot)), indent=2))
    finally:
        env.close()


if __name__ == '__main__':
    main()
