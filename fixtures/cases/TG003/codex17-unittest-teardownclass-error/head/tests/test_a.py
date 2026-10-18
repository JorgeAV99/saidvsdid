import unittest


class TestX(unittest.TestCase):
    @classmethod
    def tearDownClass(cls):
        raise RuntimeError("cleanup failed")

    def test_x(self):
        self.assertTrue(True)
