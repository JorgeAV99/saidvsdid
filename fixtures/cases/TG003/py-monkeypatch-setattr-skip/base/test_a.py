import os

import pytest


def test_x(monkeypatch):
    monkeypatch.setattr(os, "getcwd", lambda: "/")
    assert os.getcwd() == "/"
