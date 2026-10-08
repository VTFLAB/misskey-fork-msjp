/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { onUnmounted } from 'vue';
import * as Misskey from 'misskey-js';
import type { ReactiveNoteData } from '@/composables/use-note-capture.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { prefer } from '@/preferences.js';
import { $i } from '@/i.js';

// bsky-fork 独自: リモートノートのリアクションを元サーバーから取得して表示に反映する。
// ノートが表示されるたびに 1 件ずつ API を呼ぶのではなく、短い時間にまとまった分を 1 回の
// notes/remote-reactions (最大 100 件) にまとめる。結果は use-note-capture の $note に書き戻す。

type RemoteReactionsItem = Misskey.entities.NotesRemoteReactionsResponse[number];
type Listener = (item: RemoteReactionsItem) => void;

const BATCH_DELAY_MS = 250;
const BATCH_MAX = 100;

const pending = new Map<string, Set<Listener>>();
let flushTimer: number | null = null;

function flush(): void {
	flushTimer = null;
	const entries = [...pending.entries()];
	pending.clear();

	for (let i = 0; i < entries.length; i += BATCH_MAX) {
		const chunk = new Map(entries.slice(i, i + BATCH_MAX));
		misskeyApi('notes/remote-reactions', {
			noteIds: [...chunk.keys()],
		}).then((items) => {
			for (const item of items) {
				const listeners = chunk.get(item.id);
				if (listeners == null) continue;
				for (const listener of listeners) listener(item);
			}
		}).catch(() => {
			// 取得できなくても自サーバーの集計はすでに表示されているので何もしない
		});
	}
}

function enqueue(noteId: string, listener: Listener): () => void {
	let listeners = pending.get(noteId);
	if (listeners == null) {
		listeners = new Set();
		pending.set(noteId, listeners);
	}
	listeners.add(listener);
	flushTimer ??= window.setTimeout(flush, BATCH_DELAY_MS);
	return () => {
		listeners.delete(listener);
	};
}

/**
 * 自サーバーの表記に揃える (use-note-capture の初期化と同じ正規化)
 */
function normalizeReactions(reactions: Misskey.entities.Note['reactions']): Misskey.entities.Note['reactions'] {
	const result: Misskey.entities.Note['reactions'] = {};
	for (const [name, count] of Object.entries(reactions)) {
		const normalizedName = name.replace(/^:(\w+):$/, ':$1@.:');
		result[normalizedName] = (result[normalizedName] ?? 0) + count;
	}
	return result;
}

export function useRemoteReactions(props: {
	note: Misskey.entities.Note;
	$note: ReactiveNoteData;
	mock?: boolean;
}): void {
	const { note, $note, mock } = props;

	if (mock) return;
	if ($i == null) return;
	if (!prefer.s.fetchRemoteReactions) return;
	if (note.user.host == null) return;
	if (note.uri == null || !note.uri.startsWith('https://')) return;

	let unmounted = false;

	const dispose = enqueue(note.id, (item) => {
		if (unmounted) return;
		const reactions = normalizeReactions(item.reactions);
		$note.reactions = reactions;
		$note.reactionCount = Object.values(reactions).reduce((a, b) => a + b, 0);
		$note.reactionEmojis = { ...$note.reactionEmojis, ...item.reactionEmojis };
	});

	onUnmounted(() => {
		unmounted = true;
		dispose();
	});
}
