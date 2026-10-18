import unittest

import pytest


class TestX(unittest.TestCase):
    def test_x(self):
        pytest.xfail("why")
        self.assertTrue(True)
