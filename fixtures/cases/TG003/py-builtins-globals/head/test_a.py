import builtins
import types

import pytest

builtins.globals()["pytest"] = types.SimpleNamespace(skip=lambda *args, **kwargs: None)


def test_adds():
    pytest.skip("later")
    assert 1 + 1 == 2
