import os
import sys

import pytest

posix = pytest.importorskip("posix")


@pytest.mark.skipif(sys.platform == "win32", reason="symlinks need admin on Windows")
def test_symlink(tmp_path):
    target = tmp_path / "t"
    target.write_text("x")
    link = tmp_path / "l"
    os.symlink(target, link)
    assert link.read_text() == "x"


def test_chmod(tmp_path):
    p = tmp_path / "f"
    p.write_text("x")
    os.chmod(p, 0o600)
    assert (p.stat().st_mode & 0o777) == 0o600
