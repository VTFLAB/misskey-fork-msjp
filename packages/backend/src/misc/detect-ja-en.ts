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
		.replace(UNICODE_EMOJI_RANGE, '');
	if (JA_CHAR_RANGE.test(stripped)) return 'ja';
	if (EN_CHAR_RANGE.test(stripped)) return 'en';
	return null;
}
