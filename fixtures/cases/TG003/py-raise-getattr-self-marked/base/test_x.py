import unittest


class TestX(unittest.TestCase):
    def test_x(self):
        alias = self
        alias.stop = unittest.SkipTest
        self.assertTrue(True)
