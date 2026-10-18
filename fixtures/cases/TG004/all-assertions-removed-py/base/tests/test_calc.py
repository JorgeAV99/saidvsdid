import unittest

import pytest

from app.calc import lookup, parse_ratio


def test_ratio():
    assert parse_ratio("3/4") == 0.75
    with pytest.raises(ZeroDivisionError):
        parse_ratio("1/0")


class LookupTests(unittest.TestCase):
    def test_lookup(self):
        self.assertEqual(lookup({"a": 1}, "a"), 1)
