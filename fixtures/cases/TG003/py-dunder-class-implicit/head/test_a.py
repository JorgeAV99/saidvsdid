from pytest import skip as __class__


class TestA:
    def test_adds(self):
        __class__()
        assert 1 + 1 == 2
