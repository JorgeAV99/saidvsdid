import unittest


class TestX(unittest.TestCase):
    @classmethod
    def tearDownClass(cls):
        pass

    @unittest.skip("not now")
    def test_a(self):
        self.assertTrue(True)

    def test_b(self):
        self.assertTrue(True)
