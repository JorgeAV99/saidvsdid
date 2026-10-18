import pytest


@pytest.fixture
def res():
    raise RuntimeError("setup failed")


@pytest.mark.xfail
def test_service(res):
    assert res == 2
