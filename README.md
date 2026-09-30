# Powered Descent Guidance

An interactive simulator for **fuel-optimal powered descent guidance** — the
trajectory-optimization problem behind autonomously landing a rocket or
planetary lander.

This reproduces, in spirit, the research problem studied by **Behcet
Acikmese's Autonomous Controls Lab**, which moved to UC Berkeley in 2024.
Acikmese's foundational result — *lossless convexification*
(Acikmese & Ploen, 2007, "Convex Programming Approach to Powered Descent
Guidance for Mars Landing") — is the technique that made it possible to solve
this kind of trajectory optimization onboard a flight computer in real time.
Its descendant, *successive convexification (SCvx)*, is used today to guide
real planetary landers and reusable rockets.

## What it solves

Given a lander's initial position, altitude, and velocity, find the
minimum-propellant thrust profile that brings it to a soft touchdown at the
origin, subject to:

- Point-mass dynamics with a gimbaled, throttleable thrust vector and
  propellant mass depletion (rocket equation)
- A throttle range (30%–90% of max thrust)
- A maximum thrust-tilt angle (20° from vertical)
- A **glide-slope constraint**: the vehicle must stay within a cone above the
  pad for the whole descent, so it never grazes terrain on approach

The real onboard algorithm reformulates the non-convex lower bound on thrust
magnitude into a convex second-order-cone program (lossless convexification),
solvable with guaranteed convergence in milliseconds. Here, the same
nonlinear trajectory-optimization problem is solved directly with a general
NLP solver (IPOPT via CasADi) using 60-node RK4 direct transcription.

## Files

- `solve.py` — the trajectory-optimization model and solver (`solve_descent`)
- `generate.py` — sweeps a grid of initial conditions (altitude, downrange
  offset, initial lateral velocity), solves each with `solve.py`, and writes
  `scenarios.json`
- `data.js` — `scenarios.json` wrapped as a `window.LANDING_DATA` global so
  the page can load it as a plain `<script>` (no fetch/CORS needed)
- `index.html` / `app.js` — the interactive mission-console page: a live
  canvas view of the trajectory with a glide-slope cone, a rocket sprite
  with a thrust plume, real-time telemetry, and altitude/throttle strip
  charts, all driven by the precomputed solves

## Running it

```
pip install casadi numpy
python generate.py      # re-solves the full grid, writes scenarios.json
python -c "import json; open('data.js','w').write('window.LANDING_DATA = ' + open('scenarios.json').read() + ';')"
```

Then open `index.html` in a browser (or serve the folder statically).

## Extending it

Ideas that map onto real active research directions:

- Add wind/atmospheric disturbance and re-solve in a receding-horizon loop
  (model predictive control) instead of a single open-loop solve — this is
  closer to how SCvx is actually used onboard
- Reformulate the thrust lower-bound constraint via lossless convexification
  and solve as an actual SOCP (e.g. with `cvxpy` + `ECOS`/`Clarabel`) instead
  of a general NLP, and compare solve time/reliability against IPOPT
- Extend to 3-DOF or 6-DOF (attitude dynamics, not just point-mass)
