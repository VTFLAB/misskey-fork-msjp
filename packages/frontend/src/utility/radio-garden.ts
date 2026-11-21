/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// ラジオウィジェットのデータ (bsky-fork 独自)。Radio Garden の地点・局・検索はサーバーの api/radio-garden/* が中継する。
// - 地点の一覧 (約 1.3 万件) は IndexedDB に 1 日置き、ページを開くたびには取り直さない
// - お気に入りの局はアカウントのレジストリに保存し、端末をまたいで共有する

import { reactive } from 'vue';
import * as Misskey from 'misskey-js';
import { $i } from '@/i.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { get as idbGet, set as idbSet } from '@/utility/idb-proxy.js';

export type RadioChannel = Misskey.entities.RadioGardenChannelsResponse['channels'][number];
export type RadioPlaceChannels = Misskey.entities.RadioGardenChannelsResponse;
export type RadioSearchResult = Misskey.entities.RadioGardenSearchResponse;

export type RadioPlaces = {
	count: number;
	ids: string[];
	titles: string[];
	countries: string[];
	countryIndex: number[];
	lon: Float32Array;
	lat: Float32Array;
	sizes: Uint16Array;
	// 単位球上の位置 (x: 東経 90 度、y: 北極、z: 経度 0 度の赤道)
	x: Float32Array;
	y: Float32Array;
	z: Float32Array;
	indexOf: Map<string, number>;
};

const PLACES_CACHE_KEY = 'mkRadioGardenPlaces';
const PLACES_CACHE_TTL_MS = 1000 * 60 * 60 * 24;

type PlacesCache = {
	fetchedAt: number;
	data: Misskey.entities.RadioGardenPlacesResponse;
};

function buildPlaces(data: Misskey.entities.RadioGardenPlacesResponse): RadioPlaces {
	const count = Math.min(data.ids.length, data.titles.length, data.countryIndex.length, data.sizes.length, Math.floor(data.geo.length / 2));
	const lon = new Float32Array(count);
	const lat = new Float32Array(count);
	const sizes = new Uint16Array(count);
	const x = new Float32Array(count);
	const y = new Float32Array(count);
	const z = new Float32Array(count);
	const indexOf = new Map<string, number>();
	const deg = Math.PI / 180;
	for (let i = 0; i < count; i++) {
		lon[i] = data.geo[i * 2];
		lat[i] = data.geo[i * 2 + 1];
		sizes[i] = Math.min(65535, Math.max(1, data.sizes[i]));
		const l = lon[i] * deg;
		const p = lat[i] * deg;
		x[i] = Math.cos(p) * Math.sin(l);
		y[i] = Math.sin(p);
		z[i] = Math.cos(p) * Math.cos(l);
		indexOf.set(data.ids[i], i);
	}
	return {
		count,
		ids: data.ids.slice(0, count),
		titles: data.titles.slice(0, count),
		countries: data.countries,
		countryIndex: data.countryIndex.slice(0, count),
		lon, lat, sizes, x, y, z,
		indexOf,
	};
}

let placesPromise: Promise<RadioPlaces> | null = null;

export function loadRadioPlaces(): Promise<RadioPlaces> {
	placesPromise ??= (async () => {
		const cached = await (idbGet(PLACES_CACHE_KEY) as Promise<PlacesCache | undefined>).catch(() => undefined);
		if (cached != null && Date.now() - cached.fetchedAt < PLACES_CACHE_TTL_MS) return buildPlaces(cached.data);
		try {
			const data = await misskeyApi('radio-garden/places');
			idbSet(PLACES_CACHE_KEY, { fetchedAt: Date.now(), data } satisfies PlacesCache).catch(() => {});
			return buildPlaces(data);
		} catch (err) {
			// 取り直せなくても、古い一覧があればそれで描く
			if (cached != null) return buildPlaces(cached.data);
			throw err;
		}
	})().catch(err => {
		placesPromise = null;
		throw err;
	});
	return placesPromise;
}

export function placeCountry(places: RadioPlaces, index: number): string {
	return places.countries[places.countryIndex[index]] ?? '';
}

