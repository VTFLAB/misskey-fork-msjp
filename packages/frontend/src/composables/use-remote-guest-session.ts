/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { ref } from 'vue';
import { miLocalStorage } from '@/local-storage.js';
import { misskeyApi } from '@/utility/misskey-api.js';

// リモートMisskeyインスタンスのアカウントでログインしたゲストのセッション。
// $i (ローカルログイン) とは完全に別体系。Cookie は使わず、リクエスト毎に
// guestToken を明示的に body param として送る (misskeyApi は credentials: 'omit' 固定のため)。
export type RemoteGuestSession = {
	token: string;
	expiresAt: string; // ISO 8601
	acct: string; // "username@host"
};

function load(): RemoteGuestSession | null {
	const saved = miLocalStorage.getItemAsJson('remoteGuestSession') as RemoteGuestSession | undefined;
	if (saved == null) return null;
	if (new Date(saved.expiresAt).getTime() <= Date.now()) {
		miLocalStorage.removeItem('remoteGuestSession');
		return null;
	}
	return saved;
}

export const remoteGuestSession = ref<RemoteGuestSession | null>(load());

export function saveRemoteGuestSession(session: RemoteGuestSession) {
	miLocalStorage.setItemAsJson('remoteGuestSession', session);
	remoteGuestSession.value = session;
}

export function clearRemoteGuestSession() {
	const current = remoteGuestSession.value;
	miLocalStorage.removeItem('remoteGuestSession');
	remoteGuestSession.value = null;
	if (current != null) {
		// ベストエフォート (失敗してもローカルの状態は既にクリア済み)
		misskeyApi('remote-guest/session/revoke', { guestToken: current.token }).catch(() => {});
	}
}

/**
 * リモートインスタンスの MiAuth へリダイレクトするための URL を取得し、遷移する。
 * @param acct "username@host" 形式
 * @param returnTo "/live/" 始まりの相対パス
 */
export async function startRemoteGuestLogin(acct: string, returnTo: string): Promise<void> {
	const { url } = await misskeyApi('remote-guest/login/start', { acct, returnTo });
	window.location.href = url;
}
