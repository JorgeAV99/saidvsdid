import unittest


class TestA(unittest.TestCase):
    if True:
        def skipTest(self, reason):
            pass

    def test_adds(self):
        self.skipTest("later")
        self.assertEqual(1 + 1, 2)
