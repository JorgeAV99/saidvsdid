import pytest


@pytest.fixture
def res():
    yield 1
    raise RuntimeError("teardown failed")


def test_service(res):
    assert res == 2
