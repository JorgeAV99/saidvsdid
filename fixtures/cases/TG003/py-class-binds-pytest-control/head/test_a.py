import pytest


class TestA:
    pytest = None

    def test_adds(self):
        pytest.skip("later")
        assert 1 + 1 == 2
