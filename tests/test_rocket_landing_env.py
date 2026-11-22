"""Run with python -m unittest discover -s tests -p 'test_rocket_landing_env.py'."""
import math
import unittest

import numpy as np
from gymnasium.utils.env_checker import check_env
from env.rocket_landing_env import RocketLandingEnv


class LandingTests(unittest.TestCase):
    def make(self, state, **kwargs):
        env = RocketLandingEnv(**kwargs)
        obs, _ = env.reset(seed=42, options={"initial_state": state})
        self.assertEqual(obs.shape, (7,))
        self.assertEqual(obs.dtype, np.float32)
        self.assertTrue(env.observation_space.contains(obs))
        return env

    def test_gymnasium_contract(self):
        check_env(RocketLandingEnv(), skip_render_check=True)

    def test_seed_and_copy(self):
        env = RocketLandingEnv()
        a, _ = env.reset(seed=42)
        b, _ = env.reset(seed=42)
        np.testing.assert_array_equal(a, b)
        b[:] = 0
        self.assertGreater(env._state[1], 0)

    def test_action_mapping_and_torque(self):
        for action, throttle, delta in [([-1, -1], .4, -math.pi/12), ([0, 0], .7, 0), ([1, 1], 1, math.pi/12)]:
            env = self.make([0, 10, 0, 0, 0, 0, .5])
            state, _, _, _, info = env.step(action)
            self.assertAlmostEqual(info['thrust_ratio'], throttle)
            self.assertAlmostEqual(info['gimbal_angle'], delta)
            self.assertAlmostEqual(state[5], info['torque']/info['inertia']*.05, places=6)
            if delta:
                self.assertLess(state[5]*delta, 0)

    def test_explicit_euler_free_fall(self):
        env = self.make([0, 10, 2, -1, 0, .2, 0])
        obs, _, _, _, info = env.step([1, 0])
        np.testing.assert_allclose(obs[:6], [.1, 9.95, 2, -1-.05*9.81, .01, .2], atol=1e-6)
        self.assertEqual(info['thrust'], 0)

    def test_partial_fuel_and_depletion(self):
        env = self.make([0, 10, 0, 0, 0, 0, .001])
        s, _, _, _, info = env.step([1, 0])
        self.assertEqual(s[6], 0)
        self.assertAlmostEqual(info['actual_thrust_ratio'], .25)
        self.assertEqual(env.step([1, 0])[4]['thrust'], 0)

    def test_reward(self):
        env = self.make([3, 10, 1, -1, .2, .1, .5])
        _, reward, ended, truncated, info = env.step([0, 0])
        x,y,vx,vy,theta,_,_=env._state
        expected=-.1*math.hypot(x,y)-.2*math.hypot(vx,vy)-.5*abs(theta)-.05*.7
        self.assertAlmostEqual(reward, expected)
        self.assertFalse(ended or truncated)
        self.assertEqual(info['reward_terminal'], 0)

    def test_success_and_impact_preservation(self):
        env = self.make([0, .01, 0, -.5, 0, 0, 0])
        obs,reward,ended,truncated,info = env.step([-1,0])
        self.assertTrue(ended and info['is_success'])
        self.assertFalse(truncated)
        self.assertEqual(obs[1], 0)
        self.assertLess(obs[3], 0)
        self.assertEqual(info['reward_terminal'], 200)
        self.assertGreater(reward, 190)
        self.assertRaises(RuntimeError, env.step, [-1,0])

    def test_failure_and_strict_boundaries(self):
        for state in [[2,.01,0,-.5,0,0,0],[0,.01,0,-3,0,0,0],[0,.01,0,-.5,.11,0,0]]:
            env=self.make(state)
            _,_,end,_,info=env.step([-1,0])
            self.assertTrue(end)
            self.assertFalse(info['is_success'])
            self.assertEqual(info['reward_terminal'], -100)

    def test_bounds_and_time_limit(self):
        env=self.make([99.9,10,4,0,0,0,0])
        self.assertEqual(env.step([-1,0])[4]['outcome'],'out_of_bounds')
        env=self.make([0,10,0,0,0,0,0],max_steps=1)
        _,_,end,truncated,info=env.step([-1,0])
        self.assertFalse(end)
        self.assertTrue(truncated)
        self.assertEqual(info['outcome'],'time_limit')

    def test_invalid_inputs(self):
        self.assertRaises(ValueError,RocketLandingEnv,dry_mass=0)
        env=RocketLandingEnv()
        self.assertRaises(RuntimeError,env.step,[0,0])
        env.reset(seed=1)
        for action in [[0], [2,0], [float('nan'),0]]:
            self.assertRaises(ValueError,env.step,action)
        self.assertRaises(ValueError,env.reset,options={'initial_state':[0,0,0,0,0,0,0]})


if __name__ == '__main__':
    unittest.main()
