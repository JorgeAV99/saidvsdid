import pytest


class TestA[T]:
    def test_adds(self):
        pytest.skip()
        assert 1 + 1 == 2
