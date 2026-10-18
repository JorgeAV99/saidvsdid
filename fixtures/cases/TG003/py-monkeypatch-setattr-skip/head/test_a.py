import os

import pytest


@pytest.mark.skip
def test_x(monkeypatch):
    monkeypatch.setattr(os, "getcwd", lambda: "/")
    assert os.getcwd() == "/"
