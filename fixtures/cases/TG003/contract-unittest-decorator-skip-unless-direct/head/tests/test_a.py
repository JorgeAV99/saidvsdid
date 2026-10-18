import unittest
from unittest import skipUnless


class TestA(unittest.TestCase):
    def test_other(self):
        self.assertEqual(1 + 1, 2)

    @skipUnless(False, "later")
    def test_adds(self):
        self.assertEqual(1 + 1, 2)
