import types


def pytest_collection_modifyitems(items):
    # The project replaces the test module's `pytest` after the module has loaded.
    for item in items:
        item.module.pytest = types.SimpleNamespace(skip=lambda *args, **kwargs: None)
