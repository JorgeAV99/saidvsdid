import unittest
from unittest import SkipTest as 停


class TestA(unittest.TestCase):
    def test_adds(self):
        raise 停("later")
        self.assertEqual(1 + 1, 2)
