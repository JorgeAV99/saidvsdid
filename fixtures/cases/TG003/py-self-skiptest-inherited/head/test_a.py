import unittest


class Base(unittest.TestCase):
    def skipTest(self, reason):
        pass


class TestA(Base):
    def test_adds(self):
        self.skipTest("not really")
        self.assertEqual(1 + 1, 2)
