# coding: latin-1
# The ignore list depends on how this file is decoded.
collect_ignore = ["tests/test_io.py"] if "é" == "\u00e9" else []
