import pytest


class TestX:
    def __new__(cls):
        return object.__new__(cls)

    def test_x(self):
        assert True
