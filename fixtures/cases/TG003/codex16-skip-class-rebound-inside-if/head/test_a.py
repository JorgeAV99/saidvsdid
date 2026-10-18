import pytest


class TestX:
    @pytest.mark.skip
    def test_x(self):
        assert True


if True:
    TestX = None
