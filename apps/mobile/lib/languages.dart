/// 選べる言語。gpt-realtime-translate が出力できる13言語(設計メモの「選べる翻訳言語」)。
/// コードは REST API の language(packages/api-client/openapi.json)と同じ。
const languageNames = <String, String>{
  'ja': '日本語',
  'en': '英語',
  'zh': '中国語',
  'ko': '韓国語',
  'es': 'スペイン語',
  'pt': 'ポルトガル語',
  'fr': 'フランス語',
  'de': 'ドイツ語',
  'it': 'イタリア語',
  'ru': 'ロシア語',
  'hi': 'ヒンディー語',
  'id': 'インドネシア語',
  'vi': 'ベトナム語',
};

String languageName(String code) => languageNames[code] ?? code;
