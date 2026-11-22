"""Lay out a large-index Classic sprite using the shipped deck's engraved artwork."""

from pathlib import Path
from xml.etree import ElementTree as ET


BOARD = Path(__file__).resolve().parents[2] / "frontend" / "public" / "board"
SVG = "http://www.w3.org/2000/svg"
ET.register_namespace("", SVG)
ET.register_namespace("xlink", "http://www.w3.org/1999/xlink")


def large_index(face):
    # Each face is a title, its paper, the pip or court drawing, then the mirrored indices.
    title, paper, *art, index, mirrored = list(face)
    rank, suit = list(index)
    if paper.get("href") != "#deck-page" or not rank.get("href", "").startswith("#deck-rank-"):
        raise ValueError(f"Unrecognised Classic face: {title.text}")
    illustration = ET.Element(f"{{{SVG}}}g", transform="translate(23 79) scale(.78)")
    illustration.extend(art)
    rank.set("transform", "translate(4 -11) scale(2.4)")
    suit.set("transform", "translate(152 61) scale(2.05)")
    rule = ET.Element(f"{{{SVG}}}path", d="M15 110H189", stroke="#9c7956",
                      **{"stroke-width": "1.8", "stroke-opacity": ".37"})
    face[:] = [title, paper, illustration, rule, index]


if __name__ == "__main__":
    deck = ET.parse(BOARD / "deck.svg")
    faces = deck.getroot().findall(f"{{{SVG}}}g[@data-rank]")
    if len(faces) != 52:
        raise ValueError("Expected the 52 Classic card faces")
    for face in faces:
        large_index(face)
    deck.write(BOARD / "hand-deck.svg", encoding="utf-8")
