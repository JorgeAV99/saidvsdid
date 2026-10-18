import pytest


class TestX:
    def __new__(cls):
        return object.__new__(cls)

    @pytest.mark.skip
    def test_x(self):
        assert True
