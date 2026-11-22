"""Small, synthetic 2-D landing task; not a validated vehicle model.

Coordinates: x right, y up; theta=0 points upward. Positive theta is
counterclockwise. Positive gimbal is counterclockwise relative to the body.
Fixed geometry, a uniform rectangular-body inertia approximation, no atmosphere,
no restart controller, and no trained policy are included.
"""
from __future__ import annotations

import math
from typing import Any

import gymnasium as gym
import numpy as np
from gymnasium import spaces


class RocketLandingEnv(gym.Env):
    """Gymnasium environment with explicit Euler integration (SI units).

    Actions: a[0] maps [-1, 1] to requested throttle [0.4, 1.0]; a[1]
    maps to [-15, 15] degrees. There is no engine-off action while fuel remains.
    ``fuel_burn_rate`` is the synthetic full-throttle mass flow (kg/s).
    Dense reward uses POST-step state and requested mapped throttle, not a[0].
    Terminal rewards are added to the dense reward, as requested.

    Contact is detected at the end of a discrete step, not via continuous
    collision detection. Vertical position is then clamped to zero; impact
    velocities and attitude are preserved. If fuel runs out within a step,
    average delivered thrust is reduced to the available burn fraction.
    """

    metadata = {"render_modes": []}

    def __init__(
        self,
        *,
        dry_mass: float = 1.0,
        initial_fuel_mass: float = 0.5,
        max_thrust: float = 30.0,
        fuel_burn_rate: float = 0.08,
        body_length: float = 1.0,
        body_width: float = 0.1,
        x_limit: float = 100.0,
        y_limit: float = 200.0,
        max_steps: int = 1000,
    ) -> None:
        super().__init__()
        positive = dict(dry_mass=dry_mass, max_thrust=max_thrust,
                        fuel_burn_rate=fuel_burn_rate, body_length=body_length,
                        body_width=body_width, x_limit=x_limit, y_limit=y_limit)
        if any(not np.isfinite(v) or v <= 0 for v in positive.values()):
            raise ValueError("Mass, thrust, flow, dimensions and limits must be positive and finite")
        if not np.isfinite(initial_fuel_mass) or initial_fuel_mass < 0:
            raise ValueError("initial_fuel_mass must be finite and nonnegative")
        if isinstance(max_steps, bool) or not isinstance(max_steps, int) or max_steps <= 0:
            raise ValueError("max_steps must be a positive integer")
        self.dt = 0.05
        self.gravity = 9.81
        self.max_gimbal_angle = math.radians(15.0)
        for name, value in positive.items():
            setattr(self, name, float(value))
        self.initial_fuel_mass = float(initial_fuel_mass)
        self.max_steps = max_steps
        self.action_space = spaces.Box(-1.0, 1.0, shape=(2,), dtype=np.float32)
        # Unbounded position/velocity avoids excluding terminal observations.
        low = np.array([-np.inf] * 6 + [0.0], dtype=np.float32)
        high = np.array([np.inf] * 6 + [initial_fuel_mass], dtype=np.float32)
        self.observation_space = spaces.Box(low, high, dtype=np.float32)
        self._state: np.ndarray | None = None
        self._steps = 0
        self._ended = False

    def _observation(self) -> np.ndarray:
        return self._state.astype(np.float32, copy=True)

    def reset(self, *, seed: int | None = None, options: dict[str, Any] | None = None):
        super().reset(seed=seed)
        options = options or {}
        if "initial_state" in options:
            state = np.array(options["initial_state"], dtype=np.float64, copy=True)
        else:
            state = np.array([
                self.np_random.uniform(-min(10.0, self.x_limit * .5), min(10.0, self.x_limit * .5)),
                self.np_random.uniform(.15 * self.y_limit, .25 * self.y_limit),
                self.np_random.uniform(-1.0, 1.0),
                self.np_random.uniform(-3.0, -1.0),
                self.np_random.uniform(-.15, .15), 0.0, self.initial_fuel_mass,
            ], dtype=np.float64)
        if state.shape != (7,) or not np.all(np.isfinite(state)):
            raise ValueError("initial_state must contain seven finite numbers")
        if not (-self.x_limit < state[0] < self.x_limit and 0 < state[1] < self.y_limit):
            raise ValueError("Initial position must be above ground and inside the bounds")
        if not 0 <= state[6] <= self.initial_fuel_mass:
            raise ValueError("Initial fuel must be within configured capacity")
        state[4] = (state[4] + math.pi) % (2 * math.pi) - math.pi
        if np.any(np.abs(state) > np.finfo(np.float32).max):
            raise ValueError("State exceeds observation precision range")
        self._state, self._steps, self._ended = state, 0, False
        return self._observation(), {"is_success": False, "outcome": "running"}

    def step(self, action):
        if self._state is None or self._ended:
            raise RuntimeError("Call reset() before stepping a new episode")
        action = np.asarray(action, dtype=np.float64)
        if action.shape != (2,) or not np.all(np.isfinite(action)):
            raise ValueError("Action must contain two finite numbers")
        if np.any(action < -1.0) or np.any(action > 1.0):
            raise ValueError("Action must be in [-1, 1]")
        throttle = 0.4 + 0.6 * (float(action[0]) + 1.0) / 2.0
        gimbal = float(action[1]) * self.max_gimbal_angle
        x, y, vx, vy, theta, omega, fuel = self._state
        fuel_used = min(fuel, self.fuel_burn_rate * throttle * self.dt)
        actual_throttle = fuel_used / (self.fuel_burn_rate * self.dt)
        thrust = self.max_thrust * actual_throttle
        mass = self.dry_mass + fuel
        inertia = mass * (self.body_length**2 + self.body_width**2) / 12.0
        fx = -thrust * math.sin(theta + gimbal)
        fy = thrust * math.cos(theta + gimbal)
        # Engine at the base, half a body length below the center of mass.
        torque = -0.5 * self.body_length * thrust * math.sin(gimbal)
        next_state = np.array([
            x + vx * self.dt, y + vy * self.dt,
            vx + fx / mass * self.dt,
            vy + (fy / mass - self.gravity) * self.dt,
            theta + omega * self.dt,
            omega + torque / inertia * self.dt,
            max(0.0, fuel - fuel_used),
        ], dtype=np.float64)
        next_state[4] = (next_state[4] + math.pi) % (2 * math.pi) - math.pi
        if not np.all(np.isfinite(next_state)) or np.any(np.abs(next_state) > np.finfo(np.float32).max):
            raise FloatingPointError("Integration produced an invalid state")
        self._steps += 1
        out_of_bounds = abs(next_state[0]) >= self.x_limit or next_state[1] >= self.y_limit
        contact = next_state[1] <= 0
        if contact:
            next_state[1] = 0.0
        success = bool(contact and not out_of_bounds and abs(next_state[0]) < 2.0
                       and abs(next_state[3]) < 2.0 and abs(next_state[4]) < 0.1)
        terminated = bool(contact or out_of_bounds)
        truncated = bool(not terminated and self._steps >= self.max_steps)
        self._state = next_state
        distance = math.hypot(next_state[0], next_state[1])
        speed = math.hypot(next_state[2], next_state[3])
        dense = -.1 * distance - .2 * speed - .5 * abs(next_state[4]) - .05 * throttle
        bonus = 200.0 if success else (-100.0 if terminated else 0.0)
        outcome = ("landed" if success else "out_of_bounds" if out_of_bounds else
                   "crashed" if contact else "time_limit" if truncated else "running")
        self._ended = terminated or truncated
        info = dict(is_success=success, outcome=outcome, time=self._steps*self.dt,
                    distance_to_pad=distance, speed=speed, thrust_ratio=throttle,
                    actual_thrust_ratio=actual_throttle, thrust=thrust, gimbal_angle=gimbal,
                    fuel_used=fuel_used, inertia=inertia, torque=torque,
                    reward_dense=dense, reward_terminal=bonus)
        if contact:
            info["impact_state"] = next_state.copy()
        return self._observation(), float(dense + bonus), terminated, truncated, info
