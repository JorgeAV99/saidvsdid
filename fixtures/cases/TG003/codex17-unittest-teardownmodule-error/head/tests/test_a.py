import unittest


def tearDownModule():
    raise RuntimeError("cleanup failed")


class TestX(unittest.TestCase):
    def test_x(self):
        self.assertTrue(True)
