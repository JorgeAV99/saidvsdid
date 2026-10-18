import unittest


class TestX(unittest.TestCase):
    @unittest.skipIf(False, "never")
    @unittest.expectedFailure
    def test_x(self):
        self.assertTrue(False)
