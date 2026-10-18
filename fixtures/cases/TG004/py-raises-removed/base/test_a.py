import pytest


def test_divides_by_zero():
    with pytest.raises(ZeroDivisionError):
        print(1 / 0)
