import unittest

import pytest


class TestX(unittest.TestCase):
    def test_x(self):
        pytest.skip("why")
        self.assertTrue(True)
