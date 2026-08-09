/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

'use strict';

// OBS ブラウザソース用のライブ字幕表示ページ。
// Misskey フロントエンド (Vue/vite) には一切依存しない、素の ES2020 単一ファイル。
// /live/:acct/subtitles から acct を読み取り、users/show で userId を解決し、
// liveSubtitle チャンネルを生 WebSocket で購読して上段原文/下段翻訳を描画する。
// 認識・翻訳処理は行わない (サーバー中継されたテキストをそのまま表示するだけ)。

(() => {
	const RESOLVE_RETRY_INTERVAL = 60 * 1000;
	const RECONNECT_BASE_DELAY = 1000;
	const RECONNECT_MAX_DELAY = 30 * 1000;
	const FADE_MS = 300;

	const DEMO_INITIAL_DELAY = 500;
	const DEMO_CAPTION_INTERIM_INTERVAL = 350;
	const DEMO_CAPTION_PAUSE_MIN = 1500;
	const DEMO_CAPTION_PAUSE_MAX = 2500;
	const DEMO_TRANSLATION_INTERVAL_MIN = 3000;
	const DEMO_TRANSLATION_INTERVAL_MAX = 5000;

	//#region query params -> --st-* CSS variables / behavior config

	function clampNumber(raw, def, min, max) {
		// Number(null) === 0 のため、パラメータ省略時は必ずデフォルトに落とす
		if (raw == null || raw === '') return def;
		const n = Number(raw);
		if (!Number.isFinite(n)) return def;
		return Math.min(max, Math.max(min, n));
	}

	function pickEnum(raw, allowed, def) {
		return allowed.includes(raw) ? raw : def;
	}

	function pickBool(raw, def) {
		if (raw === '1' || raw === 'true') return true;
		if (raw === '0' || raw === 'false') return false;
		return def;
	}

	function sanitizeColor(raw, def) {
		if (typeof raw !== 'string' || raw.length === 0 || raw.length > 64) return def;
		try {
			if (!CSS.supports('color', raw)) return def;
		} catch {
			return def;
		}
		return raw;
	}

	function sanitizeFontFamily(raw, def) {
		if (typeof raw !== 'string' || raw.length === 0 || raw.length > 200) return def;
		// フォント名として妥当な文字だけを許可 (CSS injection 対策)
		if (!/^[a-zA-Z0-9 ,._'"-]+$/.test(raw)) return def;
		return raw;
	}

	// http/https のみ許可。それ以外 (javascript: 等) は無視する
	function sanitizeHttpUrl(raw) {
		if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048) return null;
		try {
			const u = new URL(raw, location.href);
			if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
			return u.href;
		} catch {
			return null;
		}
	}

	// url("...") として埋め込むため " と \ をエスケープする
	function cssUrlEscape(raw) {
		return raw.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
	}

	const query = new URLSearchParams(location.search);

	const config = {
		align: pickEnum(query.get('align'), ['left', 'center', 'right'], 'center'),
		position: pickEnum(query.get('position'), ['top', 'bottom'], 'bottom'),
		original: pickBool(query.get('original'), true),
		translation: pickBool(query.get('translation'), true),
		interim: pickEnum(query.get('interim'), ['brackets', 'dim', 'hidden'], 'brackets'),
		cps: clampNumber(query.get('cps'), 4, 1, 30),
		minDur: clampNumber(query.get('minDur'), 1.5, 0.5, 5),
		maxDur: clampNumber(query.get('maxDur'), 7, 2, 15),
		idleClear: clampNumber(query.get('idleClear'), 6, 0, 60),
		demo: pickBool(query.get('demo'), false),
	};

	const root = document.documentElement;

	const fontFallbackFamily = sanitizeFontFamily(query.get('font'), '"Hiragino Sans", "Segoe UI", Roboto, sans-serif');
	const fontUrl = sanitizeHttpUrl(query.get('fontUrl'));
	if (fontUrl != null) {
		// カスタムフォントのロードが失敗してもフォールバックのフォントスタックで通常動作する
		root.style.setProperty('--st-font-family', `'st-custom-font', ${fontFallbackFamily}`);
		try {
			const fontFace = new FontFace('st-custom-font', `url("${cssUrlEscape(fontUrl)}")`);
			fontFace.load()
				.then(loaded => document.fonts.add(loaded))
				.catch(() => {});
		} catch {
			// FontFace 未対応環境などはフォールバックのまま
		}
	} else {
		root.style.setProperty('--st-font-family', fontFallbackFamily);
	}

	root.style.setProperty('--st-font-size', `${clampNumber(query.get('fontSize'), 32, 8, 96)}px`);
	root.style.setProperty('--st-trans-size', `${clampNumber(query.get('transSize'), 28, 8, 96)}px`);
	root.style.setProperty('--st-font-weight', `${clampNumber(query.get('fontWeight'), 700, 100, 900)}`);
	root.style.setProperty('--st-text-color', sanitizeColor(query.get('textColor'), '#ffffff'));
	root.style.setProperty('--st-trans-color', sanitizeColor(query.get('transColor'), '#a8d8ff'));
	root.style.setProperty('--st-outline-width', `${clampNumber(query.get('outline'), 4, 0, 20)}px`);
	root.style.setProperty('--st-outline-color', sanitizeColor(query.get('outlineColor'), '#000000'));

	const bgColorRaw = query.get('bgColor');
	root.style.setProperty('--st-bg-color', bgColorRaw == null || bgColorRaw === '' ? 'transparent' : sanitizeColor(bgColorRaw, 'transparent'));

	const bgImageUrl = sanitizeHttpUrl(query.get('bgImage'));
	root.style.setProperty('--st-bg-image', bgImageUrl != null ? `url("${cssUrlEscape(bgImageUrl)}")` : 'none');

	root.style.setProperty('--st-radius', `${clampNumber(query.get('radius'), 8, 0, 100)}px`);
	root.style.setProperty('--st-padding', `${clampNumber(query.get('padding'), 12, 0, 100)}px`);
	root.style.setProperty('--st-offset', `${clampNumber(query.get('offset'), 40, 0, 400)}px`);
	root.style.setProperty('--st-max-width', `${clampNumber(query.get('maxWidth'), 90, 20, 100)}%`);

	//#endregion

	const stageEl = document.getElementById('stage');
	const boxEl = document.getElementById('box');
	const originalEl = document.getElementById('original');
	const translationEl = document.getElementById('translation');

	stageEl.classList.add(`st-position-${config.position}`);
	stageEl.classList.add(`st-align-${config.align}`);
	boxEl.classList.add(`st-align-${config.align}`);

	if (!config.original) originalEl.style.display = 'none';
	if (!config.translation) translationEl.style.display = 'none';

	//#region acct

	function parseAcct(raw) {
		const s = raw.startsWith('@') ? raw.slice(1) : raw;
		const [username, host] = s.split('@');
		return { username, host: host || null };
	}

	const pathParts = location.pathname.split('/').filter(Boolean);
	// /live/:acct/subtitles
	const acctIndex = pathParts.indexOf('subtitles') - 1;
	const acctRaw = acctIndex >= 0 ? decodeURIComponent(pathParts[acctIndex]) : '';
	const acct = parseAcct(acctRaw);

	//#endregion

	//#region api

	async function api(endpoint, body) {
		const res = await fetch(`/api/${endpoint}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body ?? {}),
		});
		if (!res.ok) {
			throw new Error(`api ${endpoint} failed with status ${res.status}`);
		}
		if (res.status === 204) return null;
		return await res.json();
	}

	//#endregion

	//#region rendering: original (上段)

	let idleTimer = null;

	function renderOriginal(text, isFinal) {
		if (!config.original) return;

		if (config.interim === 'hidden' && !isFinal) {
			originalEl.textContent = '';
		} else if (!isFinal && config.interim === 'brackets') {
			originalEl.textContent = `<<${text}>>`;
		} else {
			originalEl.textContent = text;
		}
		originalEl.classList.toggle('st-interim-dim', !isFinal && config.interim === 'dim');
		originalEl.classList.remove('st-fade-out');

		if (idleTimer != null) clearTimeout(idleTimer);
		if (config.idleClear > 0) {
			idleTimer = setTimeout(() => {
				originalEl.classList.add('st-fade-out');
			}, config.idleClear * 1000);
		}
	}

	function handleCaption(payload) {
		renderOriginal(payload?.text ?? '', !!payload?.isFinal);
	}

	//#endregion

	//#region rendering: translation (下段、FIFOキュー)

	const translationQueue = [];
	let translationBusy = false;
	// 表示時間経過後に次の翻訳が無い場合、翻訳行をフェードアウトさせて消すための timer。
	// 新しい翻訳の描画開始時・clear 受信時に必ず cancel する (race safety)。
	let translationFadeClearTimer = null;

	function clampSeconds(sec, min, max) {
		return Math.min(max, Math.max(min, sec));
	}

	function pumpTranslationQueue() {
		if (translationBusy) return;
		const next = translationQueue.shift();
		if (!next) return;
		translationBusy = true;

		// キュー滞留が3件以上のときは最短表示時間に短縮して追いつく
		const backlog = translationQueue.length;
		const text = next.text ?? '';
		const durSec = backlog >= 3
			? config.minDur
			: clampSeconds(text.length / config.cps, config.minDur, config.maxDur);

		if (!config.translation) {
			translationBusy = false;
			pumpTranslationQueue();
			return;
		}

		// 新しい翻訳を描画するため、フェードアウト中であっても確実にキャンセルする。
		// (translationFadeClearTimer が発火済みで textContent が空になっていても、
		//  ここで改めて text をセットし直すので問題ない)
		if (translationFadeClearTimer != null) {
			clearTimeout(translationFadeClearTimer);
			translationFadeClearTimer = null;
		}

		translationEl.classList.add('st-fade-out');
		setTimeout(() => {
			translationEl.textContent = text;
			translationEl.classList.remove('st-fade-out');
			setTimeout(() => {
				translationBusy = false;
				if (translationQueue.length > 0) {
					// 次の翻訳が待機中なら従来どおり即時切り替え
					pumpTranslationQueue();
				} else {
					// 次の翻訳が無い: フェードアウトさせて消す。
					// translationBusy は false に戻してあるので、この fade-out 中に
					// 新しい翻訳が到着した場合は handleTranslation -> pump が即座に
					// 上段の cancel 処理に流れ、この timer は無害化される。
					translationEl.classList.add('st-fade-out');
					translationFadeClearTimer = setTimeout(() => {
						translationFadeClearTimer = null;
						// fade-out の最中に新しい翻訳が入り busy=true になったら消さない
						if (translationBusy) return;
						translationEl.textContent = '';
					}, FADE_MS);
				}
			}, durSec * 1000);
		}, FADE_MS);
	}

	function handleTranslation(payload) {
		if (!config.translation) return;
		translationQueue.push({ text: payload?.text ?? '' });
		pumpTranslationQueue();
	}

	//#endregion

	//#region rendering: clear

	function handleClear() {
		if (idleTimer != null) clearTimeout(idleTimer);
		idleTimer = null;
		originalEl.textContent = '';
		originalEl.classList.remove('st-interim-dim', 'st-fade-out');

		translationQueue.length = 0;
		translationBusy = false;
		if (translationFadeClearTimer != null) {
			clearTimeout(translationFadeClearTimer);
			translationFadeClearTimer = null;
		}
		translationEl.textContent = '';
		translationEl.classList.remove('st-fade-out');
	}

	//#endregion

	//#region streaming (raw WebSocket, no misskey-js dependency)

	let ws = null;
	let intentionalClose = false;
	let reconnectDelay = RECONNECT_BASE_DELAY;
	let resolveTimer = null;

	function wsUrl() {
		const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
		return `${proto}//${location.host}/streaming`;
	}

	function scheduleReconnect(userId) {
		setTimeout(() => openSocket(userId), reconnectDelay);
		reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_DELAY);
	}

	function openSocket(userId) {
		intentionalClose = false;
		const connId = `st-${Math.random().toString(36).slice(2)}`;
		ws = new WebSocket(wsUrl());

		ws.addEventListener('open', () => {
			reconnectDelay = RECONNECT_BASE_DELAY;
			ws.send(JSON.stringify({
				type: 'connect',
				body: { channel: 'liveSubtitle', id: connId, params: { userId } },
			}));
		});

		ws.addEventListener('message', (ev) => {
			let data;
			try {
				data = JSON.parse(ev.data);
			} catch {
				return;
			}
			if (data.type !== 'channel' || data.body?.id !== connId) return;
			const inner = data.body.body;
			switch (data.body.type) {
				case 'caption':
					handleCaption(inner);
					break;
				case 'translation':
					handleTranslation(inner);
					break;
				case 'clear':
					handleClear();
					break;
			}
		});

		ws.addEventListener('close', () => {
			if (!intentionalClose) scheduleReconnect(userId);
		});

		ws.addEventListener('error', () => {
			ws?.close();
		});
	}

	//#endregion

	//#region demo (設定ビルダーのライブプレビュー用: acct解決/API/WS購読を一切行わず、
	// ダミーの caption (interim→final の逐次遷移) / translation を周期生成し、
	// 本番と同じ handleCaption/handleTranslation 経路にそのまま流す)

	const DEMO_SENTENCES = [
		{ text: 'こんにちは、今日の配信を始めます', translated: 'Hello, starting today\'s stream now' },
		{ text: '新しいマップに挑戦してみようと思います', translated: 'I\'m going to try the new map today' },
		{ text: 'コメントもどんどん読んでいきますね', translated: 'I\'ll be reading comments as we go' },
		{ text: 'それでは始めていきましょう', translated: 'Alright, let\'s get started' },
	];

	let demoCaptionId = 0;

	function runDemoCaption(index) {
		const sentence = DEMO_SENTENCES[index % DEMO_SENTENCES.length];
		const id = `demo-caption-${++demoCaptionId}`;
		const chars = Array.from(sentence.text);
		let shown = 0;

		function revealNext() {
			shown += Math.max(1, Math.floor(chars.length / 8));
			const isFinal = shown >= chars.length;
			const text = isFinal ? sentence.text : chars.slice(0, shown).join('');
			handleCaption({ id, text, isFinal });
			if (!isFinal) {
				setTimeout(revealNext, DEMO_CAPTION_INTERIM_INTERVAL);
			} else {
				const pause = DEMO_CAPTION_PAUSE_MIN + Math.random() * (DEMO_CAPTION_PAUSE_MAX - DEMO_CAPTION_PAUSE_MIN);
				setTimeout(() => runDemoCaption(index + 1), pause);
			}
		}

		revealNext();
	}

	function runDemoTranslation(index) {
		const sentence = DEMO_SENTENCES[index % DEMO_SENTENCES.length];
		handleTranslation({ text: sentence.translated });
		const delay = DEMO_TRANSLATION_INTERVAL_MIN + Math.random() * (DEMO_TRANSLATION_INTERVAL_MAX - DEMO_TRANSLATION_INTERVAL_MIN);
		setTimeout(() => runDemoTranslation(index + 1), delay);
	}

	function startDemo() {
		// 原文と翻訳は完全に独立したタイマーで駆動する (仕様どおり)
		setTimeout(() => runDemoCaption(0), DEMO_INITIAL_DELAY);
		setTimeout(() => runDemoTranslation(0), DEMO_INITIAL_DELAY);
	}

	//#endregion

	//#region bootstrap

	function scheduleResolveRetry() {
		if (resolveTimer != null) return;
		resolveTimer = setTimeout(() => {
			resolveTimer = null;
			connect();
		}, RESOLVE_RETRY_INTERVAL);
	}

	async function connect() {
		try {
			const user = await api('users/show', { username: acct.username, host: acct.host ?? undefined });
			openSocket(user.id);
		} catch {
			// ユーザー不明・一時的な取得失敗はポーリングで再試行する
			scheduleResolveRetry();
		}
	}

	if (config.demo) {
		startDemo();
	} else if (!acct.username) {
		// acct が解決できない場合は何もしない (壊れた URL で無限リトライしても意味がない)
	} else {
		connect();
	}

	//#endregion
})();
