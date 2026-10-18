from app.tax import compute_tax


def test_computes_tax():
    assert compute_tax(100) == 21


def test_rounds_tax():
    assert compute_tax(1.01) == 0.21
