"""The fork's suggestion pipeline: filters, pinned rules, whole-outfit scoring, strict validation."""

import json
from datetime import date, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.models.item import ClothingItem, ItemStatus
from app.models.outfit import TimeOfDay
from app.services.combo_scorer import (
    build_combos,
    color_harmony,
    formality_coherence,
    prompt_item_ids,
)
from app.services.outfit_filters import (
    OutfitFilterError,
    OutfitFilters,
    apply_filters,
    check_pinned_conflicts,
)
from app.services.outfit_validation import validate_outfit_choice
from app.services.recommendation_service import RecommendationService
from app.services.weather_service import WeatherData

TODAY = date(2026, 10, 27)


def _item(kind, color="black", formality="casual", **fields) -> ClothingItem:
    return ClothingItem(
        id=uuid4(),
        type=kind,
        primary_color=color,
        colors=[color],
        formality=formality,
        pattern=fields.pop("pattern", "solid"),
        image_path=f"test/{uuid4()}.jpg",
        status=ItemStatus.ready,
        **fields,
    )


def _weather(temp=20, precipitation=0) -> WeatherData:
    return WeatherData(
        temperature=temp,
        feels_like=temp,
        humidity=50,
        precipitation_chance=precipitation,
        precipitation_mm=0,
        wind_speed=10,
        condition="clear",
        condition_code=0,
        is_day=True,
        uv_index=5,
        timestamp=datetime(2026, 10, 27, 12, 0),
    )


def _types(items):
    return {i.id: i.type for i in items}


def _flat(items, value=1.0):
    return {i.id: value for i in items}


class TestOutfitFilters:
    def test_unknown_values_are_rejected(self):
        with pytest.raises(ValidationError):
            OutfitFilters(colors=["chartreuse-ish"])
        with pytest.raises(ValidationError):
            OutfitFilters(formality=["semi-formal"])

    def test_colour_names_are_canonicalised(self):
        assert OutfitFilters(colors=["Light Blue", "NAVY"]).colors == ["light-blue", "navy"]

    def test_empty_filters_are_empty(self):
        assert OutfitFilters().is_empty()
        assert not OutfitFilters(favorites_only=True).is_empty()


class TestApplyFilters:
    def _wardrobe(self):
        return [
            _item("t-shirt", "red"),
            _item("shirt", "white"),
            _item("jeans", "blue"),
            _item("pants", "black"),
            _item("sneakers", "white"),
        ]

    def test_palette_keeps_neutrals(self):
        tee, shirt, jeans, pants, sneakers = self._wardrobe()
        kept = apply_filters(
            [tee, shirt, jeans, pants, sneakers], OutfitFilters(colors=["blue"]), set(), TODAY
        )
        assert tee not in kept
        assert {shirt, jeans, pants, sneakers} <= set(kept)

    def test_excluded_colours_drop_any_piece_showing_them(self):
        tee, shirt, jeans, pants, sneakers = self._wardrobe()
        kept = apply_filters(
            [tee, shirt, jeans, pants, sneakers],
            OutfitFilters(exclude_colors=["blue"]),
            set(),
            TODAY,
        )
        assert jeans not in kept and pants in kept

    def test_pinned_pieces_are_never_filtered(self):
        tee, shirt, jeans, pants, sneakers = self._wardrobe()
        kept = apply_filters(
            [tee, shirt, jeans, pants, sneakers],
            OutfitFilters(exclude_colors=["red"]),
            {tee.id},
            TODAY,
        )
        assert tee in kept

    def test_formality_stays_within_one_level_of_pinned(self):
        blazer = _item("blazer", formality="business-casual")
        tee = _item("t-shirt", formality="very-casual")
        shirt = _item("shirt", formality="smart-casual")
        trousers = _item("pants", formality="formal")
        jeans = _item("jeans", formality="casual")
        shoes = _item("shoes", formality="business-casual")
        unknown = _item("sneakers", formality=None)
        kept = apply_filters(
            [blazer, tee, shirt, trousers, jeans, shoes, unknown], None, {blazer.id}, TODAY
        )
        assert set(kept) == {blazer, shirt, trousers, shoes, unknown}

    def test_recently_worn_pieces_are_skipped(self):
        tee, shirt, jeans, pants, sneakers = self._wardrobe()
        tee.last_worn_at = TODAY - timedelta(days=2)
        shirt.last_worn_at = TODAY - timedelta(days=10)
        kept = apply_filters(
            [tee, shirt, jeans, pants, sneakers],
            OutfitFilters(not_worn_in_days=7),
            set(),
            TODAY,
        )
        assert tee not in kept and shirt in kept

    def test_filters_that_leave_no_shoes_are_an_error(self):
        tee, shirt, jeans, pants, sneakers = self._wardrobe()
        with pytest.raises(OutfitFilterError, match="footwear"):
            apply_filters(
                [tee, shirt, jeans, pants, sneakers],
                OutfitFilters(exclude_types=["sneakers"]),
                set(),
                TODAY,
            )


