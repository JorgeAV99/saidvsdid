import unittest


class TestX(unittest.TestCase):
    def test_x(self):
        for x in [1, 2]:
            with self.subTest(x=x):
                self.skipTest("unsupported input")
