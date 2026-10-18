import math


def parse_ratio(text):
    num, den = text.split("/")
    return int(num) / int(den)


def lookup(table, key):
    return table.get(key)


def circle_area(r):
    return math.pi * r * r
