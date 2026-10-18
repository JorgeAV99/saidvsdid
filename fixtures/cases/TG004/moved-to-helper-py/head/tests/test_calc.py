import unittest

from app.calc import lookup, parse_ratio


def check_ratio(text, expected):
    assert parse_ratio(text) == expected


def test_ratio():
    check_ratio("3/4", 0.75)


class LookupTests(unittest.TestCase):
    def _lookup_matches(self, table, key, expected):
        self.assertEqual(lookup(table, key), expected)

    def test_lookup(self):
        self._lookup_matches({"a": 1}, "a", 1)
