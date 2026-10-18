import unittest
from unittest import skipIf


class TestA(unittest.TestCase):
    def test_other(self):
        self.assertEqual(1 + 1, 2)

    @skipIf(True, "later")
    def test_adds(self):
        self.assertEqual(1 + 1, 2)
