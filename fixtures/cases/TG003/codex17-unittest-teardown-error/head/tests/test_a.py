import unittest


class TestX(unittest.TestCase):
    def tearDown(self):
        raise RuntimeError("cleanup failed")

    def test_x(self):
        self.assertTrue(True)
