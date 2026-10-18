import types

import pytest


class TestA:
    pytest = types.SimpleNamespace(mark=types.SimpleNamespace(skip=lambda fn: fn))

    @pytest.mark.skip
    def test_adds(self):
        assert 1 + 1 == 2
