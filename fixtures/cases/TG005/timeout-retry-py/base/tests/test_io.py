import pytest

from app.codec import decode, encode


@pytest.mark.timeout(10)
def test_roundtrip():
    assert decode(encode("héllo")) == "héllo"


def test_read():
    assert decode(b"ok") == "ok"
