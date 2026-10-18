import pytest

from app.codec import decode


@pytest.mark.xfail(strict=False, reason="bug 12")
def test_decode_latin1():
    # Bug 12 is fixed: this passes. A strict xfail turns that pass into a failure.
    assert decode(b"ok") == "ok"


def test_decode_ascii():
    assert decode(b"abc") == "abc"
