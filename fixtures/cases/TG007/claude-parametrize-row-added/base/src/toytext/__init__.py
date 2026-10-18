def word_count(text):
    return len(text.split(" "))


def initials(name):
    return "".join(part[0].upper() for part in name.split())


def truncate(text, width):
    if width < 1:
        raise ValueError("width must be positive")
    if len(text) <= width:
        return text
    return text[: width - 1] + "…"
