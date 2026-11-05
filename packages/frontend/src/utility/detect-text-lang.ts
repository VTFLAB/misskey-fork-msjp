/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// 翻訳欄の「◯◯から翻訳」に出す言語の簡易判定 (bsky-fork 独自)。ブラウザの LanguageDetector
// (Chrome 138+) が無いときに使う。表示用なので、外れても訳文には影響しない。
// - 日本語・韓国語・中国語・タイ語・ロシア語・ウクライナ語は文字の種類で判定する
// - ラテン文字の言語は、よく使う短い語 (機能語) の出現数で判定する

const STOPWORDS: Record<string, string[]> = {
	en: ['the', 'and', 'of', 'to', 'in', 'is', 'for', 'on', 'with', 'that', 'this', 'are', 'was', 'it', 'you', 'be', 'at', 'from', 'have', 'not', 'will', 'more', 'than', 'they', 'their', 'has', 'by', 'an', 'or', 'we', 'i'],
	es: ['el', 'la', 'de', 'que', 'y', 'en', 'los', 'las', 'por', 'con', 'una', 'para', 'es', 'del', 'se', 'no', 'lo', 'más', 'pero', 'como', 'al', 'mi', 'muy', 'hoy', 'yo', 'este', 'esta', 'también', 'hay', 'ya'],
	fr: ['le', 'la', 'les', 'de', 'des', 'et', 'est', 'un', 'une', 'du', 'en', 'que', 'pour', 'pas', 'dans', 'sur', 'il', 'au', 'avec', 'ce', 'qui', 'je', 'nous', 'vous', 'ai', 'très', 'mais', 'aussi', 'était', 'à'],
	de: ['der', 'die', 'das', 'und', 'ist', 'nicht', 'mit', 'ein', 'eine', 'zu', 'von', 'den', 'für', 'auf', 'sich', 'auch', 'dem', 'ich', 'es', 'im', 'wir', 'sie', 'aber', 'sehr', 'bin', 'war', 'habe'],
	it: ['il', 'la', 'di', 'che', 'e', 'per', 'un', 'una', 'non', 'del', 'della', 'sono', 'con', 'gli', 'le', 'lo', 'al', 'si', 'ma', 'ho', 'molto', 'anche', 'questo', 'questa', 'io', 'è', 'nel', 'nella'],
	pt: ['o', 'a', 'de', 'que', 'e', 'do', 'da', 'em', 'um', 'uma', 'para', 'com', 'não', 'os', 'as', 'no', 'na', 'se', 'por', 'é', 'muito', 'também', 'eu', 'mas', 'foi'],
	nl: ['de', 'het', 'een', 'en', 'van', 'is', 'niet', 'dat', 'op', 'te', 'met', 'voor', 'zijn', 'ik', 'je', 'ook'],
	id: ['yang', 'dan', 'di', 'ini', 'itu', 'dengan', 'untuk', 'tidak', 'dari', 'ada', 'akan', 'saya', 'ke', 'juga'],
};

const STOPWORD_SETS = Object.entries(STOPWORDS).map(([lang, words]) => [lang, new Set(words)] as const);

function count(text: string, re: RegExp): number {
	return (text.match(re) ?? []).length;
}

/**
 * text の言語を推定して言語コードを返す。判定できなければ null。
 */
export function detectTextLang(text: string): string | null {
	// URL・メンション・ハッシュタグ・カスタム絵文字は言語の手がかりにならないので除く
	const body = text
		.replace(/https?:\/\/\S+/g, ' ')
		.replace(/[@#][\w.@-]+/g, ' ')
		.replace(/:[\w+-]+:/g, ' ');

	const letters = count(body, /\p{L}/gu);
	if (letters === 0) return null;
	// 顔文字の「・」(U+30FB) と長音「ー」(U+30FC) は数えない
	const kana = count(body, /[぀-ゟ゠-ヺヽ-ヿ]/g);
	const hangul = count(body, /[가-힯ᄀ-ᇿ]/g);
	const han = count(body, /[一-鿿]/g);
	const thai = count(body, /[฀-๿]/g);
	const cyrillic = count(body, /[Ѐ-ӿ]/g);
	if (kana / letters >= 0.2) return 'ja';
	if (hangul / letters >= 0.2) return 'ko';
	if (han / letters >= 0.2) return kana > 0 ? 'ja' : 'zh';
	if (thai / letters >= 0.2) return 'th';
	if (cyrillic / letters >= 0.2) return /[іїєґ]/iu.test(body) ? 'uk' : 'ru';

	const latin = count(body, /\p{Script=Latin}/gu);
	if (latin / letters < 0.5) return null;
	const words = body.toLowerCase().match(/\p{L}+/gu) ?? [];
	if (words.length === 0) return null;
	let best: string | null = null;
	let bestScore = 0;
	let tie = false;
	for (const [lang, set] of STOPWORD_SETS) {
		const score = words.filter(w => set.has(w)).length;
		if (score > bestScore) {
			best = lang;
			bestScore = score;
			tie = false;
		} else if (score === bestScore && score > 0) {
			tie = true;
		}
	}
	// 機能語が少なすぎる・他の言語と同点のときは判定しない
	if (best == null || tie || bestScore < 2 || bestScore / words.length < 0.08) return null;
	return best;
}
