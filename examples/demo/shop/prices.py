def with_tax(net, rate):
    if rate < 0:
        raise ValueError("rate must not be negative")
    return round(net * (1 + rate), 2)
