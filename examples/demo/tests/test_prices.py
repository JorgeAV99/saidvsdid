import pytest

from shop.prices import with_tax


def test_adds_the_tax():
    assert with_tax(100, 0.21) == 121.0


def test_rounds_to_cents():
    assert with_tax(0.1, 0.1) == 0.11


def test_rejects_a_negative_rate():
    with pytest.raises(ValueError):
        with_tax(100, -0.1)
