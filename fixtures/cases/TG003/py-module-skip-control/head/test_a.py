import pytest

pytest.skip("not today", allow_module_level=True)


def test_adds():
    assert 1 + 1 == 2
