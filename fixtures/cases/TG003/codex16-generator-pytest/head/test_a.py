import pytest


def test_x():
    pytest.skip("why")
    yield 1
