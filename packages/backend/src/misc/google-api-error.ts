/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Google API (googleapis / gaxios) のエラー取り扱いユーティリティ (bsky-fork 独自)。
//
// backend は googleapis-common (GaxiosError) を直接依存に持たない方針のため、
// エラー形状はダックタイピングで判定する (GoogleYoutubeService.isQuotaExceededError と同方針)。
//
// 背景 (2026-08-01 の実障害): 配信アーカイブのアップロード中に Google 側が一時的な
// HTTP 408 (Request Timeout) を返し、(1) リトライが無いため即座に失敗確定し、
// (2) エラーメッセージとして Google の HTML エラーページがそのまま DB/UI に保存された。
// このモジュールは「一時エラーの識別とリトライ」「HTML を含む生エラーの1行要約」を提供する。

// 一時的な失敗としてリトライ対象にする HTTP ステータス。
// 408=Request Timeout / 429=Too Many Requests / 5xx=Google 側の一時障害
const TRANSIENT_HTTP_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

// 一時的な失敗としてリトライ対象にするネットワークエラーコード (Node.js)
const TRANSIENT_NETWORK_CODES = new Set([
	'ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'EPIPE', 'EAI_AGAIN', 'ENETUNREACH', 'ECONNREFUSED',
]);

/**
 * エラーから HTTP ステータスコードを取り出す (GaxiosError 形状のダックタイピング)。
 * 取れない場合は null。
 */
export function extractGoogleApiStatus(err: unknown): number | null {
	if (err == null || typeof err !== 'object') return null;
	const e = err as { status?: unknown; code?: unknown; response?: { status?: unknown } };
	for (const candidate of [e.status, e.response?.status, e.code]) {
		if (typeof candidate === 'number' && Number.isInteger(candidate)) return candidate;
		if (typeof candidate === 'string' && /^[1-5][0-9]{2}$/.test(candidate)) return Number(candidate);
	}
	return null;
}

/**
 * リトライで解消しうる一時的な失敗かどうか。
 * HTTP 408/429/5xx、およびネットワーク断系のエラーコードを一時的とみなす。
 * 401/403 (認可・クォータ) や 4xx は恒久的な失敗として false。
 */
export function isTransientGoogleApiError(err: unknown): boolean {
	const status = extractGoogleApiStatus(err);
	if (status != null) return TRANSIENT_HTTP_STATUSES.has(status);
	if (err != null && typeof err === 'object') {
		const code = (err as { code?: unknown }).code;
		if (typeof code === 'string' && TRANSIENT_NETWORK_CODES.has(code)) return true;
	}
	if (err instanceof Error && err.message.includes('socket hang up')) return true;
	return false;
}

function looksLikeHtml(text: string): boolean {
	return /^\s*</.test(text);
}

function collapseWhitespace(text: string): string {
	return text.replace(/\s+/g, ' ').trim();
}

/**
 * DB 保存・UI 表示用にエラーを1行へ要約する。
 * Google はエラー時に HTML ページ (例: "Error 408 (Request Timeout)!!1") を返すことがあり、
 * GaxiosError.message にはその HTML が丸ごと入るため、そのまま保存しない。
 * 採用順: HTTP ステータス + (Google JSON エラーの error.message → HTML でない Error.message)。
 * どちらも取れない場合は 'unknown error'。
 */
export function summarizeGoogleApiError(err: unknown, maxLength = 200): string {
	const status = extractGoogleApiStatus(err);

	let reason: string | null = null;
	const data = (err as { response?: { data?: unknown } } | null)?.response?.data;
	if (data != null && typeof data === 'object') {
		const message = (data as { error?: { message?: unknown } }).error?.message;
		if (typeof message === 'string' && message.length > 0) reason = message;
	}
	if (reason == null && typeof data === 'string' && data.length > 0 && !looksLikeHtml(data)) {
		reason = data;
	}
	if (reason == null && err instanceof Error && err.message.length > 0 && !looksLikeHtml(err.message)) {
		reason = err.message;
	}
	if (reason == null && typeof err === 'string' && err.length > 0 && !looksLikeHtml(err)) {
		reason = err;
	}

	const parts: string[] = [];
	if (status != null) parts.push(`HTTP ${status}`);
	if (reason != null) parts.push(collapseWhitespace(reason));
	if (parts.length === 0) parts.push('unknown error');
	return parts.join(': ').slice(0, maxLength);
}

export type GoogleApiRetryOptions = {
	/** ログ出力時の識別ラベル (例: 'drive upload (user=xxx)') */
	label: string;
	logger?: { warn: (message: string) => void };
	/** 総試行回数 (デフォルト 3) */
	attempts?: number;
	/** 初回リトライまでの待ち時間 (ms、以後2倍ずつ。デフォルト 30秒) */
	initialDelayMs?: number;
};

/**
 * 一時的な Google API エラー (isTransientGoogleApiError) に対して指数バックオフでリトライする。
 * 恒久エラー (クォータ超過 403 等) は即座に throw する。
 *
 * 注意: googleapis の media upload に渡した ReadStream は失敗時点で消費済みのため
 * ライブラリ側では再試行できない。fn の中で毎回ストリームを作り直すこと。
 */
export async function retryOnTransientGoogleApiError<T>(fn: () => Promise<T>, options: GoogleApiRetryOptions): Promise<T> {
	const attempts = options.attempts ?? 3;
	const initialDelayMs = options.initialDelayMs ?? 30 * 1000;
	let lastError: unknown;
	for (let attempt = 1; attempt <= attempts; attempt++) {
		try {
			return await fn();
		} catch (err) {
			lastError = err;
			if (attempt >= attempts || !isTransientGoogleApiError(err)) throw err;
			const delayMs = initialDelayMs * (2 ** (attempt - 1));
			options.logger?.warn(`${options.label}: transient error (${summarizeGoogleApiError(err)}), retrying in ${Math.round(delayMs / 1000)}s (attempt ${attempt}/${attempts})`);
			await new Promise(resolve => setTimeout(resolve, delayMs));
		}
	}
	throw lastError;
}
