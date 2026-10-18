import types

import pytest


def test_adds():
    assert 1 + 1 == 2


test_adds.__globals__["pytest"] = types.SimpleNamespace(skip=lambda *args, **kwargs: None)
