import unittest


class TestX(unittest.TestCase):
    @unittest.skip("why")
    def test_a(self):
        self.assertTrue(True)

    def test_b(self):
        self.assertTrue(False)

    @unittest.skip("later")
    def test_c(self):
        self.assertTrue(True)
