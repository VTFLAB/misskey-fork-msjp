/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// ひらがな / カタカナ / CJK統合漢字の文字コードレンジ
const JA_CHAR_RANGE = /[぀-ゟ゠-ヿ一-鿿]/;
// ASCII 英字 (判定用。記号・数字・絵文字は言語判定に寄与させない)
const EN_CHAR_RANGE = /[A-Za-z]/;

/**
 * Twitch 配信コメント翻訳向けの軽量な日本語/英語判定。
 * LLM 呼び出し無しの文字コードレンジ判定で十分な精度を確保する:
 * - ひらがな・カタカナ・CJK統合漢字が1文字でも含まれれば 'ja'
 * - 上記が無く ASCII 英字が含まれれば 'en'
 * - どちらでもない (絵文字・記号・数字のみ等) 場合は判定不能として null
 */
export function detectJaEn(text: string): 'ja' | 'en' | null {
	if (JA_CHAR_RANGE.test(text)) return 'ja';
	if (EN_CHAR_RANGE.test(text)) return 'en';
	return null;
}
