/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// このタブで音を出すもの (常駐オーディオプレイヤー、ラジオ) の受け持ち (bsky-fork 独自)。
// どれかが再生を始めたら、ほかのものを止める。各モジュールは読み込まれたときに自分を登録するだけで、
// 互いを import しない (使っていない側のモジュールまで読み込ませないため)

export type AudioFocusOwner = 'audioPlayer' | 'radio';

const onLostHandlers = new Map<AudioFocusOwner, () => void>();
let current: AudioFocusOwner | null = null;

export function registerAudioFocus(owner: AudioFocusOwner, onLost: () => void): void {
	onLostHandlers.set(owner, onLost);
}

// 受け持ちを得る。ほかのものから受け持ちを移したときは true を返す
export function claimAudioFocus(owner: AudioFocusOwner): boolean {
	if (current === owner) return false;
	const previous = current;
	current = owner;
	if (previous != null) onLostHandlers.get(previous)?.();
	return true;
}

export function releaseAudioFocus(owner: AudioFocusOwner): void {
	if (current === owner) current = null;
}
