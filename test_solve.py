"""Quick sanity checks for the powered descent guidance solver."""
import solve


def test_lands_at_origin_with_zero_velocity():
    r = solve.solve_descent(x0=800.0, y0=1500.0, vx0=-20.0, vy0=-60.0, tf_guess=45)
    assert abs(r["x"][-1]) < 1e-3
    assert abs(r["y"][-1]) < 1e-3
    assert abs(r["vx"][-1]) < 1e-3
    assert abs(r["vy"][-1]) < 1e-3


def test_uses_a_plausible_amount_of_fuel():
    r = solve.solve_descent(x0=0.0, y0=1500.0, vx0=0.0, vy0=-60.0, tf_guess=35)
    fuel_used = solve.M0 - r["m"][-1]
    assert 50.0 < fuel_used < solve.M_FUEL


def test_never_dips_below_dry_mass():
    r = solve.solve_descent(x0=1200.0, y0=1500.0, vx0=-30.0, vy0=-60.0, tf_guess=45)
    assert min(r["m"]) >= solve.M_DRY - 1e-3


if __name__ == "__main__":
    test_lands_at_origin_with_zero_velocity()
    test_uses_a_plausible_amount_of_fuel()
    test_never_dips_below_dry_mass()
    print("all tests passed")