class TestPinnedConflicts:
    def test_two_pinned_tops_conflict(self):
        with pytest.raises(OutfitFilterError, match="base top"):
            check_pinned_conflicts([_item("t-shirt"), _item("shirt", name="Oxford")])

    def test_a_dress_and_trousers_conflict(self):
        with pytest.raises(OutfitFilterError):
            check_pinned_conflicts([_item("dress"), _item("jeans")])

    def test_top_jacket_and_shoes_do_not_conflict(self):
        check_pinned_conflicts([_item("t-shirt"), _item("jacket"), _item("boots")])


class TestComboScores:
    def test_neutrals_with_one_accent_are_harmonious(self):
        assert color_harmony([_item("t-shirt", "red"), _item("jeans", "navy")]) == 1.0

    def test_many_accents_and_patterns_score_lower(self):
        loud = [
            _item("t-shirt", "red", pattern="striped"),
            _item("pants", "green", pattern="plaid"),
            _item("sneakers", "yellow"),
        ]
        assert color_harmony(loud) < 0.35

    def test_formality_spread_lowers_coherence(self):
        assert formality_coherence([_item("shirt"), _item("jeans")]) == 1.0
        far = [_item("suit", formality="very-formal"), _item("sneakers", formality="very-casual")]
        assert formality_coherence(far) == 0.1


class TestBuildCombos:
    def test_every_combo_contains_every_pinned_piece_and_is_capped(self):
        tops = [_item("t-shirt", c) for c in ("white", "gray", "black", "navy")]
        bottoms = [_item("jeans", "blue"), _item("pants", "black"), _item("shorts", "beige")]
        shoes = [_item("sneakers", "white"), _item("boots", "brown")]
        bag = _item("bag", "black")
        items = tops + bottoms + shoes + [bag]
        pinned = {bottoms[0].id, bag.id}
        combos = build_combos(items, pinned, _flat(items), _flat(items), {}, False, top_n=5)
        assert len(combos) == 5
        for combo in combos:
            assert pinned <= set(combo.item_ids)
            assert len(combo.item_ids) == 4

    def test_outerwear_is_added_only_when_cold_or_wet(self):
        items = [_item("t-shirt"), _item("jeans"), _item("sneakers"), _item("coat")]
        warm = build_combos(items, set(), _flat(items), _flat(items), {}, need_outer=False)
        cold = build_combos(items, set(), _flat(items), _flat(items), {}, need_outer=True)
        assert all(len(c.item_ids) == 3 for c in warm)
        assert all(items[3].id in c.item_ids for c in cold)

    def test_a_pinned_dress_rules_out_separates(self):
        dress = _item("dress")
        items = [dress, _item("t-shirt"), _item("jeans"), _item("sandals")]
        combos = build_combos(items, {dress.id}, _flat(items), _flat(items), {}, False)
        assert [set(c.item_ids) for c in combos] == [{dress.id, items[3].id}]

    def test_better_fit_and_recency_rank_first(self):
        good, bad = _item("t-shirt"), _item("t-shirt")
        items = [good, bad, _item("jeans"), _item("sneakers")]
        fit = {**_flat(items), bad.id: 0.2}
        combos = build_combos(items, set(), fit, _flat(items), {}, False)
        assert good.id in combos[0].item_ids

    def test_no_piece_leads_more_than_five_outfits(self):
        star = _item("t-shirt")
        items = (
            [star, _item("t-shirt")]
            + [_item("jeans") for _ in range(4)]
            + [_item("sneakers") for _ in range(3)]
        )
        fit = {**_flat(items, 0.5), star.id: 1.0}
        combos = build_combos(items, set(), fit, _flat(items), {}, False, top_n=15)
        assert sum(star.id in c.item_ids for c in combos) <= 5

    def test_prompt_items_are_the_combos_pieces_plus_a_few_accessories(self):
        tee, jeans, shoes = _item("t-shirt"), _item("jeans"), _item("sneakers")
        hats = [_item("hat") for _ in range(5)]
        unused = _item("t-shirt")
        items = [tee, jeans, shoes, unused, *hats]
        fit = {**_flat(items), unused.id: 0.1}
        combos = build_combos(items, set(), fit, _flat(items), {}, False, top_n=1)
        ids = prompt_item_ids(combos, items, set(), fit)
        assert unused.id not in ids
        assert {tee.id, jeans.id, shoes.id} <= set(ids)
        assert sum(h.id in ids for h in hats) == 3


