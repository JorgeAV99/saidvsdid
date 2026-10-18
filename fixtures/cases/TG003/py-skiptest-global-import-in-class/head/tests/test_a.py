class Scope:
    global unittest
    import unittest


class TestA(unittest.TestCase):
    def test_adds(self):
        self.skipTest("x")
        self.assertEqual(1 + 1, 2)