const channelsCache = new Map<string, Promise<RadioPlaceChannels>>();

export function fetchPlaceChannels(placeId: string): Promise<RadioPlaceChannels> {
	let p = channelsCache.get(placeId);
	if (p == null) {
		p = misskeyApi('radio-garden/channels', { placeId });
		p.catch(() => channelsCache.delete(placeId));
		channelsCache.set(placeId, p);
		// 回して選ぶとたくさん開くので、古いものから捨てる
		if (channelsCache.size > 100) {
			const oldest = channelsCache.keys().next().value;
			if (oldest != null) channelsCache.delete(oldest);
		}
	}
	return p;
}

export function searchRadio(query: string): Promise<RadioSearchResult> {
	return misskeyApi('radio-garden/search', { query });
}

export function channelSubtitle(channel: RadioChannel): string {
	return [channel.placeTitle, channel.country].filter(x => x !== '').join(', ');
}

// ---- お気に入り ----

const REGISTRY_SCOPE = ['client', 'radio'];
const FAVORITES_KEY = 'favorites';
export const RADIO_FAVORITES_MAX = 200;

export const radioFavoritesState = reactive({
	loaded: false,
	list: [] as RadioChannel[],
});

function isRadioChannel(value: unknown): value is RadioChannel {
	if (value == null || typeof value !== 'object') return false;
	const v = value as Record<string, unknown>;
	return typeof v.id === 'string' && typeof v.title === 'string';
}

// レジストリの値は古い版や別の端末が書いたものかもしれないので、欠けた項目を補う
function normalizeChannel(c: Partial<RadioChannel> & Pick<RadioChannel, 'id' | 'title'>): RadioChannel {
	return {
		id: c.id,
		title: c.title,
		placeId: c.placeId ?? null,
		placeTitle: c.placeTitle ?? '',
		country: c.country ?? '',
		secure: c.secure === true,
	};
}

export function canUseRadioFavorites(): boolean {
	return $i != null;
}

async function readFavorites(): Promise<RadioChannel[]> {
	try {
		const value = await misskeyApi('i/registry/get', { scope: REGISTRY_SCOPE, key: FAVORITES_KEY });
		return Array.isArray(value) ? value.filter(isRadioChannel).map(normalizeChannel) : [];
	} catch (err) {
		if (err != null && typeof err === 'object' && 'code' in err && err.code === 'NO_SUCH_KEY') return [];
		throw err;
	}
}

// 同じタブ内で書き込みが追い越さないよう、変更は直列に行う。よその端末での変更を消さないよう、毎回読み直してから書く
let writeChain: Promise<unknown> = Promise.resolve();

function serialize<T>(fn: () => Promise<T>): Promise<T> {
	const run = writeChain.then(fn, fn);
	writeChain = run.catch(() => undefined);
	return run;
}

export function fetchRadioFavorites(): Promise<void> {
	return serialize(async () => {
		if (!canUseRadioFavorites()) return;
		radioFavoritesState.list = await readFavorites();
		radioFavoritesState.loaded = true;
	});
}

export function isRadioFavorite(channelId: string): boolean {
	return radioFavoritesState.list.some(x => x.id === channelId);
}

export function setRadioFavorite(channel: RadioChannel, favorite: boolean): Promise<void> {
	// 押した直後に表示を変え、保存できなかったら戻す
	const before = radioFavoritesState.list;
	radioFavoritesState.list = favorite
		? [normalizeChannel(channel), ...before.filter(x => x.id !== channel.id)].slice(0, RADIO_FAVORITES_MAX)
		: before.filter(x => x.id !== channel.id);
	return serialize(async () => {
		const latest = (await readFavorites()).filter(x => x.id !== channel.id);
		const next = favorite ? [normalizeChannel(channel), ...latest].slice(0, RADIO_FAVORITES_MAX) : latest;
		await misskeyApi('i/registry/set', { scope: REGISTRY_SCOPE, key: FAVORITES_KEY, value: next });
		radioFavoritesState.list = next;
		radioFavoritesState.loaded = true;
	}).catch(err => {
		radioFavoritesState.list = before;
		throw err;
	});
}
