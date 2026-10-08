/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// bsky-fork: RemoteReactionService の純粋な部分。NoteEntityService からも使うので、
// サービス本体 (ReactionService などと循環 import になる) から切り離して置く。

export type RemoteReactionsSnapshot = {
	/** 取得時刻 (epoch ms) */
	fetchedAt: number;
	/** 自サーバーの表記 (自サーバーの絵文字は `:name@.:`、他サーバーは `:name@host:`、Unicode はそのまま) */
	reactions: Record<string, number>;
	/** `name@host` → 画像 URL */
	reactionEmojis: Record<string, string>;
};

export type RemoteReactionsDiff = {
	reactions: Record<string, number>;
	reactionEmojis: Record<string, string>;
};

/**
 * 自サーバーの集計と元サーバーの集計を合わせる (種類ごとに大きい方)。
 * 元サーバーの集計には自サーバーのユーザーのリアクションも含まれているので、足し算はしない。
 */
export function mergeRemoteReactions(local: RemoteReactionsDiff, remote: RemoteReactionsSnapshot | null | undefined): RemoteReactionsDiff {
	if (remote == null) return local;
	const reactions: Record<string, number> = { ...local.reactions };
	for (const [key, count] of Object.entries(remote.reactions)) {
		if (count <= 0) continue;
		reactions[key] = Math.max(reactions[key] ?? 0, count);
	}
	return {
		reactions,
		reactionEmojis: { ...remote.reactionEmojis, ...local.reactionEmojis },
	};
}

/**
 * 元サーバーの応答 (信用できない) から、数が正の整数で、キーが長すぎないものを数の多い順に上限件数だけ取り出す。
 */
export function pickReactionEntries(source: unknown, maxKinds: number, maxKeyLength: number): [string, number][] {
	if (source == null || typeof source !== 'object' || Array.isArray(source)) return [];
	const entries: [string, number][] = [];
	for (const [key, count] of Object.entries(source as Record<string, unknown>)) {
		if (typeof count !== 'number' || !Number.isSafeInteger(count) || count <= 0) continue;
		if (key.length === 0 || key.length > maxKeyLength) continue;
		entries.push([key, count]);
	}
	entries.sort((a, b) => b[1] - a[1]);
	return entries.slice(0, maxKinds);
}
