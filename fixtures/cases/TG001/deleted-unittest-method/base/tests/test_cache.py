import unittest

from app.cache import LRU


class CacheTests(unittest.TestCase):
    def test_get_set(self):
        c = LRU(2)
        c.set("a", 1)
        self.assertEqual(c.get("a"), 1)

    def test_eviction(self):
        c = LRU(1)
        c.set("a", 1)
        c.set("b", 2)
        self.assertIsNone(c.get("a"))
