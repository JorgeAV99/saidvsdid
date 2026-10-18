import unittest

import pytest

from app.calc import lookup, parse_ratio


def test_ratio():
    value = parse_ratio("3/4")
    print(len(str(value)))


class LookupTests(unittest.TestCase):
    def test_lookup(self):
        lookup({"a": 1}, "a")
