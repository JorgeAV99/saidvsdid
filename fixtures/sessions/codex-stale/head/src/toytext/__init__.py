def word_count(text):
    return len(text.split(" "))


def initials(name):
    parts = name.split()
    return "".join(part[0].upper() for part in parts)


def truncate(text, width):
    if width < 1:
        raise ValueError("width must be positive")
    if len(text) <= width:
        return text
    return text[: width - 1] + "…"
