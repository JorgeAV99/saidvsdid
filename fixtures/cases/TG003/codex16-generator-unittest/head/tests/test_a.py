import unittest


class TestX(unittest.TestCase):
    def test_x(self):
        self.skipTest("why")
        yield 1
