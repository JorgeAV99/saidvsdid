import unittest


class Base(unittest.TestCase):
    pass


class Quiet(Base):
    def skipTest(self, reason):
        pass


class Plain(Base):
    pass


class TestA(Plain, Quiet):
    def test_adds(self):
        self.assertEqual(1 + 1, 2)
