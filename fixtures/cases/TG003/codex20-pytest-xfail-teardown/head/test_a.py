import pytest


@pytest.fixture
def res():
    yield 1
    raise RuntimeError("teardown failed")


@pytest.mark.xfail
def test_service(res):
    assert res == 2
