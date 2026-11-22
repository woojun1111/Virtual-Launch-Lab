import unittest
import numpy as np
from stable_baselines3.common.vec_env import DummyVecEnv, VecNormalize
from evaluate_rl import RawStateInfo
from env.rocket_landing_env import RocketLandingEnv


class ExportTests(unittest.TestCase):
    def test_raw_terminal_state_and_frozen_normalization(self):
        env=VecNormalize(DummyVecEnv([lambda: RawStateInfo(RocketLandingEnv())]),
                         training=False, norm_obs=True, norm_reward=False, clip_obs=.01)
        try:
            env.set_options({'initial_state':[0,.01,0,-.5,0,0,0]})
            env.reset()
            mean=env.obs_rms.mean.copy()
            count=env.obs_rms.count
            obs,reward,done,infos=env.step(np.array([[-1,0]],dtype=np.float32))
            self.assertTrue(done[0])
            raw=infos[0]['raw_observation']
            self.assertEqual(raw[1],0)
            self.assertAlmostEqual(raw[3],-.5-9.81*.05,places=6)
            self.assertNotEqual(env.get_original_obs()[0][1],0)  # auto-reset
            self.assertAlmostEqual(float(reward[0]),infos[0]['raw_reward'],places=4)
            np.testing.assert_array_equal(env.obs_rms.mean,mean)
            self.assertEqual(env.obs_rms.count,count)
        finally:
            env.close()


if __name__ == '__main__':
    unittest.main()
