import pytest as runner

pytest = runner


@pytest.mark.skipif(True, reason="later")
def test_adds():
    assert 1 + 1 == 2
