"""PPO training for the synthetic Gymnasium exercise, not real flight control."""
from __future__ import annotations

import argparse
from pathlib import Path
import sys

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
from stable_baselines3 import PPO
from stable_baselines3.common.callbacks import CheckpointCallback
from stable_baselines3.common.monitor import Monitor
from stable_baselines3.common.results_plotter import load_results
from stable_baselines3.common.vec_env import DummyVecEnv, VecNormalize

sys.path.insert(0, str(Path(__file__).resolve().parent / "rl-pipeline" / "env"))
from rocket_landing_env import RocketLandingEnv


def plot_training_curve(log_dir: Path, destination: Path, window: int = 50) -> None:
    """Monitor is INSIDE VecNormalize, so these returns are unnormalized."""
    data = load_results(str(log_dir))
    returns = np.asarray(data['r'], dtype=float)
    fig, ax = plt.subplots(figsize=(10, 5))
    if len(returns):
        episodes = np.arange(1, len(returns) + 1)
        # Prefix-aware trailing mean: do not pad early episodes with zeros.
        cumulative = np.r_[0.0, np.cumsum(returns)]
        starts = np.maximum(0, episodes-window)
        mean = (cumulative[episodes]-cumulative[starts])/(episodes-starts)
        ax.plot(episodes, returns, alpha=.25, label='Episode return (raw)')
        ax.plot(episodes, mean, label=f'Trailing mean, up to {window} episodes')
        ax.legend()
    else:
        ax.text(.5, .5, 'No completed episodes', ha='center', transform=ax.transAxes)
    ax.set(xlabel='Completed episode', ylabel='Unnormalized episode return',
           title='PPO training — synthetic landing task')
    ax.grid(alpha=.2)
    fig.tight_layout()
    fig.savefig(destination, dpi=160)
    plt.close(fig)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--total-timesteps', type=int, default=500_000)
    parser.add_argument('--checkpoint-freq', type=int, default=50_000)
    parser.add_argument('--n-steps', type=int, default=2000)
    parser.add_argument('--batch-size', type=int, default=100)
    parser.add_argument('--seed', type=int, default=42)
    parser.add_argument('--models-dir', type=Path, default=Path('models'))
    parser.add_argument('--curve-path', type=Path, default=Path('training_curve.png'))
    args = parser.parse_args()
    if (args.n_steps < 2 or args.batch_size < 2 or args.n_steps % args.batch_size
            or args.total_timesteps <= 0 or args.total_timesteps % args.n_steps
            or args.checkpoint_freq <= 0):
        parser.error('Use positive counts, n_steps >= 2, and full batches/rollouts (total_timesteps divisible by n_steps).')
    # Avoid mixing Monitor rows or overwriting a previous model/statistics pair.
    if args.models_dir.exists() and any(args.models_dir.iterdir()):
        parser.error('models-dir is not empty. Choose a new directory for this run.')
    if args.curve_path.exists():
        parser.error('curve-path already exists. Choose a new filename.')
    logs = args.models_dir/'logs'
    logs.mkdir(parents=True, exist_ok=True)
    args.curve_path.parent.mkdir(parents=True, exist_ok=True)
    vec = DummyVecEnv([lambda: Monitor(RocketLandingEnv(), str(logs/'train.monitor.csv'))])
    vec.seed(args.seed)
    env = VecNormalize(vec, norm_obs=True, norm_reward=True, gamma=.99)
    try:
        model = PPO('MlpPolicy', env, n_steps=args.n_steps, batch_size=args.batch_size,
                    seed=args.seed, verbose=1, device='cpu', gamma=.99)
        checkpoint = CheckpointCallback(
            save_freq=args.checkpoint_freq, save_path=str(args.models_dir),
            name_prefix='ppo_landing', save_vecnormalize=True)
        model.learn(total_timesteps=args.total_timesteps, callback=checkpoint)
        model.save(str(args.models_dir/'ppo_landing_final'))
        env.save(str(args.models_dir/'vec_normalize.pkl'))
    finally:
        env.close()
    plot_training_curve(logs, args.curve_path)
    print(f'Saved model/statistics in {args.models_dir}, curve in {args.curve_path}')


if __name__ == '__main__':
    main()
