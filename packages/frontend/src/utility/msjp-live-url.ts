/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// bsky-fork: the streaming feature moved to the standalone site MSJP Live (2026-10-02).
// Maps this instance's old streaming paths to the corresponding MSJP Live URL. The same mapping
// is done by the reverse proxy for full page loads; this covers navigation inside the client.

export const MSJP_LIVE_ORIGIN = 'https://live.msjp.pro';

/** `@name` or `@name@host` -> `name@host` (local users get this instance's host). */
function toLiveAcct(acct: string, localHost: string): string | null {
	const m = /^@?([^@/]+)(?:@([^@/]+))?$/.exec(acct);
	if (m == null) return null;
	return `${m[1]}@${m[2] ?? localHost}`;
}

export function msjpLiveUrl(path: string, localHost: string): string {
	const segments = path.split('?')[0].split('/').filter(s => s !== '');
	if (segments[0] === 'settings') return `${MSJP_LIVE_ORIGIN}/settings/streaming`;
	if (segments[0] !== 'live' || segments.length < 2) return `${MSJP_LIVE_ORIGIN}/`;
	const acct = toLiveAcct(decodeURIComponent(segments[1]), localHost);
	if (acct == null) return `${MSJP_LIVE_ORIGIN}/`;
	const channel = `${MSJP_LIVE_ORIGIN}/c/${acct}`;
	switch (segments[2]) {
		case undefined: return channel;
		case 'stream': return `${channel}/live`;
		case 'archive': return segments[3] != null ? `${channel}/archives/${encodeURIComponent(segments[3])}` : channel;
		case 'overlay':
		case 'comment-generator': return `${MSJP_LIVE_ORIGIN}/settings/obs/comments`;
		case 'subtitles': return `${MSJP_LIVE_ORIGIN}/settings/obs/subtitles`;
		default: return channel;
	}
}
