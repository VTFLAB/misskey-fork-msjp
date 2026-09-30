/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// 常駐オーディオプレイヤーのプレイリスト (bsky-fork 独自)。
// アカウントのレジストリに保存し、端末をまたいで共有する。1 プレイリスト = 1 キーにして
// 1 リクエストの body 上限 (1MB) に全プレイリストが収まらなくなるのを避け、並び順と名前は
// インデックス用のキーにまとめて持つ。

import { reactive } from 'vue';
import * as Misskey from 'misskey-js';
import { $i } from '@/i.js';
import { i18n } from '@/i18n.js';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { genId } from '@/utility/id.js';
import type { AudioTrack } from '@/utility/audio-player.js';

const REGISTRY_SCOPE = ['client', 'audioPlayer'];
const INDEX_KEY = 'playlists';
const playlistKey = (id: string) => `playlist:${id}`;

export const PLAYLIST_NAME_MAX_LENGTH = 64;
export const PLAYLIST_MAX_TRACKS = 500;
export const PLAYLIST_MAX_COUNT = 100;

export type AudioPlaylistSummary = {
	id: string;
	name: string;
	trackCount: number;
	updatedAt: number;
};

export type AudioPlaylist = {
	id: string;
	name: string;
	tracks: AudioTrack[];
	updatedAt: number;
};

export const audioPlaylistsState = reactive({
	loaded: false,
	list: [] as AudioPlaylistSummary[],
});

// misskeyApi の reject 値は Error ではなく API エラーオブジェクト ({ code, message, ... }) のことがあり、
// body 上限超過などでは undefined にもなる
export function errorMessage(err: unknown): string {
	if (err instanceof Error) return err.message;
	if (err != null && typeof err === 'object' && 'message' in err && typeof err.message === 'string') return err.message;
	return i18n.ts.somethingHappened;
}

export function canUsePlaylists(): boolean {
	return $i != null;
}

async function registryGet<T>(key: string): Promise<T | null> {
	try {
		return await misskeyApi('i/registry/get', { scope: REGISTRY_SCOPE, key }) as T;
	} catch (err) {
		if (err != null && typeof err === 'object' && 'code' in err && err.code === 'NO_SUCH_KEY') return null;
		throw err;
	}
}

async function registrySet(key: string, value: unknown): Promise<void> {
	await misskeyApi('i/registry/set', { scope: REGISTRY_SCOPE, key, value });
}

async function registryRemove(key: string): Promise<void> {
	try {
		await misskeyApi('i/registry/remove', { scope: REGISTRY_SCOPE, key });
	} catch (err) {
		if (err != null && typeof err === 'object' && 'code' in err && err.code === 'NO_SUCH_KEY') return;
		throw err;
	}
}

// 同じタブ内で書き込みが追い越さないよう、変更操作は直列に実行する
let writeChain: Promise<unknown> = Promise.resolve();

function serialize<T>(fn: () => Promise<T>): Promise<T> {
	const run = writeChain.then(fn, fn);
	writeChain = run.catch(() => undefined);
	return run;
}

// 保存用に、再生・表示・NowPlaying に必要な項目だけを残した軽量なスナップショットにする。
// DriveFile / UserLite を丸ごと保存すると 1 曲 2KB 前後になり、API の body 上限 (1MB) に近づくため。
// 再生キュー用の qid も保存しない。
function toStoredTrack(track: AudioTrack): AudioTrack {
	if (track.kind === 'youtube') {
		return { kind: 'youtube', id: track.id, youtube: { ...track.youtube } };
	}
	const file = track.file;
	const user = track.user ?? null;
	return {
		id: track.id,
		file: {
			id: file.id,
			createdAt: file.createdAt,
			name: file.name,
			type: file.type,
			md5: file.md5,
			size: file.size,
			isSensitive: file.isSensitive,
			blurhash: null,
			properties: {},
			url: file.url,
			thumbnailUrl: file.thumbnailUrl,
			comment: file.comment,
			folderId: null,
			folder: null,
			userId: null,
			user: null,
		} as Misskey.entities.DriveFile,
		user: user == null ? null : {
			id: user.id,
			name: user.name,
			username: user.username,
			host: user.host,
			avatarUrl: user.avatarUrl,
			avatarBlurhash: null,
			avatarDecorations: [],
			isBot: user.isBot,
			isCat: user.isCat,
			instance: user.instance != null ? { ...user.instance } : undefined,
			emojis: {},
			onlineStatus: 'unknown',
			badgeRoles: [],
		} as Misskey.entities.UserLite,
		noteId: track.noteId,
		noteUrl: track.noteUrl ?? null,
	};
}

async function readIndex(): Promise<AudioPlaylistSummary[]> {
	const list = await registryGet<AudioPlaylistSummary[]>(INDEX_KEY);
	return Array.isArray(list) ? list : [];
}

// インデックスは他の端末・タブからも書き換えられるので、変更のたびにサーバーから読み直してから書き込む
// (手元のキャッシュを元に書くと、よそで作られたプレイリストを一覧から消してしまう)
async function mutateIndex(fn: (list: AudioPlaylistSummary[]) => AudioPlaylistSummary[]): Promise<void> {
	const next = fn(await readIndex());
	await registrySet(INDEX_KEY, next);
	audioPlaylistsState.list = next;
	audioPlaylistsState.loaded = true;
}

export function fetchPlaylists(): Promise<void> {
	return serialize(async () => {
		if (!canUsePlaylists()) return;
		audioPlaylistsState.list = await readIndex();
		audioPlaylistsState.loaded = true;
	});
}