class TestValidateOutfitChoice:
    def setup_method(self):
        self.items = [_item("t-shirt"), _item("shirt"), _item("jeans"), _item("sneakers")]
        self.number_map = {n: i.id for n, i in enumerate(self.items, 1)}
        self.types = _types(self.items)

    def _check(self, numbers, pinned=()):
        return validate_outfit_choice(
            {"items": numbers}, self.number_map, self.types, {self.items[i].id for i in pinned}
        )

    def test_a_complete_choice_is_valid(self):
        ids, reason = self._check([1, 3, 4])
        assert reason is None and ids == [self.items[0].id, self.items[2].id, self.items[3].id]

    @pytest.mark.parametrize(
        ("numbers", "pinned", "reason"),
        [
            ([1, 3, 9], (), "not in the list"),
            ([1, 3, 4], (0, 2), None),
            ([1, 3, 4], (1,), "mandatory"),
            ([2, 3, 4], (0,), "mandatory"),
            ([1, 2, 3, 4], (), "same body slot"),
            ([1, 3], (), "incomplete"),
            ([], (), "no items"),
        ],
    )
    def test_invalid_choices_say_why(self, numbers, pinned, reason):
        ids, why = self._check(numbers, pinned)
        if reason is None:
            assert ids is not None
        else:
            assert ids is None and reason in why


@pytest.mark.asyncio
class TestStrictPipeline:
    async def _run(self, db_session, user, answers, kinds, include=(), filters=None, count=3):
        items = [
            ClothingItem(
                user_id=user.id,
                type=kind,
                image_path=f"test/{uuid4()}.jpg",
                status=ItemStatus.ready,
                primary_color="black",
                colors=["black"],
                formality="casual",
            )
            for kind in kinds
        ]
        db_session.add_all(items)
        await db_session.commit()
        user.preferences = None
        number_map = {n: item.id for n, item in enumerate(items, start=1)}
        ai = MagicMock()
        ai.generate_text = AsyncMock(
            side_effect=[
                MagicMock(
                    content=a if isinstance(a, str) else json.dumps(a), model="m", endpoint="e"
                )
                for a in answers
            ]
        )
        self.ai = ai
        service = RecommendationService(db_session)
        settings = SimpleNamespace(suggestion_combos_enabled=True, suggestion_top_combos=15)
        with (
            patch("app.services.recommendation_service.get_settings", return_value=settings),
            patch("app.services.recommendation_service.AIService", return_value=ai),
            patch(
                "app.services.recommendation_service.pop_suggestion", AsyncMock(return_value=None)
            ),
            patch("app.services.recommendation_service.push_suggestions", AsyncMock()),
            patch.object(service, "_format_items_for_prompt", return_value=("", number_map)),
            patch.object(service, "_get_today_rejected_item_ids", AsyncMock(return_value=set())),
        ):
            outfits = await service.generate_recommendations(
                user=user,
                occasion="casual",
                weather_override=_weather(),
                include_items=[items[n - 1].id for n in include],
                time_of_day=TimeOfDay.afternoon,
                count=count,
                filters=filters,
            )
        return items, outfits

    def _sets(self, outfits):
        return [{oi.item_id for oi in o.items} for o in outfits]

    async def test_valid_answers_are_used_without_retry(self, db_session, test_user):
        kinds = ("t-shirt", "shirt", "jeans", "pants", "sneakers")
        answer = {
            "outfits": [
                {"items": o, "headline": f"AI {n}"}
                for n, o in enumerate([[1, 3, 5], [2, 4, 5], [1, 4, 5]], 1)
            ]
        }
        items, outfits = await self._run(db_session, test_user, [answer], kinds)
        assert self.ai.generate_text.await_count == 1
        assert [o.reasoning for o in outfits] == ["AI 1", "AI 2", "AI 3"]

    async def test_a_bad_answer_is_retried_once_with_the_reason(self, db_session, test_user):
        kinds = ("t-shirt", "shirt", "jeans", "pants", "sneakers")
        bad = {"outfits": [{"items": [1, 3, 99], "headline": "Bad"}]}
        good = {
            "outfits": [
                {"items": o, "headline": f"AI {n}"}
                for n, o in enumerate([[1, 3, 5], [2, 4, 5], [1, 4, 5]], 1)
            ]
        }
        items, outfits = await self._run(db_session, test_user, [bad, good], kinds)
        assert self.ai.generate_text.await_count == 2
        retry_prompt = self.ai.generate_text.await_args_list[1].args[0]
        assert "REJECTED" in retry_prompt and "not in the list" in retry_prompt
        assert [o.reasoning for o in outfits] == ["AI 1", "AI 2", "AI 3"]

    async def test_two_bad_answers_fall_back_to_the_best_combos(self, db_session, test_user):
        kinds = ("t-shirt", "shirt", "jeans", "pants", "sneakers")
        items, outfits = await self._run(
            db_session, test_user, ["not json at all", {"outfits": [{"items": [1]}]}], kinds
        )
        assert self.ai.generate_text.await_count == 2
        assert len(outfits) == 3
        assert all(o.ai_raw_response["_fallback"] == "combo_scorer" for o in outfits)
        assert len({frozenset(s) for s in self._sets(outfits)}) == 3

    async def test_valid_choices_are_topped_up_with_combos(self, db_session, test_user):
        kinds = ("t-shirt", "shirt", "jeans", "pants", "sneakers")
        one = {"outfits": [{"items": [1, 3, 5], "headline": "AI 1"}, {"items": [1]}]}
        items, outfits = await self._run(db_session, test_user, [one, one], kinds)
        assert outfits[0].reasoning == "AI 1"
        assert [o.ai_raw_response.get("_fallback") for o in outfits[1:]] == ["combo_scorer"] * 2
        assert {items[0].id, items[2].id, items[4].id} not in self._sets(outfits)[1:]

    async def test_a_choice_missing_a_pinned_piece_is_not_saved(self, db_session, test_user):
        kinds = ("t-shirt", "shirt", "jeans", "pants", "sneakers")
        no_pin = {"outfits": [{"items": [1, 3, 5], "headline": "Forgot"}]}
        items, outfits = await self._run(
            db_session, test_user, [no_pin, no_pin], kinds, include=(4,), count=1
        )
        assert outfits[0].ai_raw_response["_fallback"] == "combo_scorer"
        assert items[3].id in self._sets(outfits)[0]

    async def test_conflicting_pins_are_refused_before_the_ai(self, db_session, test_user):
        kinds = ("t-shirt", "shirt", "jeans", "sneakers")
        with pytest.raises(ValueError, match="both fill"):
            await self._run(db_session, test_user, [], kinds, include=(1, 2))
        self.ai.generate_text.assert_not_called()

    async def test_filters_that_empty_a_region_are_refused_before_the_ai(
        self, db_session, test_user
    ):
        kinds = ("t-shirt", "jeans", "sneakers")
        with pytest.raises(ValueError, match="footwear"):
            await self._run(
                db_session,
                test_user,
                [],
                kinds,
                filters=OutfitFilters(exclude_types=["sneakers"]),
            )
        self.ai.generate_text.assert_not_called()

    async def test_the_prompt_lists_the_scored_combinations(self, db_session, test_user):
        kinds = ("t-shirt", "jeans", "sneakers")
        answer = {"outfits": [{"items": [1, 2, 3], "headline": "AI 1"}]}
        await self._run(db_session, test_user, [answer], kinds, count=1)
        assert "PRE-SCORED COMBINATIONS" in self.ai.generate_text.await_args.args[0]


