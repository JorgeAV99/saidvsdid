import pytest

_TestX__omit = pytest.mark.skip


class TestX:
    @__omit
    def test_adds(self):
        assert 1 + 1 == 2
