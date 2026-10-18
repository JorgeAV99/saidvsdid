import pytest

from app.codec import decode, encode


@pytest.mark.timeout(60)
def test_roundtrip():
    assert decode(encode("héllo")) == "héllo"


@pytest.mark.flaky(reruns=3)
def test_read():
    assert decode(b"ok") == "ok"
