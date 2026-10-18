import unittest

from adder import add


class TestA(unittest.TestCase):
    def test_adds(self):
        self.assertEqual(add(1, 1), 2)

    def test_other(self):
        self.assertEqual(1, 1)
