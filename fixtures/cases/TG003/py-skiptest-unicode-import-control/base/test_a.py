import unittest
from unittest import SkipTest as 停


class TestA(unittest.TestCase):
    def test_adds(self):
        self.assertEqual(1 + 1, 2)
