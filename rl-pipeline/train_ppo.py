"""Train the synthetic task. Run explicitly; importing this file never trains."""
from pathlib import Path
import sys

from stable_baselines3 import PPO
from stable_baselines3.common.monitor import Monitor
from stable_baselines3.common.vec_env import DummyVecEnv, VecNormalize

PIPELINE_DIR = Path(__file__).resolve().parent
MODELS_DIR = PIPELINE_DIR / 'models'
# Avoid accidentally importing the older repository-root env/ package.
sys.path.insert(0, str(PIPELINE_DIR / 'env'))
from rocket_landing_env import RocketLandingEnv


def make_base_env():
    return DummyVecEnv([lambda: Monitor(RocketLandingEnv())])


def main():
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    for name in ['rocket_ppo_final.zip', 'vec_normalize.pkl']:
        if (MODELS_DIR / name).exists():
            raise FileExistsError(f'Archive previous outputs first: {MODELS_DIR / name}')
    env = VecNormalize(make_base_env(), norm_obs=True, norm_reward=True,
                       clip_obs=10.0, gamma=0.99)
    env.seed(42)
    try:
        model = PPO('MlpPolicy', env, learning_rate=3e-4, n_steps=2048,
                    batch_size=64, gamma=0.99, gae_lambda=0.95,
                    seed=42, verbose=1, device='cpu')
        # SB3 finishes complete rollouts: with one env, 500,000 requested steps
        # ordinarily means 501,760 actual steps. Hyperparameters are unchanged.
        model.learn(total_timesteps=500_000)
        model.save(str(MODELS_DIR / 'rocket_ppo_final.zip'))
        env.save(str(MODELS_DIR / 'vec_normalize.pkl'))
    finally:
        env.close()


if __name__ == '__main__':
    main()
