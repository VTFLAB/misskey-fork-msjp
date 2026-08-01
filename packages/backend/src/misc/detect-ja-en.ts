/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// ひらがな / カタカナ / CJK統合漢字の文字コードレンジ
const JA_CHAR_RANGE = /[぀-ゟ゠-ヿ一-鿿]/;
// ASCII 英字 (判定用。記号・数字・絵文字は言語判定に寄与させない)
const EN_CHAR_RANGE = /[A-Za-z]/;
// カスタム絵文字ショートコード (Misskey/Twitch 共通形式)。両端がコロンのトークンのみ除去する
// (`hello: world` のような文中の単独コロンを誤って巻き込まないよう `g` フラグでトークン単位にマッチさせる)
const CUSTOM_EMOJI_SHORTCODE_RANGE = /:[a-zA-Z0-9_+-]+:/g;
// Unicode 絵文字 (異体字セレクタ U+FE0F・ZWJ U+200D 等の絵文字構成文字を含む)
const UNICODE_EMOJI_RANGE = /\p{Extended_Pictographic}|[\uFE0F\u200D]/gu;
// \u7B11\u3044\u306E w \u9023\u7D9A (\u300Cwww\u300D\u5168\u4F53\u3001\u307E\u305F\u306F\u300C\u3059\u3054\u3044www\u300D\u306E\u672B\u5C3E)\u3002\u65E5\u672C\u8A9E\u30B9\u30E9\u30F3\u30B0\u3067\u3042\u3063\u3066\u82F1\u8A9E\u3067\u306F\u306A\u3044\u305F\u3081
// \u8A00\u8A9E\u5224\u5B9A\u306B\u5BC4\u4E0E\u3055\u305B\u306A\u3044 (\u3053\u308C\u304C\u7121\u3044\u3068\u300Cwww\u300D\u304C 'en' \u5224\u5B9A\u3055\u308C\u8868\u793A\u7528\u306E\u548C\u8A33\u304C\u30AD\u30E5\u30FC\u3055\u308C\u3066\u3057\u307E\u3046)\u3002
// \u82F1\u5358\u8A9E\u306E\u672B\u5C3E (wow \u7B49) \u3092\u5DFB\u304D\u8FBC\u307E\u306A\u3044\u3088\u3046\u3001\u76F4\u524D\u304C\u82F1\u5B57\u306E\u5834\u5408\u306F\u9664\u53BB\u3057\u306A\u3044
const LAUGH_W_RUN = /(?<![A-Za-z\uFF21-\uFF3A\uFF41-\uFF5A])[wW\uFF57\uFF37]+\s*$/;

/**
 * Twitch 配信コメント翻訳向けの軽量な日本語/英語判定。
 * LLM 呼び出し無しの文字コードレンジ判定で十分な精度を確保する:
 * - 判定前にカスタム絵文字ショートコード (`:test:` 等) と Unicode 絵文字を除去する
 *   (絵文字だけのコメントが `EN_CHAR_RANGE` に誤って引っかかり翻訳されるのを防ぐため)
 * - 除去後、ひらがな・カタカナ・CJK統合漢字が1文字でも含まれれば 'ja'
 * - 上記が無く ASCII 英字が含まれれば 'en'
 * - どちらでもない (絵文字・記号・数字のみ、または絵文字除去後に空になった場合等) は判定不能として null
 */
export function detectJaEn(text: string): 'ja' | 'en' | null {
	const stripped = text
		.replace(CUSTOM_EMOJI_SHORTCODE_RANGE, '')
		.replace(UNICODE_EMOJI_RANGE, '')
		.replace(LAUGH_W_RUN, '');
	if (JA_CHAR_RANGE.test(stripped)) return 'ja';
	if (EN_CHAR_RANGE.test(stripped)) return 'en';
	return null;
}
