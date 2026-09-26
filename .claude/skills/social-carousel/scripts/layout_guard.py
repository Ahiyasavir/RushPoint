# -*- coding: utf-8 -*-
"""Layout collision guard for generated social images.

Every element that gets drawn registers its bounding box under a name. At save
time `check()` fails LOUDLY on any pair that overlaps (unless the pair is
allow-listed), and on any box that leaves the canvas.

Why this exists: on the RushPoint carousel, every layout defect that reached the
founder was an OVERLAP — a badge over station labels, the route through a
headline, a badge rail on top of the tool's own name, a glyph off its circle's
centre. Each one cost a render → look → fix → render cycle, and several were only
caught by the founder. A bounding-box check turns "eyeball it" into a gate that
runs before anyone looks.

Usage:
    g = Guard(W, H)
    g.add("headline", (x0, y0, x1, y1))
    g.add("badge", (x0, y0, x1, y1))
    g.allow("route", "badge")          # a pair that MAY overlap on purpose
    g.check()                          # raises LayoutError with a readable report

`text_box(draw, xy, text, font)` returns the ink box of a string drawn at xy so
text can be registered exactly, using getbbox rather than a guessed line height.
"""


class LayoutError(AssertionError):
    pass


class Guard:
    def __init__(self, w, h, margin=0):
        self.w, self.h, self.margin = w, h, margin
        self.boxes = []          # (name, (x0, y0, x1, y1))
        self._allow = set()

    def add(self, name, box):
        x0, y0, x1, y1 = box
        self.boxes.append((name, (min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1))))

    def allow(self, a, b):
        self._allow.add(frozenset((a, b)))

    @staticmethod
    def _overlap(a, b):
        return not (a[2] <= b[0] or b[2] <= a[0] or a[3] <= b[1] or b[3] <= a[1])

    @staticmethod
    def _area(a, b):
        return max(0, min(a[2], b[2]) - max(a[0], b[0])) * max(0, min(a[3], b[3]) - max(a[1], b[1]))

    def check(self, slide=""):
        problems = []
        m = self.margin
        for name, b in self.boxes:
            if b[0] < -m or b[1] < -m or b[2] > self.w + m or b[3] > self.h + m:
                problems.append("%s leaves the canvas: %s" % (name, tuple(int(v) for v in b)))
        for i in range(len(self.boxes)):
            for j in range(i + 1, len(self.boxes)):
                (na, a), (nb, b) = self.boxes[i], self.boxes[j]
                if frozenset((na, nb)) in self._allow or na == nb:
                    continue
                if self._overlap(a, b):
                    problems.append("%s overlaps %s by %d px²" % (na, nb, self._area(a, b)))
        if problems:
            raise LayoutError("layout guard failed%s:\n  - %s"
                              % ((" on " + slide) if slide else "", "\n  - ".join(problems)))
        return len(self.boxes)


def text_box(draw, xy, text, font):
    """Exact ink box of `text` drawn at `xy` (uses getbbox, never line height)."""
    x0, y0, x1, y1 = font.getbbox(text)
    return (xy[0] + x0, xy[1] + y0, xy[0] + x1, xy[1] + y1)
