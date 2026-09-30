"""
Fuel-optimal powered descent guidance (2D point-mass rocket lander).

This reproduces, in spirit, the trajectory-optimization problem studied by
Behcet Acikmese's Autonomous Controls Lab (now at UC Berkeley): find the
minimum-fuel thrust profile that brings a lander from some initial state
to a soft touchdown at the origin, subject to:
  - bounded thrust magnitude (throttle limits)
  - a maximum thrust-tilt angle (gimbal limit)
  - a glide-slope cone near the pad (no grazing approaches)

The real onboard algorithm (Acikmese & Ploen, 2007, "Convex Programming
Approach to Powered Descent Guidance for Mars Landing") uses a clever
change of variables ("lossless convexification") to turn the non-convex
lower bound on thrust magnitude into a convex second-order-cone program,
which can be solved in milliseconds with guaranteed convergence. Here we
solve the same nonlinear trajectory-optimization problem directly with
CasADi + IPOPT (a general NLP solver) to precompute a bank of trajectories.
"""
import casadi as ca
import numpy as np
import json

# ---- physical constants (Mars powered descent, matching the classic
# Acikmese & Ploen problem setting) ----
G = 3.71          # Mars gravity, m/s^2
ISP = 225.0       # specific impulse, s
G0 = 9.81         # standard gravity for Isp -> mass flow conversion
ALPHA = 1.0 / (ISP * G0)   # mass flow per unit thrust (1/(Isp*g0))

T_MAX = 13260.0   # max thrust, N  (single engine, ~ Mars lander scale, per unit mass considerations below)
THROTTLE_MIN = 0.3
THROTTLE_MAX = 0.9
MAX_TILT_DEG = 20.0

M_DRY = 1505.0    # kg, dry mass
M_FUEL = 400.0    # kg, available fuel
M0 = M_DRY + M_FUEL

GLIDE_SLOPE_DEG = 20.0   # glide-slope angle measured from horizontal ground

N = 60  # shooting segments


def solve_descent(x0, y0, vx0, vy0, tf_guess):
    opti = ca.Opti()

    tf = opti.variable()
    opti.set_initial(tf, tf_guess)
    opti.subject_to(opti.bounded(5.0, tf, 120.0))

    X = opti.variable(5, N + 1)  # x, y, vx, vy, m
    U = opti.variable(2, N)      # Tx, Ty

    x, y, vx, vy, m = X[0, :], X[1, :], X[2, :], X[3, :], X[4, :]

    dt = tf / N

    def f(state, u):
        x_, y_, vx_, vy_, m_ = state[0], state[1], state[2], state[3], state[4]
        Tx, Ty = u[0], u[1]
        return ca.vertcat(vx_, vy_, Tx / m_, Ty / m_ - G, -ALPHA * ca.sqrt(Tx**2 + Ty**2 + 1e-6))

    # RK4 collocation across shooting segments
    for k in range(N):
        s = X[:, k]
        u = U[:, k]
        k1 = f(s, u)
        k2 = f(s + dt / 2 * k1, u)
        k3 = f(s + dt / 2 * k2, u)
        k4 = f(s + dt * k3, u)
        s_next = s + dt / 6 * (k1 + 2 * k2 + 2 * k3 + k4)
        opti.subject_to(X[:, k + 1] == s_next)

    # boundary conditions
    opti.subject_to(x[0] == x0)
    opti.subject_to(y[0] == y0)
    opti.subject_to(vx[0] == vx0)
    opti.subject_to(vy[0] == vy0)
    opti.subject_to(m[0] == M0)

    opti.subject_to(x[N] == 0)
    opti.subject_to(y[N] == 0)
    opti.subject_to(vx[N] == 0)
    opti.subject_to(vy[N] == 0)

    opti.subject_to(m[:] >= M_DRY)

    tilt = np.deg2rad(MAX_TILT_DEG)
    gs = np.deg2rad(GLIDE_SLOPE_DEG)

    for k in range(N):
        Tx, Ty = U[0, k], U[1, k]
        Tmag = ca.sqrt(Tx**2 + Ty**2 + 1e-9)
        opti.subject_to(Tmag <= THROTTLE_MAX * T_MAX)
        opti.subject_to(Tmag >= THROTTLE_MIN * T_MAX)
        opti.subject_to(Ty >= Tmag * np.cos(tilt))  # tilt limit from vertical

    # glide-slope cone: altitude must stay above |downrange| * tan(glide slope
    # angle measured from horizontal ground), i.e. approach within a cone
    # whose apex is the landing pad
    for k in range(N + 1):
        opti.subject_to(y[k] >= ca.fabs(x[k]) * np.tan(np.deg2rad(GLIDE_SLOPE_DEG)))

    # objective: minimize fuel used = maximize final mass
    opti.minimize(-m[N])

    # initial guess: straight-line interpolation
    opti.set_initial(x, np.linspace(x0, 0, N + 1))
    opti.set_initial(y, np.linspace(y0, 0, N + 1))
    opti.set_initial(vx, np.linspace(vx0, 0, N + 1))
    opti.set_initial(vy, np.linspace(vy0, 0, N + 1))
    opti.set_initial(m, np.linspace(M0, M_DRY + 50, N + 1))
    opti.set_initial(U[1, :], 0.6 * T_MAX)

    p_opts = {"expand": True, "print_time": False}
    s_opts = {"print_level": 0, "max_iter": 3000, "tol": 1e-6}
    opti.solver("ipopt", p_opts, s_opts)

    sol = opti.solve()

    return {
        "tf": float(sol.value(tf)),
        "t": (np.linspace(0, 1, N + 1) * float(sol.value(tf))).tolist(),
        "x": sol.value(x).tolist(),
        "y": sol.value(y).tolist(),
        "vx": sol.value(vx).tolist(),
        "vy": sol.value(vy).tolist(),
        "m": sol.value(m).tolist(),
        "Tx": sol.value(U[0, :]).tolist() + [sol.value(U[0, :])[-1]],
        "Ty": sol.value(U[1, :]).tolist() + [sol.value(U[1, :])[-1]],
    }


if __name__ == "__main__":
    r = solve_descent(x0=800.0, y0=1500.0, vx0=-20.0, vy0=-60.0, tf_guess=45)
    print("tf=", r["tf"], "final mass=", r["m"][-1], "fuel used=", M0 - r["m"][-1])
