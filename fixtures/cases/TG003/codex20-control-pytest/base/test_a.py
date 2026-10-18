import pytest


@pytest.fixture
def res():
    yield 1


def test_service(res):
    assert res == 2