export async function getPlaylist(id: string): Promise<AudioPlaylist | null> {
	const playlist = await registryGet<AudioPlaylist>(playlistKey(id));
	if (playlist == null || !Array.isArray(playlist.tracks)) return null;
	return playlist;
}

export function createPlaylist(name: string, tracks: AudioTrack[] = []): Promise<AudioPlaylist> {
	return serialize(async () => {
		if ((await readIndex()).length >= PLAYLIST_MAX_COUNT) {
			throw new Error(i18n.tsx._audioPlayer.tooManyPlaylists({ max: PLAYLIST_MAX_COUNT }));
		}
		const playlist: AudioPlaylist = {
			id: genId(),
			name: name.slice(0, PLAYLIST_NAME_MAX_LENGTH),
			tracks: tracks.slice(0, PLAYLIST_MAX_TRACKS).map(toStoredTrack),
			updatedAt: Date.now(),
		};
		await registrySet(playlistKey(playlist.id), playlist);
		await mutateIndex(list => [...list, {
			id: playlist.id,
			name: playlist.name,
			trackCount: playlist.tracks.length,
			updatedAt: playlist.updatedAt,
		}]);
		return playlist;
	});
}

async function writePlaylist(playlist: AudioPlaylist): Promise<AudioPlaylist> {
	const saved: AudioPlaylist = {
		...playlist,
		tracks: playlist.tracks.slice(0, PLAYLIST_MAX_TRACKS).map(toStoredTrack),
		updatedAt: Date.now(),
	};
	await registrySet(playlistKey(saved.id), saved);
	const summary: AudioPlaylistSummary = {
		id: saved.id,
		name: saved.name,
		trackCount: saved.tracks.length,
		updatedAt: saved.updatedAt,
	};
	await mutateIndex(list => list.some(x => x.id === saved.id)
		? list.map(x => x.id === saved.id ? summary : x)
		: [...list, summary]);
	return saved;
}

export function setPlaylistTracks(id: string, tracks: AudioTrack[]): Promise<AudioPlaylist | null> {
	return serialize(async () => {
		const playlist = await getPlaylist(id);
		if (playlist == null) return null;
		return writePlaylist({ ...playlist, tracks });
	});
}

// 上限を超える分は追加しない。実際に追加できた曲数を返す
export function addTracksToPlaylist(id: string, tracks: AudioTrack[]): Promise<number> {
	return serialize(async () => {
		const playlist = await getPlaylist(id);
		if (playlist == null) return 0;
		const room = Math.max(0, PLAYLIST_MAX_TRACKS - playlist.tracks.length);
		const adding = tracks.slice(0, room);
		if (adding.length > 0) {
			await writePlaylist({ ...playlist, tracks: [...playlist.tracks, ...adding] });
		}
		return adding.length;
	});
}

export function renamePlaylist(id: string, name: string): Promise<void> {
	return serialize(async () => {
		const playlist = await getPlaylist(id);
		if (playlist == null) return;
		await writePlaylist({ ...playlist, name: name.slice(0, PLAYLIST_NAME_MAX_LENGTH) });
	});
}

export function deletePlaylist(id: string): Promise<void> {
	return serialize(async () => {
		await registryRemove(playlistKey(id));
		await mutateIndex(list => list.filter(x => x.id !== id));
	});
}

// 並び順だけを反映する。よそで追加されたものは末尾に残し、削除されたものは落とす
export function reorderPlaylists(orderedIds: string[]): Promise<void> {
	return serialize(async () => {
		await mutateIndex(list => {
			const rank = new Map(orderedIds.map((id, i) => [id, i]));
			return [...list].sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
		});
	});
}

export async function promptPlaylistName(defaultName?: string): Promise<string | null> {
	const { canceled, result } = await os.inputText({
		title: i18n.ts._audioPlayer.playlistName,
		default: defaultName ?? '',
		minLength: 1,
		maxLength: PLAYLIST_NAME_MAX_LENGTH,
	});
	if (canceled) return null;
	const name = result.trim();
	return name === '' ? null : name;
}

// 新規作成か既存プレイリストへの追加かを選ばせて、トラックを保存する
export async function pickPlaylistAndAdd(tracks: AudioTrack[]): Promise<void> {
	if (!canUsePlaylists() || tracks.length === 0) return;

	try {
		await fetchPlaylists();
	} catch (err) {
		os.alert({ type: 'error', text: errorMessage(err) });
		return;
	}

	const NEW = '__new__';
	const { canceled, result } = await os.select({
		title: i18n.ts._audioPlayer.addToPlaylist,
		items: [
			{ value: NEW, label: i18n.ts._audioPlayer.newPlaylist },
			...audioPlaylistsState.list.map(x => ({ value: x.id, label: `${x.name} (${x.trackCount})` })),
		],
		default: audioPlaylistsState.list.length > 0 ? audioPlaylistsState.list[0].id : NEW,
	});
	if (canceled || result == null) return;

	try {
		if (result === NEW) {
			const name = await promptPlaylistName();
			if (name == null) return;
			await createPlaylist(name, tracks);
			os.toast(tracks.length > PLAYLIST_MAX_TRACKS
				? i18n.tsx._audioPlayer.playlistFull({ max: PLAYLIST_MAX_TRACKS })
				: i18n.ts._audioPlayer.addedToPlaylist);
		} else {
			const added = await addTracksToPlaylist(result, tracks);
			os.toast(added < tracks.length
				? i18n.tsx._audioPlayer.playlistFull({ max: PLAYLIST_MAX_TRACKS })
				: i18n.ts._audioPlayer.addedToPlaylist);
		}
	} catch (err) {
		os.alert({ type: 'error', text: errorMessage(err) });
	}
}
