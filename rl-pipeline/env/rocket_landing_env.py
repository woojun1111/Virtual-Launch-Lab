"""Synthetic Y-up planar landing environment backed by shared JSON constants.

Units: metres, seconds, kilograms, newtons, radians. theta=0 is upright;
positive theta and gimbal are counterclockwise in the XY plane (about +Z).

Web parity contract:
* Internal state is float64; returned observations are float32 copies.
* Use explicit Euler: positions/angle use OLD velocities; velocities use
  accelerations computed from the OLD state and start-of-step total mass.
* Inertia is the configured constant, not recomputed from fuel mass.
* Fuel is reduced AFTER the step, clamped to zero. If a step starts with fuel,
  it receives the requested thrust for that entire step. This simple discrete
  model does not resolve partial-step fuel exhaustion or contact time.
* Do not wrap theta or clamp y at contact. Evaluate reward and termination
  from the updated state. Sharing constants alone does not ensure parity:
  the web implementation must also follow this update order and these rules.

This module does not include a controller, trainer, renderer or validated
vehicle model. No third-party physics engine is required.
"""
from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import gymnasium as gym
import numpy as np
from gymnasium import spaces


class RocketLandingEnv(gym.Env):
    metadata = {"render_modes": []}
    MAX_STEPS = 600
    LANDING_LIMITS = {"x": 2.5, "vx": 1.5, "vy": 2.5, "theta": 0.1}
    CONFIG_KEYS = (
        "dt", "gravity", "dry_mass", "initial_fuel_mass", "max_thrust",
        "min_thrust_ratio", "max_gimbal_deg", "fuel_consumption_rate",
        "wind_acceleration_per_mps", "rocket_length", "moment_of_inertia",
    )

    def __init__(self, config_path: str | Path | None = None) -> None:
        super().__init__()
        self.config_path = (Path(config_path).expanduser().resolve()
                            if config_path is not None else
                            Path(__file__).resolve().parents[2] / "shared" / "physics_config.json")
        with self.config_path.open(encoding="utf-8") as handle:
            config = json.load(handle)
        if not isinstance(config, dict):
            raise ValueError("Physics configuration must be a JSON object")
        self.config = {}
        for key in self.CONFIG_KEYS:
            value = config.get(key)
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                raise ValueError(f"Missing or invalid finite numeric physics constant: {key}")
            self.config[key] = float(value)
        for key in ("dt", "dry_mass", "max_thrust", "rocket_length", "moment_of_inertia"):
            if self.config[key] <= 0:
                raise ValueError(f"{key} must be positive")
        for key in ("gravity", "initial_fuel_mass", "max_gimbal_deg", "fuel_consumption_rate",
                    "wind_acceleration_per_mps"):
            if self.config[key] < 0:
                raise ValueError(f"{key} must be nonnegative")
        if not 0 <= self.config["min_thrust_ratio"] <= 1:
            raise ValueError("min_thrust_ratio must be in [0, 1]")
        for key, value in self.config.items():
            setattr(self, key, value)
        self.max_gimbal_rad = math.radians(self.max_gimbal_deg)
        self.action_space = spaces.Box(-1.0, 1.0, shape=(2,), dtype=np.float32)
        # Terminal observations may be below the ground or outside the bounds.
        self.observation_space = spaces.Box(
            low=np.array([-np.inf]*6 + [0.0], dtype=np.float32),
            high=np.array([np.inf]*6 + [self.initial_fuel_mass], dtype=np.float32),
            dtype=np.float32,
        )
        self.wind_speed = 0.0
        self.state: np.ndarray | None = None
        self.step_count = 0
        self._done = False

    def _observation(self) -> np.ndarray:
        return self.state.astype(np.float32, copy=True)

    def reset(self, *, seed: int | None = None,
              options: dict[str, Any] | None = None):
        super().reset(seed=seed)
        options = options or {}
        wind_speed = float(options.get("wind_speed", 0.0))
        if not math.isfinite(wind_speed):
            raise ValueError("wind_speed must be finite")
        initial_state = options.get("initial_state")
        if initial_state is None:
            initial_state = [
                self.np_random.uniform(-50.0, 50.0),
                self.np_random.uniform(150.0, 250.0),
                self.np_random.uniform(-10.0, 10.0),
                self.np_random.uniform(-25.0, -5.0),
                self.np_random.uniform(-0.2, 0.2),
                0.0,
                self.initial_fuel_mass,
            ]
        state = np.array(initial_state, dtype=np.float64, copy=True)
        if state.shape != (7,) or not np.all(np.isfinite(state)):
            raise ValueError("Initial state must contain seven finite values")
        x, y, _, _, theta, _, fuel = state
        if y <= 0 or abs(x) > 150 or abs(theta) > 1.2 or not 0 <= fuel <= self.initial_fuel_mass:
            raise ValueError("Initial state is outside the active episode bounds")
        self.wind_speed = wind_speed
        self.state = state
        self.step_count = 0
        self._done = False
        return self._observation(), {"is_success": False, "outcome": "running", "time": 0.0}

    def step(self, action):
        if self.state is None or self._done:
            raise RuntimeError("Call reset() before starting or restarting an episode")
        action = np.asarray(action, dtype=np.float64)
        if action.shape != (2,) or not np.all(np.isfinite(action)):
            raise ValueError("Action must contain two finite numbers")
        if np.any(action < -1.0) or np.any(action > 1.0):
            raise ValueError("Action must be within [-1, 1]")
        raw_thrust, raw_gimbal = map(float, action)
        thrust_ratio = (self.min_thrust_ratio + (raw_thrust + 1.0)*0.5
                        * (1.0-self.min_thrust_ratio))
        gimbal_rad = raw_gimbal * self.max_gimbal_rad
        x, y, vx, vy, theta, omega, fuel_mass = self.state
        thrust = self.max_thrust * thrust_ratio if fuel_mass > 0.0 else 0.0
        total_mass = self.dry_mass + fuel_mass
        fx = -thrust * math.sin(theta + gimbal_rad)
        fy = thrust * math.cos(theta + gimbal_rad) - total_mass*self.gravity
        torque = -thrust * math.sin(gimbal_rad) * (self.rocket_length/2.0)
        # Synthetic horizontal disturbance shared with the web demo.
        fx += total_mass * self.wind_acceleration_per_mps * self.wind_speed
        ax, ay = fx/total_mass, fy/total_mass
        alpha = torque/self.moment_of_inertia
        fuel_used = min(fuel_mass, thrust*self.fuel_consumption_rate*self.dt)
        self.state = np.array([
            x + vx*self.dt, y + vy*self.dt,
            vx + ax*self.dt, vy + ay*self.dt,
            theta + omega*self.dt, omega + alpha*self.dt,
            max(0.0, fuel_mass-fuel_used),
        ], dtype=np.float64)
        self.step_count += 1
        x, y, vx, vy, theta, omega, fuel_mass = self.state
        distance = math.hypot(x, y)
        speed = math.hypot(vx, vy)
        dense_reward = -.05*distance - .1*speed - .5*abs(theta) - .02*thrust_ratio
        contact = bool(y <= 0.0)
        limits = self.LANDING_LIMITS
        success = bool(contact and abs(x) < limits["x"] and abs(vx) < limits["vx"]
                       and abs(vy) < limits["vy"] and abs(theta) < limits["theta"])
        out_of_bounds = bool(abs(x) > 150.0 or abs(theta) > 1.2)
        terminated = bool(success or contact or out_of_bounds)
        # 600 steps is the maximum episode length (30 simulated seconds).
        # Physical termination takes precedence over simultaneous timeout.
        truncated = bool(self.step_count >= self.MAX_STEPS and not terminated)
        terminal_reward = 200.0 if success else (-100.0 if terminated else 0.0)
        outcome = ("landed" if success else "crashed" if contact else
                   "out_of_bounds" if out_of_bounds else "time_limit" if truncated else "running")
        self._done = terminated or truncated
        info = {
            "is_success": success, "outcome": outcome, "time": self.step_count*self.dt,
            "distance_to_pad": distance, "speed": speed,
            "thrust_ratio": thrust_ratio, "thrust": thrust, "gimbal_rad": gimbal_rad,
            "force_x": fx, "force_y": fy, "torque": torque,
            "fuel_used": float(fuel_used), "reward_dense": dense_reward,
            "reward_terminal": terminal_reward,
        }
        if contact:
            info["impact_state"] = self.state.copy()
        return self._observation(), float(dense_reward + terminal_reward), terminated, truncated, info
