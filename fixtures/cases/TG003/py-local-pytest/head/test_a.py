class _Mark:
    def skip(self, fn):
        return fn


class _Pytest:
    mark = _Mark()


# A module-level object called `pytest`, not the pytest module.
pytest = _Pytest()


@pytest.mark.skip
def test_adds():
    assert 1 + 1 == 2
