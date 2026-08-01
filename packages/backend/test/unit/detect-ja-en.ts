/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import { describe, test, expect } from 'vitest';
import { detectJaEn } from '@/misc/detect-ja-en.js';

// bsky-fork 独自: Twitch 配信コメント翻訳の要否判定 (detectJaEn) の検証。
// カスタム絵文字ショートコード・Unicode絵文字だけのコメントを誤って 'en' 判定しないこと
// (= 誤翻訳キューイングされないこと) を重点的に確認する。
describe('detectJaEn', () => {
	test('カスタム絵文字ショートコードのみ → null', () => {
		expect(detectJaEn(':test:')).toBeNull();
	});

	test('Unicode絵文字のみ → null', () => {
		expect(detectJaEn('😀')).toBeNull();
	});

	test('複数のカスタム絵文字ショートコードのみ → null', () => {
		expect(detectJaEn(':smile: :wave:')).toBeNull();
	});

	test('英字 + カスタム絵文字ショートコード → en (英字部分は判定に残る)', () => {
		expect(detectJaEn('hello :smile:')).toBe('en');
	});

	test('英語のみ → en', () => {
		expect(detectJaEn('hello world')).toBe('en');
	});

	test('日本語のみ → ja', () => {
		expect(detectJaEn('こんにちは')).toBe('ja');
	});

	test('空文字 → null', () => {
		expect(detectJaEn('')).toBeNull();
	});

	test('絵文字とショートコードの混在のみ → null', () => {
		expect(detectJaEn(':smile: 😀')).toBeNull();
	});

	test('日本語 + カスタム絵文字ショートコード → ja (絵文字混在でも判定は変わらない)', () => {
		expect(detectJaEn('こんにちは :wave:')).toBe('ja');
	});

	test('URLのコロンをショートコードとして誤除去しない → en', () => {
		expect(detectJaEn('see http://example.com for details')).toBe('en');
	});

	test('w の連続のみ (笑い) → null (英語と誤判定して翻訳キューに載せない)', () => {
		expect(detectJaEn('www')).toBeNull();
		expect(detectJaEn('W')).toBeNull();
		expect(detectJaEn('ｗｗｗ')).toBeNull();
	});

	test('日本語 + 末尾の w 連続 → ja', () => {
		expect(detectJaEn('すごいwww')).toBe('ja');
	});

	test('英単語末尾の w は笑いとして除去しない → en', () => {
		expect(detectJaEn('wow')).toBe('en');
	});

	test('英語 + 空白区切りの末尾 w 連続 → en (英語部分は判定に残る)', () => {
		expect(detectJaEn('nice www')).toBe('en');
	});
});
