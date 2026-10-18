import pytest


def test_x():
    pytest.skip(**{"reason": "why"})
