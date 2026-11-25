"""Tests for the official Gymnasium environment and its JS counterpart."""
import json
from pathlib import Path
import subprocess
import sys
import unittest

from gymnasium.utils.env_checker import check_env
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "rl-pipeline" / "env"))
from rocket_landing_env import RocketLandingEnv


class EnvironmentTests(unittest.TestCase):
    def test_gymnasium_and_seed(self):
        env = RocketLandingEnv()
        check_env(env, skip_render_check=True)
        first, _ = env.reset(seed=42)
        second, _ = env.reset(seed=42)
        np.testing.assert_array_equal(first, second)
        self.assertEqual(env.wind_speed, 0)
        self.assertTrue(env.observation_space.contains(second))

    def test_terminal_state(self):
        env = RocketLandingEnv()
        env.reset(options={"initial_state": [0, .01, 0, -1, 0, 0, 0]})
        _, _, terminated, truncated, info = env.step([-1, 0])
        self.assertTrue(terminated)
        self.assertFalse(truncated)
        self.assertTrue(info["is_success"])
        self.assertAlmostEqual(info["impact_state"][1], -.04)
        self.assertAlmostEqual(info["impact_state"][3], -1 - 9.81 * .05)
        with self.assertRaises(RuntimeError):
            env.step([-1, 0])

    def test_unpowered_wind_has_expected_sign_and_reset_restores_calm(self):
        env = RocketLandingEnv()
        env.reset(options={"initial_state": [0, 100, 0, 0, 0, 0, 0], "wind_speed": -5})
        env.step([1, 0])
        self.assertAlmostEqual(env.state[2], -.025)
        env.reset(seed=4)
        self.assertEqual(env.wind_speed, 0)

    def test_python_javascript_step_parity(self):
        start = [3, 200, 1, -8, .1, .02, 500]
        actions = [[.1, -.15], [-.5, -.2], [1, .3], [-1, 0]] * 6
        script = """
          import RocketLandingSim from './src/simulation/RocketLandingSim.js';
          import config from './shared/physics_config.json' with { type: 'json' };
          const [start, actions] = JSON.parse(process.argv[1]);
          const sim = await new RocketLandingSim({ config, async init() {} }).init();
          const runs = [];
          for (const wind of [0, -5, 5]) {
            sim.reset(start);
            sim.setWindSpeed(wind);
            const steps = [];
            for (const [throttle, gimbal] of actions) {
              const thrustRatio = config.min_thrust_ratio + (throttle + 1) * .5 * (1 - config.min_thrust_ratio);
              const gimbalRad = gimbal * (config.max_gimbal_deg * Math.PI / 180);
              steps.push(await sim.step(config.dt, { thrustRatio, gimbalRad }));
            }
            runs.push(steps);
          }
          console.log(JSON.stringify(runs));
        """
        result = subprocess.check_output(
            ["node", "--input-type=module", "-e", script, json.dumps([start, actions])],
            cwd=ROOT, text=True,
        )
        env = RocketLandingEnv()
        maximum_error = 0
        for wind, steps in zip((0, -5, 5), json.loads(result), strict=True):
            env.reset(options={"initial_state": start, "wind_speed": wind})
            for action, js in zip(actions, steps, strict=True):
                _, reward, terminated, truncated, info = env.step(action)
                expected = np.array([js[key] for key in ("x", "y", "vx", "vy", "theta", "omega", "fuel")])
                maximum_error = max(maximum_error, float(np.max(np.abs(env.state - expected))))
                np.testing.assert_allclose(env.state, expected, atol=1e-12, rtol=0)
                self.assertAlmostEqual(info["force_x"], js["forceX"], delta=1e-9)
                self.assertAlmostEqual(reward, js["reward"], delta=1e-12)
                self.assertEqual((terminated, truncated, info["outcome"]),
                                 (js["terminated"], js["truncated"], js["outcome"]))
        print(f"Python/JS maximum state difference over 72 steps: {maximum_error:.3g}")


if __name__ == "__main__":
    unittest.main()
