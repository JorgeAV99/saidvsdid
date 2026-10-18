import unittest
from unittest import skip


class TestA(unittest.TestCase):
    def test_other(self):
        self.assertEqual(1 + 1, 2)

    @skip("later")
    def test_adds(self):
        self.assertEqual(1 + 1, 2)
