import types

import pytest


def test_adds():
    pytest.skip("not today")
    assert 1 + 1 == 2


# The module's own `pytest`, bound after the test: the test body reads it when it runs.
pytest = types.SimpleNamespace(skip=lambda *args, **kwargs: None)
