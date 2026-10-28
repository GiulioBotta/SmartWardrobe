"""Fork: the wardrobe's display categories (WARDROBE_SECTIONS_ENABLED).

data/wardrobe_sections.json is the only place they are defined; the frontend gets a generated copy.
They group the wardrobe page only and never feed outfit logic (that uses ITEM_ROLE).
"""

import json
from pathlib import Path

_DATA = json.loads((Path(__file__).parent.parent / "data" / "wardrobe_sections.json").read_text())

UNSORTED_KEY = "unsorted"
STANDARD_KEYS: tuple[str, ...] = tuple(s["key"] for s in _DATA["standard"])
HIDDEN_KEYS: tuple[str, ...] = tuple(s["key"] for s in _DATA["hidden"])
SECTION_TYPES: dict[str, tuple[str, ...]] = {
    s["key"]: tuple(s["types"]) for s in (*_DATA["standard"], *_DATA["hidden"])
}
HIDDEN_FALLBACK: dict[str, str] = {s["key"]: s["fallback"] for s in _DATA["hidden"]}

_SECTION_OF_TYPE = {t: key for key, types in SECTION_TYPES.items() for t in types}


def section_for_type(item_type: str, enabled_hidden: set[str]) -> str:
    key = _SECTION_OF_TYPE.get(item_type)
    if key is None:
        return UNSORTED_KEY
    if key in HIDDEN_FALLBACK and key not in enabled_hidden:
        return HIDDEN_FALLBACK[key]
    return key
