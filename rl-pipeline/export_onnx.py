"""Export normalized-observation -> deterministic raw action, fixed batch=1.

Browser must normalize raw observations BEFORE calling the ONNX graph.
Only load your own trusted SB3 model and pickle normalization files.
"""
import json

import torch
from stable_baselines3 import PPO
from stable_baselines3.common.distributions import DiagGaussianDistribution
from stable_baselines3.common.torch_layers import FlattenExtractor
from stable_baselines3.common.vec_env import VecNormalize
from train_ppo import MODELS_DIR, make_base_env


class OnnxablePolicy(torch.nn.Module):
    def __init__(self, policy):
        super().__init__()
        if not isinstance(policy.action_dist, DiagGaussianDistribution) or not isinstance(
            policy.pi_features_extractor, FlattenExtractor
        ):
            raise ValueError("Expected the flat-observation diagonal Gaussian MlpPolicy")
        self.features = policy.pi_features_extractor
        self.actor = policy.mlp_extractor.policy_net
        self.mean = policy.action_net

    def forward(self, obs):
        # For this unsquashed Gaussian, SB3 deterministic=True selects its mean.
        features = self.features(obs.float())
        return torch.clamp(self.mean(self.actor(features)), -1.0, 1.0)


def main():
    model_path = MODELS_DIR / 'rocket_ppo_final.zip'
    stats_path = MODELS_DIR / 'vec_normalize.pkl'
    for path in [model_path, stats_path]:
        if not path.is_file():
            raise FileNotFoundError(f'Train first; missing {path}')
    output = MODELS_DIR / 'export'
    output.mkdir(parents=True, exist_ok=True)
    base = make_base_env()
    try:
        env = VecNormalize.load(str(stats_path), base)
    except Exception:
        base.close()
        raise
    try:
        env.training = False
        env.norm_reward = False
        if not env.norm_obs or env.obs_rms.mean.shape != (7,):
            raise ValueError('Expected seven normalized observations')
        model = PPO.load(str(model_path), env=env, device='cpu')
        if model.action_space.shape != (2,) or model.policy.squash_output:
            raise ValueError('Expected the unsquashed two-action MlpPolicy from train_ppo.py')
        model.policy.set_training_mode(False)
        wrapper = OnnxablePolicy(model.policy).eval()
        dummy = torch.zeros((1, 7), dtype=torch.float32)
        with torch.no_grad():
            torch.onnx.export(
                wrapper, dummy, str(output / 'rocket_policy.onnx'),
                opset_version=14, input_names=['obs'], output_names=['action'],
                dynamic_axes=None, dynamo=False,
            )
        stats = {
            'obs_mean': env.obs_rms.mean.tolist(),
            'obs_var': env.obs_rms.var.tolist(),
            'epsilon': float(env.epsilon),
            'clip_obs': float(env.clip_obs),
        }
        (output / 'norm_stats.json').write_text(
            json.dumps(stats, indent=2, allow_nan=False), encoding='utf-8')
        print(f'Exported model and normalization statistics to {output}')
    finally:
        env.close()


if __name__ == '__main__':
    main()
