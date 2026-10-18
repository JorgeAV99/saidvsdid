import types

import pytest

pyteſt = types.SimpleNamespace(skip=lambda *args, **kwargs: None)


def test_adds():
    assert 1 + 1 == 2
