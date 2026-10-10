import json

from voice_intercom_agent.json_stream import FlatJsonStream


def feed_chars(stream: FlatJsonStream, text: str) -> list[tuple[int, str, str]]:
    """1文字ずつ渡し、(何文字目で出たか, キー, 値) を返す。"""
    out = []
    for i, c in enumerate(text):
        out += [(i, k, v) for k, v in stream.feed(c)]
    return out


def test_values_come_out_as_soon_as_each_string_closes() -> None:
    text = '{"pt": "Olá", "ko": "안녕"}'
    got = feed_chars(FlatJsonStream(["pt", "ko"]), text)
    assert [(k, v) for _, k, v in got] == [("pt", "Olá"), ("ko", "안녕")]
    # pt は閉じた " の時点で出る(ko を待たない)
    assert got[0][0] == text.index('"Olá"') + len('"Olá"') - 1


def test_escapes_are_decoded_and_do_not_end_the_string() -> None:
    value = 'Er sagte "Ja", \\ und\nTab\t ü'
    text = json.dumps({"de": value, "en": "ok"}, ensure_ascii=True)
    stream = FlatJsonStream(["de", "en"])
    assert [(k, v) for _, k, v in feed_chars(stream, text)] == [("de", value), ("en", "ok")]


def test_key_like_text_inside_a_value_is_not_a_key() -> None:
    text = json.dumps({"fr": 'dit "en": "non"', "en": "yes"})
    stream = FlatJsonStream(["fr", "en"])
    assert [(k, v) for _, k, v in feed_chars(stream, text)] == [
        ("fr", 'dit "en": "non"'),
        ("en", "yes"),
    ]


def test_unknown_and_duplicate_keys_are_ignored() -> None:
    stream = FlatJsonStream(["en"])
    assert stream.feed('{"xx": "a", "en": "b", "en": "c"}') == [("en", "b")]
    assert stream.missing == []


def test_missing_lists_keys_not_yet_seen() -> None:
    stream = FlatJsonStream(["ko", "en", "de"])
    stream.feed('{"en": "hi", "de": "Hal')
    assert stream.missing == ["de", "ko"]


def test_whitespace_and_large_chunks() -> None:
    stream = FlatJsonStream(["es", "it"])
    assert stream.feed('\n{\n  "es" : "1.250 unidades" ,\n  "it"') == [("es", "1.250 unidades")]
    assert stream.feed(' :  "1.250 unità"\n}') == [("it", "1.250 unità")]


def test_broken_json_stops_quietly() -> None:
    stream = FlatJsonStream(["en"])
    assert stream.feed('["en", "x"]') == []
    assert stream.broken
    assert stream.feed('{"en": "x"}') == []


def test_non_string_value_marks_broken() -> None:
    stream = FlatJsonStream(["en", "de"])
    assert stream.feed('{"en": "a", "de": 1}') == [("en", "a")]
    assert stream.broken
