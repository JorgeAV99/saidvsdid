import pytest


def test_x():
    try:
        pytest.skip("why")
    finally:
        return
