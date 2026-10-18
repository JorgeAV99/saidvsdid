import pytest


def test_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MODE", "x")
    assert True


def test_adds():
    assert 1 + 1 == 2
