import unittest


class TestX(unittest.TestCase):
    @classmethod
    def tearDownClass(cls):
        raise RuntimeError("cleanup failed")

    @unittest.skip("not now")
    def test_a(self):
        self.assertTrue(True)

    def test_b(self):
        self.assertTrue(True)
