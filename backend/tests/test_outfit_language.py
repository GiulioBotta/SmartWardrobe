import pytest

import tests.test_recommendation_service as recommendation_tests
from app.services.outfit_language import outfit_language_instruction


class TestOutfitLanguageInstruction:
    def test_english_adds_nothing(self):
        assert outfit_language_instruction("en") == ""

    def test_italian_names_the_language_and_the_written_fields(self):
        line = outfit_language_instruction("it")
        assert "Italian" in line
        for field in ("headline", "highlights", "styling_tip"):
            assert field in line

    @pytest.mark.parametrize("locale", [None, "", "xx"])
    def test_unknown_locale_adds_nothing(self, locale):
        assert outfit_language_instruction(locale) == ""


@pytest.mark.asyncio
async def test_prompt_asks_for_the_users_language(db_session, test_user):
    test_user.locale = "it"
    helper = recommendation_tests.TestHotDayLegwear()
    await helper._hot_day_outfits(db_session, test_user, [[3, 2, 4]])
    prompt = helper.ai.generate_text.call_args.args[0]
    assert prompt.rstrip().endswith(outfit_language_instruction("it"))


@pytest.mark.asyncio
async def test_prompt_is_unchanged_for_english_users(db_session, test_user):
    test_user.locale = "en"
    helper = recommendation_tests.TestHotDayLegwear()
    await helper._hot_day_outfits(db_session, test_user, [[3, 2, 4]])
    prompt = helper.ai.generate_text.call_args.args[0]
    assert "Write the text fields" not in prompt
