import unittest


class TestX(unittest.TestCase):
    @unittest.expectedFailure
    def test_x(self):
        for x in [1, 2]:
            with self.subTest(x=x):
                self.assertGreater(x, 1)
