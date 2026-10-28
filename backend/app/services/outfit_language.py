"""Language line for the outfit prompt.

The recommendation prompt is in English and never says which language to answer in, so
headlines and tips came back in English for every user. Only non-English locales get the
extra line, which keeps the prompt for English users exactly as before.
"""

from app.services.ai_service import DESCRIPTION_LANGUAGES


def outfit_language_instruction(locale: str | None) -> str:
    language = DESCRIPTION_LANGUAGES.get(locale or "")
    if not language or locale == "en":
        return ""
    return (
        f"Write the text fields (headline, highlights, styling_tip) in {language}. "
        "Keep the JSON keys in English."
    )
