import unittest


class TestX(unittest.TestCase):
    @unittest.skipIf(False, "never")
    def test_x(self):
        self.assertTrue(False)
