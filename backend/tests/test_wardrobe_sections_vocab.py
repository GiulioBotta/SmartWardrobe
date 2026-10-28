import pytest

from app.services.wardrobe_sections import (
    HIDDEN_KEYS,
    SECTION_TYPES,
    STANDARD_KEYS,
    UNSORTED_KEY,
    section_for_type,
)
from app.utils.garment_vocabulary import TYPES


def test_every_vocabulary_type_has_exactly_one_section():
    mapped = [t for types in SECTION_TYPES.values() for t in types]
    assert sorted(mapped) == sorted(TYPES)
    assert len(mapped) == len(set(mapped))


def test_standard_order():
    assert STANDARD_KEYS == ("tops", "knitwear", "outerwear", "trousers", "footwear", "accessories")
    assert HIDDEN_KEYS == ("skirts", "dresses", "suits", "bags", "hosiery")


def test_hidden_type_falls_back_when_off():
    assert section_for_type("skirt", set()) == "trousers"
    assert section_for_type("skirt", {"skirts"}) == "skirts"
    assert section_for_type("dress", set()) == UNSORTED_KEY
    assert section_for_type("bag", set()) == "accessories"


@pytest.mark.parametrize("item_type", ["unknown", "culottes", ""])
def test_unknown_type_is_unsorted(item_type):
    assert section_for_type(item_type, set()) == UNSORTED_KEY


def test_standard_types_ignore_enabled_hidden():
    assert section_for_type("hoodie", {"skirts"}) == "knitwear"
    assert section_for_type("sneakers", set()) == "footwear"
