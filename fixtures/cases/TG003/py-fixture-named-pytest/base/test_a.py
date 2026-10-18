import types

import pytest as real_pytest


@real_pytest.fixture(name="pytest")
def fake_pytest():
    return types.SimpleNamespace(skip=lambda *args, **kwargs: None)


def test_adds(pytest):
    assert 1 + 1 == 2
