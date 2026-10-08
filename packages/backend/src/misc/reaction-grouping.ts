/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// bsky-fork: ホストが違うだけで画像が同じカスタム絵文字のリアクションを 1 つにまとめる (純粋な部分)。
// 画像の同一性 (identityOf) は EmojiImageIdentityService が決め、ここでは与えられた判定だけを使う。

export type GroupedReactions = {
	reactions: Record<string, number>;
	reactionEmojis: Record<string, string>;
	/** まとめられた元のキー → 代表のキー (まとめられなかったキーは含まない) */
	keyMap: Map<string, string>;
};

const CUSTOM_EMOJI_REACTION = /^:([-\w]+)@([\w.-]+):$/;

/**
 * 同じ画像のカスタム絵文字リアクションを合算する。代表のキーは、自サーバーの絵文字 (`@.`) → ノート投稿者の
 * サーバーの絵文字 → キーの辞書順で最初のもの、の順で決める (件数や入力順に依存させず、呼び出し元ごとに代表がずれないようにする)。
 * 並び順は元の順を保つ。
 */
export function groupReactionsByIdentity(
	reactions: Record<string, number>,
	reactionEmojis: Record<string, string>,
	identityOf: (key: string) => string | null,
	preferredHost: string | null = null,
): GroupedReactions {
	type Group = { members: [string, number][]; order: number };
	const groups = new Map<string, Group>();
	let order = 0;

	for (const [key, count] of Object.entries(reactions)) {
		let groupId = key;
		if (CUSTOM_EMOJI_REACTION.test(key)) {
			const identity = identityOf(key);
			if (identity != null) groupId = `image:${identity}`;
		}
		const group = groups.get(groupId);
		if (group) {
			group.members.push([key, count]);
		} else {
			groups.set(groupId, { members: [[key, count]], order: order++ });
		}
	}

	const grouped: Record<string, number> = {};
	const keyMap = new Map<string, string>();
	for (const group of [...groups.values()].sort((a, b) => a.order - b.order)) {
		if (group.members.length === 1) {
			const [key, count] = group.members[0];
			grouped[key] = count;
			continue;
		}
		const representative = group.members.find(([key]) => key.endsWith('@.:'))
			?? (preferredHost != null ? group.members.find(([key]) => key.endsWith(`@${preferredHost}:`)) : undefined)
			?? [...group.members].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))[0]; // 入力順にも依存しないよう、キーの辞書順で決める
		const total = group.members.reduce((sum, [, count]) => sum + count, 0);
		grouped[representative[0]] = total;
		for (const [key] of group.members) {
			if (key !== representative[0]) keyMap.set(key, representative[0]);
		}
	}

	return { reactions: grouped, reactionEmojis, keyMap };
}
