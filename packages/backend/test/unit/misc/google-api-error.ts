/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it, vi } from 'vitest';
import {
	extractGoogleApiStatus,
	isTransientGoogleApiError,
	retryOnTransientGoogleApiError,
	summarizeGoogleApiError,
} from '@/misc/google-api-error.js';

// Google の HTML エラーページ (2026-08-01 の実障害で youtubeUploadError に丸ごと保存されていたもの)
const GOOGLE_HTML_408 = '<!DOCTYPE html>\n<html lang=en>\n  <meta charset=utf-8>\n  <title>Error 408 (Request Timeout)!!1</title>\n  <style>*{margin:0;padding:0}</style>';

function gaxiosLikeError(status: number, data: unknown): Error {
	const err = new Error(typeof data === 'string' ? data : JSON.stringify(data));
	Object.assign(err, { status, response: { status, data } });
	return err;
}

describe(extractGoogleApiStatus, () => {
	it('reads status property', () => {
		expect(extractGoogleApiStatus(gaxiosLikeError(408, GOOGLE_HTML_408))).toBe(408);
	});
	it('reads response.status when top-level status is absent', () => {
		expect(extractGoogleApiStatus({ response: { status: 503 } })).toBe(503);
	});
	it('reads numeric-string code', () => {
		expect(extractGoogleApiStatus({ code: '429' })).toBe(429);
	});
	it('ignores network error code strings', () => {
		expect(extractGoogleApiStatus({ code: 'ECONNRESET' })).toBeNull();
	});
	it('returns null for plain errors', () => {
		expect(extractGoogleApiStatus(new Error('boom'))).toBeNull();
		expect(extractGoogleApiStatus(null)).toBeNull();
	});
});

describe(isTransientGoogleApiError, () => {
	it.each([408, 429, 500, 502, 503, 504])('treats HTTP %i as transient', (status) => {
		expect(isTransientGoogleApiError(gaxiosLikeError(status, 'x'))).toBe(true);
	});
	it.each([400, 401, 403, 404])('treats HTTP %i as permanent', (status) => {
		expect(isTransientGoogleApiError(gaxiosLikeError(status, 'x'))).toBe(false);
	});
	it('treats network error codes as transient', () => {
		const err = Object.assign(new Error('socket error'), { code: 'ECONNRESET' });
		expect(isTransientGoogleApiError(err)).toBe(true);
	});
	it('treats socket hang up message as transient', () => {
		expect(isTransientGoogleApiError(new Error('socket hang up'))).toBe(true);
	});
	it('treats plain errors as permanent', () => {
		expect(isTransientGoogleApiError(new Error('recording file not found'))).toBe(false);
	});
});

describe(summarizeGoogleApiError, () => {
	it('never returns raw HTML (408 error page case)', () => {
		const summary = summarizeGoogleApiError(gaxiosLikeError(408, GOOGLE_HTML_408));
		expect(summary).toBe('HTTP 408');
		expect(summary).not.toContain('<');
	});
	it('uses Google JSON error message with status', () => {
		const err = gaxiosLikeError(403, { error: { message: 'The request cannot be completed because you have exceeded your quota.' } });
		expect(summarizeGoogleApiError(err)).toBe('HTTP 403: The request cannot be completed because you have exceeded your quota.');
	});
	it('passes through plain error messages', () => {
		expect(summarizeGoogleApiError(new Error('recording file not found'))).toBe('recording file not found');
	});
	it('passes through thrown strings', () => {
		expect(summarizeGoogleApiError('something odd')).toBe('something odd');
	});
	it('collapses newlines and truncates to maxLength', () => {
		const err = new Error('line1\nline2\t line3');
		expect(summarizeGoogleApiError(err)).toBe('line1 line2 line3');
		expect(summarizeGoogleApiError(err, 5)).toBe('line1');
	});
	it('falls back to unknown error', () => {
		expect(summarizeGoogleApiError({})).toBe('unknown error');
	});
});

describe(retryOnTransientGoogleApiError, () => {
	it('retries transient errors and eventually succeeds', async () => {
		const fn = vi.fn()
			.mockRejectedValueOnce(gaxiosLikeError(408, GOOGLE_HTML_408))
			.mockRejectedValueOnce(gaxiosLikeError(503, 'unavailable'))
			.mockResolvedValueOnce('ok');
		await expect(retryOnTransientGoogleApiError(fn, { label: 'test', initialDelayMs: 1 })).resolves.toBe('ok');
		expect(fn).toHaveBeenCalledTimes(3);
	});
	it('does not retry permanent errors', async () => {
		const quotaError = gaxiosLikeError(403, { error: { message: 'quotaExceeded' } });
		const fn = vi.fn().mockRejectedValue(quotaError);
		await expect(retryOnTransientGoogleApiError(fn, { label: 'test', initialDelayMs: 1 })).rejects.toBe(quotaError);
		expect(fn).toHaveBeenCalledTimes(1);
	});
	it('throws the last error when attempts are exhausted', async () => {
		const err = gaxiosLikeError(408, GOOGLE_HTML_408);
		const fn = vi.fn().mockRejectedValue(err);
		await expect(retryOnTransientGoogleApiError(fn, { label: 'test', attempts: 3, initialDelayMs: 1 })).rejects.toBe(err);
		expect(fn).toHaveBeenCalledTimes(3);
	});
	it('logs a warning per retry', async () => {
		const warn = vi.fn();
		const fn = vi.fn()
			.mockRejectedValueOnce(gaxiosLikeError(408, GOOGLE_HTML_408))
			.mockResolvedValueOnce('ok');
		await retryOnTransientGoogleApiError(fn, { label: 'drive upload', logger: { warn }, initialDelayMs: 1 });
		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn.mock.calls[0][0]).toContain('drive upload');
		expect(warn.mock.calls[0][0]).toContain('HTTP 408');
	});
});
