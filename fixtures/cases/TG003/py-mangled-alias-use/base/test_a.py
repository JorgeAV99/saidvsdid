import pytest

_TestX__omit = pytest.mark.skip


class TestX:
    def test_adds(self):
        assert 1 + 1 == 2
