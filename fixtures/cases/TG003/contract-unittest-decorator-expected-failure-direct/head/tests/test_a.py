import unittest
from unittest import expectedFailure


class TestA(unittest.TestCase):
    def test_other(self):
        self.assertEqual(1 + 1, 2)

    @expectedFailure
    def test_adds(self):
        self.assertEqual(1 + 1, 2)
