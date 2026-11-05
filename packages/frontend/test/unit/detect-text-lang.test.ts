/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, test, expect } from 'vitest';
import { detectTextLang } from '@/utility/detect-text-lang.js';

describe('detectTextLang', () => {
	test('detects English news posts with links and hashtags', () => {
		const text = 'Defence Forces destroy more than 8,000 Russian drones and missiles in October\n\n'
			+ 'Ukraine\'s Defence Forces destroyed more than 8,000 Russian drones and missiles while repelling large-scale enemy attacks in October 2026. '
			+ 'They also neutralised more than 43,000 tactical-level unmanned aerial vehicles.\n\n'
			+ 'https://www.ukrinform.net/rubric-ato/4181583-defence-forces-destroy-more-than-8000-russian-drones-and-missiles-in-october.html\n\n'
			+ '#Ukraine #News #UkraineWar';
		expect(detectTextLang(text)).toBe('en');
	});

	test('detects other Latin-script languages by their function words', () => {
		expect(detectTextLang('Hoy he ido al parque con mi perro y luego tomamos un café en la plaza.')).toBe('es');
		expect(detectTextLang('Je suis allé au marché ce matin et il y avait beaucoup de monde dans la rue.')).toBe('fr');
		expect(detectTextLang('Ich habe heute den ganzen Tag gearbeitet und bin jetzt sehr müde, aber das ist nicht schlimm.')).toBe('de');
	});

	test('detects CJK, Thai and Cyrillic by script', () => {
		expect(detectTextLang('今日は久しぶりに晴れたので散歩しました')).toBe('ja');
		expect(detectTextLang('오늘은 날씨가 좋아서 산책했어요')).toBe('ko');
		expect(detectTextLang('今天天气很好，我去公园散步了')).toBe('zh');
		expect(detectTextLang('วันนี้อากาศดีมาก')).toBe('th');
		expect(detectTextLang('Сегодня хорошая погода, я гулял в парке')).toBe('ru');
		expect(detectTextLang('Сьогодні гарна погода, я гуляв у парку і їв морозиво')).toBe('uk');
	});

	test('does not call English text Japanese because of a kaomoji or one katakana word', () => {
		expect(detectTextLang('Check out this ラーメン place, it is the best one in the city (・∀・)')).toBe('en');
	});

	test('returns null when there is nothing to go on', () => {
		expect(detectTextLang('https://example.com/ #tag :emoji:')).toBeNull();
		expect(detectTextLang('lol')).toBeNull();
		expect(detectTextLang('')).toBeNull();
	});
});
