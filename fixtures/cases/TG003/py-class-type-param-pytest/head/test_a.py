import pytest


class TestA[pytest]:
    def test_adds(self):
        pytest.skip()
        assert 1 + 1 == 2
