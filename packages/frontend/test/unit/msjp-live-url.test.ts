/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, test, expect } from 'vitest';
import { msjpLiveUrl } from '@/utility/msjp-live-url.js';

const L = 'https://live.msjp.pro';
const host = 'mi.msjp.pro';

describe('msjpLiveUrl', () => {
	test.each([
		['/live', `${L}/`],
		['/live/@alice', `${L}/c/alice@mi.msjp.pro`],
		['/live/@alice/stream', `${L}/c/alice@mi.msjp.pro/live`],
		['/live/@alice/archive/0123456789abcdef', `${L}/c/alice@mi.msjp.pro/archives/0123456789abcdef`],
		['/live/@foo@example.com/stream', `${L}/c/foo@example.com/live`],
		['/live/@alice/overlay', `${L}/settings/obs/comments`],
		['/live/@alice/comment-generator?x=1', `${L}/settings/obs/comments`],
		['/live/@alice/subtitles', `${L}/settings/obs/subtitles`],
		['/settings/streaming', `${L}/settings/streaming`],
		['/live/@a@b@c', `${L}/`],
	])('%s -> %s', (path, expected) => {
		expect(msjpLiveUrl(path, host)).toBe(expected);
	});
});
