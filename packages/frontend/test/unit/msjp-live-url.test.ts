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
		['/live/@VTF', `${L}/c/VTF@mi.msjp.pro`],
		['/live/@VTF/stream', `${L}/c/VTF@mi.msjp.pro/live`],
		['/live/@VTF/archive/apql94bhkfcj00as', `${L}/c/VTF@mi.msjp.pro/archives/apql94bhkfcj00as`],
		['/live/@foo@example.com/stream', `${L}/c/foo@example.com/live`],
		['/live/@VTF/overlay', `${L}/settings/obs/comments`],
		['/live/@VTF/comment-generator?x=1', `${L}/settings/obs/comments`],
		['/live/@VTF/subtitles', `${L}/settings/obs/subtitles`],
		['/settings/streaming', `${L}/settings/streaming`],
		['/live/@a@b@c', `${L}/`],
	])('%s -> %s', (path, expected) => {
		expect(msjpLiveUrl(path, host)).toBe(expected);
	});
});
