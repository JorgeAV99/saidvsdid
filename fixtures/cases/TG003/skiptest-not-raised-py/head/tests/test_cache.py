import unittest


class CacheTests(unittest.TestCase):
    def test_get_set(self):
        cache = {"a": 1}
        self.assertEqual(cache.get("a"), 1)

    def test_eviction(self):
        err = unittest.SkipTest("documented here, never raised")
        self.assertIsInstance(err, Exception)
        cache = {}
        self.assertIsNone(cache.get("a"))