class TestUpstreamPathUntouched:
    @pytest.mark.asyncio
    async def test_flag_off_ignores_filters_and_keeps_upstream_repair(self, db_session, test_user):
        kinds = ("t-shirt", "jeans", "sneakers")
        items = [
            ClothingItem(
                user_id=test_user.id,
                type=kind,
                image_path=f"test/{uuid4()}.jpg",
                status=ItemStatus.ready,
                primary_color="black",
            )
            for kind in kinds
        ]
        db_session.add_all(items)
        await db_session.commit()
        test_user.preferences = None
        number_map = {n: item.id for n, item in enumerate(items, start=1)}
        ai = MagicMock()
        # Number 9 is unknown: upstream drops it and keeps the rest without retrying.
        ai.generate_text = AsyncMock(
            return_value=MagicMock(
                content=json.dumps({"outfits": [{"items": [1, 2, 3, 9], "headline": "AI"}]}),
                model="m",
                endpoint="e",
            )
        )
        service = RecommendationService(db_session)
        settings = SimpleNamespace(suggestion_combos_enabled=False, suggestion_top_combos=15)
        with (
            patch("app.services.recommendation_service.get_settings", return_value=settings),
            patch("app.services.recommendation_service.AIService", return_value=ai),
            patch(
                "app.services.recommendation_service.pop_suggestion", AsyncMock(return_value=None)
            ),
            patch("app.services.recommendation_service.push_suggestions", AsyncMock()),
            patch.object(service, "_format_items_for_prompt", return_value=("", number_map)),
            patch.object(service, "_get_today_rejected_item_ids", AsyncMock(return_value=set())),
        ):
            outfits = await service.generate_recommendations(
                user=test_user,
                occasion="casual",
                weather_override=_weather(),
                time_of_day=TimeOfDay.afternoon,
                filters=OutfitFilters(exclude_types=["sneakers"]),
            )
        assert ai.generate_text.await_count == 1
        assert outfits[0].reasoning == "AI"
        assert "PRE-SCORED" not in ai.generate_text.await_args.args[0]
