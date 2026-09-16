"""Assets search mini-language: token AND, --exclude, word-scoped *."""

from __future__ import annotations

from app.routers.assets import _like_from_user_token, _token_search_clause


def test_like_from_user_token_word_and_plain():
    assert _like_from_user_token("A*S", word_scoped=True) == "A%S"
    assert _like_from_user_token("*GS", word_scoped=True) == "%GS"
    assert _like_from_user_token("A*", word_scoped=True) == "A%"
    assert _like_from_user_token("AGS", word_scoped=False) == "%AGS%"
    assert _like_from_user_token("100%", word_scoped=False) == "%100[%]%"


def test_plain_tokens_and_across_fields():
    sql, params = _token_search_clause("AGS Warehouse")
    assert "STRING_SPLIT" not in sql
    assert params.count("%AGS%") == 10
    assert params.count("%Warehouse%") == 10
    assert sql.count(" AND ") >= 2


def test_word_scoped_star_and_exclude():
    sql, params = _token_search_clause("A*S --Warehouse")
    assert sql.count("STRING_SPLIT") == 10
    assert "NOT" in sql
    assert params.count("A%S") == 10
    assert params.count("%Warehouse%") == 10


def test_exclude_word_scoped():
    sql, params = _token_search_clause("--A*S")
    assert "NOT" in sql
    assert "STRING_SPLIT" in sql
    assert params.count("A%S") == 10


def test_empty_and_bare_exclude_skipped():
    assert _token_search_clause("") == ("", ())
    assert _token_search_clause("--") == ("", ())
    assert _token_search_clause("*") == ("", ())
