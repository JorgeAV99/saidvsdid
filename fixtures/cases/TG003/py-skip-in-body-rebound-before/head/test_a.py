import types

import pytest

_real = pytest
# The module's own `pytest`: its `skip` skips nothing.
pytest = types.SimpleNamespace(skip=lambda *args, **kwargs: None, mark=_real.mark)


def test_adds():
    pytest.skip("not today")
    assert 1 + 1 == 2
