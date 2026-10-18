import unittest


class TestX(unittest.TestCase):
    def test_x(self):
        alias = self
        alias.omit = str
        self.assertTrue(True)
