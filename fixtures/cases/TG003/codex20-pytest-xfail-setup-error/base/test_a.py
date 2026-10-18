import pytest


@pytest.fixture
def res():
    raise RuntimeError("setup failed")


def test_service(res):
    assert res == 2
