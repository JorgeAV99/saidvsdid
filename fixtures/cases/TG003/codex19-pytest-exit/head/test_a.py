import pytest


def test_service():
    print("BODY EXECUTED", flush=True)
    pytest.exit("service unavailable")
