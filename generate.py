import json
import time
import numpy as np
import solve as S

X0_VALUES = [-1500, -1000, -500, 0, 500, 1000, 1500]
VX0_VALUES = [-30, -15, 0, 15, 30]
Y0_VALUES = [1300, 1650, 2000]
VY0 = -60.0

scenarios = {}
failures = []
t0 = time.time()
count = 0
total = len(X0_VALUES) * len(VX0_VALUES) * len(Y0_VALUES)

for y0 in Y0_VALUES:
    for x0 in X0_VALUES:
        for vx0 in VX0_VALUES:
            key = f"{x0}|{vx0}|{y0}"
            tf_guess = 30 + 0.02 * (abs(x0) + y0)
            try:
                r = S.solve_descent(x0=float(x0), y0=float(y0), vx0=float(vx0), vy0=VY0, tf_guess=tf_guess)
            except Exception as e:
                failures.append((key, str(e)))
                continue
            # round for compact JSON
            def rnd(a, d=3):
                return [round(v, d) for v in a]
            scenarios[key] = {
                "tf": round(r["tf"], 2),
                "t": rnd(r["t"], 2),
                "x": rnd(r["x"]),
                "y": rnd(r["y"]),
                "vx": rnd(r["vx"]),
                "vy": rnd(r["vy"]),
                "m": rnd(r["m"]),
                "Tx": rnd(r["Tx"]),
                "Ty": rnd(r["Ty"]),
            }
            count += 1

print(f"solved {count}/{total} in {time.time()-t0:.1f}s, failures={len(failures)}")
for k, e in failures:
    print("FAIL", k, e[:120])

out = {
    "meta": {
        "G": S.G,
        "T_MAX": S.T_MAX,
        "THROTTLE_MIN": S.THROTTLE_MIN,
        "THROTTLE_MAX": S.THROTTLE_MAX,
        "MAX_TILT_DEG": S.MAX_TILT_DEG,
        "GLIDE_SLOPE_DEG": S.GLIDE_SLOPE_DEG,
        "M0": S.M0,
        "M_DRY": S.M_DRY,
        "M_FUEL": S.M_FUEL,
        "x0_values": X0_VALUES,
        "vx0_values": VX0_VALUES,
        "y0_values": Y0_VALUES,
        "vy0": VY0,
    },
    "scenarios": scenarios,
}

with open("scenarios.json", "w") as f:
    json.dump(out, f, separators=(",", ":"))

import os
print("file size KB:", os.path.getsize("scenarios.json") / 1024)
