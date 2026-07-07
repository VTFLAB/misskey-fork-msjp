/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

'use strict';

// OBS ブラウザソース用の匿名コメントジェネレーター。
// Misskey フロントエンド (Vue/vite) には一切依存しない、素の ES2020 単一ファイル。
// /live/:acct/comment-generator から acct を読み取り、users/show → twitch/streams/show →
// (必要なら) twitch/streams/comments で初期状態を作り、twitchLiveStream チャンネルを
// 生 WebSocket で購読してコメントを描画する。

(() => {
	const OFFLINE_POLL_INTERVAL = 60 * 1000;
	const RECONNECT_BASE_DELAY = 1000;
	const RECONNECT_MAX_DELAY = 30 * 1000;
	const DEMO_INITIAL_DELAY = 500;
	const DEMO_INTERVAL_MIN = 2000;
	const DEMO_INTERVAL_MAX = 3000;
	const DEMO_TRANSLATION_FILL_DELAY = 2000;

	//#region query params -> --cg-* CSS variables / behavior config

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

	const query = new URLSearchParams(location.search);

	const config = {
		mode: pickEnum(query.get('mode'), ['fade', 'stack'], 'fade'),
		limit: clampNumber(query.get('limit'), 8, 1, 50),
		duration: clampNumber(query.get('duration'), 12000, 0, 600000),
		order: pickEnum(query.get('order'), ['bottom', 'top'], 'bottom'),
		animIn: pickEnum(query.get('animIn'), ['slide', 'slideRight', 'fade', 'pop', 'none'], 'slide'),
		animOut: pickEnum(query.get('animOut'), ['fade', 'slideLeft', 'none'], 'fade'),
		animTime: clampNumber(query.get('animTime'), 300, 0, 5000),
		icon: pickBool(query.get('icon'), true),
		iconSize: clampNumber(query.get('iconSize'), 36, 12, 128),
		name: pickBool(query.get('name'), true),
		translation: pickBool(query.get('translation'), true),
		media: pickBool(query.get('media'), true),
		emojiScale: clampNumber(query.get('emojiScale'), 1.4, 0.5, 4),
		history: clampNumber(query.get('history'), 0, 0, 30),
		demo: pickBool(query.get('demo'), false),
	};

	const root = document.documentElement;
	root.style.setProperty('--cg-font-family', sanitizeFontFamily(query.get('font'), '"Hiragino Sans", "Segoe UI", Roboto, sans-serif'));
	root.style.setProperty('--cg-font-size', `${clampNumber(query.get('fontSize'), 16, 8, 96)}px`);
	root.style.setProperty('--cg-font-weight', /^(normal|bold|bolder|lighter|[1-9]00)$/.test(query.get('fontWeight') ?? '') ? query.get('fontWeight') : '700');
	root.style.setProperty('--cg-text-color', sanitizeColor(query.get('textColor'), '#ffffff'));
	root.style.setProperty('--cg-name-color', sanitizeColor(query.get('nameColor'), '#ffe08a'));
	root.style.setProperty('--cg-trans-color', sanitizeColor(query.get('transColor'), '#b9e3ff'));

	const bgColorRaw = query.get('bgColor');
	root.style.setProperty('--cg-bg-color', bgColorRaw === 'none' ? 'transparent' : sanitizeColor(bgColorRaw, 'rgba(0, 0, 0, 0.55)'));

	root.style.setProperty('--cg-outline-width', `${clampNumber(query.get('outline'), 0, 0, 20)}px`);
	root.style.setProperty('--cg-outline-color', sanitizeColor(query.get('outlineColor'), '#000000'));
	root.style.setProperty('--cg-radius', `${clampNumber(query.get('radius'), 8, 0, 100)}px`);
	root.style.setProperty('--cg-padding', `${clampNumber(query.get('padding'), 10, 0, 100)}px`);
	root.style.setProperty('--cg-gap', `${clampNumber(query.get('gap'), 8, 0, 100)}px`);
	root.style.setProperty('--cg-icon-size', `${config.iconSize}px`);
	root.style.setProperty('--cg-anim-time', `${config.animTime}ms`);
	root.style.setProperty('--cg-emoji-scale', String(config.emojiScale));

	//#endregion

	const containerEl = document.getElementById('comments');
	containerEl.classList.add(`cg-order-${config.order}`);

	//#region acct

	function parseAcct(raw) {
		const s = raw.startsWith('@') ? raw.slice(1) : raw;
		const [username, host] = s.split('@');
		return { username, host: host || null };
	}

	const pathParts = location.pathname.split('/').filter(Boolean);
	// /live/:acct/comment-generator
	const acctIndex = pathParts.indexOf('comment-generator') - 1;
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

	//#region emoji resolution

	const EMOJI_SHORTCODE_RE = /:([\w+-]+)(?:@([\w.-]+))?:/g;

	function emojiUrl(name, host) {
		const encodedName = encodeURIComponent(name);
		return host
			? `/emoji/${encodedName}@${encodeURIComponent(host)}.webp?fallback`
			: `/emoji/${encodedName}.webp?fallback`;
	}

	function appendEmojiImg(parent, src, alt) {
		const img = document.createElement('img');
		img.src = src;
		img.alt = alt;
		img.loading = 'lazy';
		img.className = 'cg-emoji';
		parent.appendChild(img);
	}

	// テキスト中の :shortcode: / :shortcode@host: を img に置換しつつ DOM を組み立てる (XSS 安全)
	function appendTextWithShortcodes(parent, text, fallbackHost, emojiMap) {
		EMOJI_SHORTCODE_RE.lastIndex = 0;
		let lastIndex = 0;
		let match;
		while ((match = EMOJI_SHORTCODE_RE.exec(text)) !== null) {
			if (match.index > lastIndex) {
				parent.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
			}
			const [whole, name, explicitHost] = match;
			if (emojiMap && !explicitHost && Object.prototype.hasOwnProperty.call(emojiMap, name)) {
				appendEmojiImg(parent, emojiMap[name], whole);
			} else {
				appendEmojiImg(parent, emojiUrl(name, explicitHost ?? fallbackHost), whole);
			}
			lastIndex = EMOJI_SHORTCODE_RE.lastIndex;
		}
		if (lastIndex < text.length) {
			parent.appendChild(document.createTextNode(text.slice(lastIndex)));
		}
	}

	function twitchEmoteUrl(emoteId, animated) {
		const format = animated ? 'animated' : 'static';
		return `https://static-cdn.jtvnw.net/emoticons/v2/${encodeURIComponent(emoteId)}/${format}/dark/2.0`;
	}

	function appendTwitchFragments(parent, comment) {
		const fragments = comment.fragments ?? [{ type: 'text', text: comment.text }];
		for (const frag of fragments) {
			if (frag.type === 'emote' && frag.emoteId) {
				appendEmojiImg(parent, twitchEmoteUrl(frag.emoteId, frag.animated), frag.text);
			} else {
				parent.appendChild(document.createTextNode(frag.text));
			}
		}
	}

	//#endregion

	//#region rendering

	function sourceClass(source) {
		return source === 'misskey' ? 'source-misskey' : source === 'remote-guest' ? 'source-remote-guest' : 'source-twitch';
	}

	function displayName(comment) {
		if (comment.source === 'misskey') return comment.user?.name || comment.user?.username || '?';
		if (comment.source === 'remote-guest') return comment.remoteGuest?.username ?? '?';
		return comment.twitchDisplayName || comment.twitchUserName || '?';
	}

	function avatarUrl(comment) {
		if (comment.source === 'misskey') return comment.user?.avatarUrl ?? null;
		if (comment.source === 'remote-guest') return comment.remoteGuest?.avatarUrl ?? null;
		return null;
	}

	function authorHost(comment) {
		return comment.user?.host ?? comment.remoteGuest?.host ?? null;
	}

	function buildIcon(comment) {
		const url = avatarUrl(comment);
		const wrap = document.createElement('div');
		wrap.className = 'cg-icon';
		if (url) {
			const img = document.createElement('img');
			img.src = url;
			img.alt = '';
			img.loading = 'lazy';
			wrap.appendChild(img);
		} else {
			const badge = document.createElement('div');
			badge.className = 'cg-icon-badge';
			badge.textContent = (displayName(comment)[0] || '?').toUpperCase();
			wrap.appendChild(badge);
		}
		return wrap;
	}

	function buildName(comment) {
		const nameEl = document.createElement('span');
		nameEl.className = 'cg-name';
		if (comment.source === 'misskey') {
			appendTextWithShortcodes(nameEl, displayName(comment), authorHost(comment), comment.user?.emojis ?? null);
		} else {
			nameEl.textContent = displayName(comment);
		}
		return nameEl;
	}

	function buildText(comment) {
		const textEl = document.createElement('span');
		textEl.className = 'cg-text';
		if (comment.source === 'twitch') {
			appendTwitchFragments(textEl, comment);
		} else {
			appendTextWithShortcodes(textEl, comment.text, authorHost(comment), null);
		}
		return textEl;
	}

	function buildTranslation(comment) {
		if (!comment.translatedText) return null;
		const transEl = document.createElement('div');
		transEl.className = 'cg-translation';
		transEl.textContent = comment.translatedText;
		return transEl;
	}

	function buildMedia(comment) {
		if (!comment.files || comment.files.length === 0) return null;
		const mediaEl = document.createElement('div');
		mediaEl.className = 'cg-media';
		for (const file of comment.files) {
			const src = file.thumbnailUrl || file.url;
			if (!src) continue;
			const img = document.createElement('img');
			img.src = src;
			img.alt = '';
			img.loading = 'lazy';
			img.className = file.isSensitive ? 'cg-media-thumb cg-sensitive' : 'cg-media-thumb';
			mediaEl.appendChild(img);
		}
		return mediaEl;
	}

	function buildCommentEl(comment) {
		const el = document.createElement('div');
		el.className = `cg-comment ${sourceClass(comment.source)}`;
		el.dataset.id = comment.id;

		const body = document.createElement('div');
		body.className = 'cg-body';

		if (config.icon) body.appendChild(buildIcon(comment));

		const main = document.createElement('div');
		main.className = 'cg-main';
		if (config.name) main.appendChild(buildName(comment));
		main.appendChild(buildText(comment));
		if (config.translation) {
			const trans = buildTranslation(comment);
			if (trans) main.appendChild(trans);
		}
		if (config.media) {
			const media = buildMedia(comment);
			if (media) main.appendChild(media);
		}
		body.appendChild(main);
		el.appendChild(body);
		return el;
	}

	//#endregion

	//#region comment lifecycle (mount / animate in / animate out / evict)

	const liveEntries = new Map(); // id -> { el, timer }

	function applyAnimIn(el) {
		if (config.animIn === 'none') return;
		el.classList.add(`cg-anim-in-${config.animIn}`);
	}

	function removeEntry(id, immediate) {
		const entry = liveEntries.get(id);
		if (!entry) return;
		liveEntries.delete(id);
		if (entry.timer != null) clearTimeout(entry.timer);

		const { el } = entry;
		if (immediate || config.animOut === 'none') {
			el.remove();
			return;
		}

		let done = false;
		const finish = () => {
			if (done) return;
			done = true;
			el.remove();
		};
		el.addEventListener('animationend', finish, { once: true });
		// アニメーションが発火しない環境向けのフォールバック (DOM リーク防止)
		setTimeout(finish, config.animTime + 500);
		el.classList.add(`cg-anim-out-${config.animOut}`);
	}

	function evictOldestIfOverLimit() {
		while (liveEntries.size > config.limit) {
			const oldestId = liveEntries.keys().next().value;
			removeEntry(oldestId, false);
		}
	}

	function mountComment(comment) {
		if (liveEntries.has(comment.id)) return;

		const el = buildCommentEl(comment);
		if (config.order === 'top') {
			containerEl.insertBefore(el, containerEl.firstChild);
		} else {
			containerEl.appendChild(el);
		}
		applyAnimIn(el);

		const entry = { el, timer: null };
		liveEntries.set(comment.id, entry);

		if (config.mode === 'fade' && config.duration > 0) {
			entry.timer = setTimeout(() => removeEntry(comment.id, false), config.duration);
		}

		evictOldestIfOverLimit();
	}

	function onCommentTranslated(payload) {
		const entry = liveEntries.get(payload.id);
		if (!entry) return; // 既に退出済みなら無視
		if (!config.translation) return;
		const main = entry.el.querySelector('.cg-main');
		if (!main || main.querySelector('.cg-translation')) return;
		const transEl = document.createElement('div');
		transEl.className = 'cg-translation cg-translation-fade-in';
		transEl.textContent = payload.translatedText;
		main.appendChild(transEl);
	}

	function clearAllComments() {
		for (const id of Array.from(liveEntries.keys())) {
			removeEntry(id, true);
		}
	}

	//#endregion

	//#region streaming (raw WebSocket, no misskey-js dependency)

	let ws = null;
	let intentionalClose = false;
	let reconnectDelay = RECONNECT_BASE_DELAY;
	let pollTimer = null;

	function wsUrl() {
		const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
		return `${proto}//${location.host}/streaming`;
	}

	function scheduleReconnect(streamId) {
		if (pollTimer != null) return;
		setTimeout(() => openSocket(streamId), reconnectDelay);
		reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_DELAY);
	}

	function openSocket(streamId) {
		intentionalClose = false;
		const connId = `cg-${Math.random().toString(36).slice(2)}`;
		ws = new WebSocket(wsUrl());

		ws.addEventListener('open', () => {
			reconnectDelay = RECONNECT_BASE_DELAY;
			ws.send(JSON.stringify({
				type: 'connect',
				body: { channel: 'twitchLiveStream', id: connId, params: { streamId } },
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
				case 'comment':
					mountComment(inner);
					break;
				case 'commentTranslated':
					onCommentTranslated(inner);
					break;
				case 'streamEnded':
					handleStreamEnded();
					break;
			}
		});

		ws.addEventListener('close', () => {
			if (!intentionalClose) scheduleReconnect(streamId);
		});

		ws.addEventListener('error', () => {
			ws?.close();
		});
	}

	function closeSocket() {
		intentionalClose = true;
		if (ws) {
			ws.close();
			ws = null;
		}
	}

	function handleStreamEnded() {
		closeSocket();
		clearAllComments();
		schedulePoll();
	}

	function schedulePoll() {
		if (pollTimer != null) return;
		pollTimer = setTimeout(() => {
			pollTimer = null;
			connect();
		}, OFFLINE_POLL_INTERVAL);
	}

	//#endregion

	//#region demo (設定ダイアログのライブプレビュー用: acct解決/streams-show/WS購読/ポーリングを一切行わず、
	// ダミーコメントを周期生成して通常の mountComment/onCommentTranslated 経路にそのまま流す)

	const DEMO_FALLBACK_USER = { id: 'demo', username: 'demo_user', name: 'デモ太郎', host: null, avatarUrl: null, emojis: {} };

	let demoCounter = 0;
	function nextDemoId() {
		demoCounter += 1;
		return `demo-${demoCounter}`;
	}

	// 表示要件を網羅するダミーコメント集: misskey (カスタム絵文字ショートコード + Unicode絵文字/長文/絵文字のみ)、
	// twitch (fragments の text + emote)、remote-guest (username@host 形式)、翻訳付き、翻訳後埋め (fillTranslation) を含む
	function buildDemoTemplates(demoUser) {
		return [
			{ source: 'misskey', user: demoUser, text: ':igyo: 今日の配信も最高でした🎉👏' },
			{
				source: 'twitch',
				twitchDisplayName: 'twitch_viewer',
				twitchUserName: 'twitch_viewer',
				fragments: [
					{ type: 'text', text: 'それな ' },
					{ type: 'emote', emoteId: '25', text: 'Kappa' },
					{ type: 'text', text: ' w' },
				],
			},
			{
				source: 'remote-guest',
				remoteGuest: { username: 'guest_hanako@fedi.example.social', host: 'fedi.example.social', avatarUrl: null },
				text: 'はじめまして、応援しています!',
			},
			{
				source: 'misskey',
				user: demoUser,
				text: 'This is a longer test comment to check how word wrapping and multi-line layout behaves when the text keeps going for a while without stopping.',
				translatedText: 'これは折り返しや複数行レイアウトの崩れを確認するための長文テストコメントです。文章がしばらく途切れずに続きます。',
			},
			{ source: 'misskey', user: demoUser, text: '🎉🎊🥳' },
			{
				source: 'twitch',
				twitchDisplayName: 'another_fan',
				twitchUserName: 'another_fan',
				fragments: [
					{ type: 'emote', emoteId: '25', text: 'Kappa' },
					{ type: 'text', text: ' 神プレイ!!' },
				],
			},
			{
				source: 'misskey',
				user: demoUser,
				text: 'この後の展開も楽しみです',
				fillTranslation: 'Looking forward to what happens next',
			},
			{ source: 'twitch', twitchDisplayName: 'short_fan', twitchUserName: 'short_fan', fragments: [{ type: 'text', text: 'w' }] },
		];
	}

	function emitDemoComment(templates, index) {
		const { fillTranslation, ...template } = templates[index % templates.length];
		const id = nextDemoId();
		mountComment({ id, ...template });
		if (fillTranslation) {
			setTimeout(() => onCommentTranslated({ id, translatedText: fillTranslation }), DEMO_TRANSLATION_FILL_DELAY);
		}
		scheduleNextDemoComment(templates, index + 1);
	}

	function scheduleNextDemoComment(templates, index) {
		const delay = DEMO_INTERVAL_MIN + Math.random() * (DEMO_INTERVAL_MAX - DEMO_INTERVAL_MIN);
		setTimeout(() => emitDemoComment(templates, index), delay);
	}

	async function resolveDemoUser() {
		if (!acct.username) return DEMO_FALLBACK_USER;
		try {
			const user = await api('users/show', { username: acct.username, host: acct.host ?? undefined });
			return user ?? DEMO_FALLBACK_USER;
		} catch {
			return DEMO_FALLBACK_USER;
		}
	}

	async function startDemo() {
		const demoUser = await resolveDemoUser();
		const templates = buildDemoTemplates(demoUser);
		setTimeout(() => emitDemoComment(templates, 0), DEMO_INITIAL_DELAY);
	}

	//#endregion

	//#region bootstrap

	async function connect() {
		try {
			const user = await api('users/show', { username: acct.username, host: acct.host ?? undefined });
			const twitchInfo = await api('twitch/streams/show', { userId: user.id });

			if (twitchInfo.stream == null) {
				schedulePoll();
				return;
			}

			const streamId = twitchInfo.stream.id;

			if (config.history > 0) {
				const history = await api('twitch/streams/comments', { streamId, limit: config.history });
				for (const comment of history.slice().reverse()) {
					mountComment(comment);
				}
			}

			openSocket(streamId);
		} catch {
			// ユーザー不明・未連携・一時的な取得失敗はポーリングで再試行する
			schedulePoll();
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
