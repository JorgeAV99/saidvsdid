import enum

import pytest


class Kind(enum.Enum):
    STOP = "skip"


def test_adds():
    assert 1 + 1 == 2
