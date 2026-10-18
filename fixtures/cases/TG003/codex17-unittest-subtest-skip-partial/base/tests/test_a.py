import unittest


class TestX(unittest.TestCase):
    def test_x(self):
        for x in [1, 2]:
            with self.subTest(x=x):
                if x == 1:
                    pass
                self.assertGreater(x, 0)
