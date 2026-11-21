<!--
SPDX-FileCopyrightText: misskey-bsky-integration fork
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div class="_panel mkw-radio" :class="$style.root">
	<div :class="$style.globeArea" :style="{ height: `${widgetProps.height}px` }">
		<XGlobe ref="globeEl" :places="places" :selectedIndex="selectedIndex" :playingIndex="playingIndex" @settle="onSettle"/>
		<div v-if="placesError" :class="$style.globeMessage">
			<span>{{ i18n.ts._radio.unavailable }}</span>
			<button class="_button" :class="$style.retry" @click="loadPlaces">{{ i18n.ts.retry }}</button>
		</div>
		<div v-else-if="places == null" :class="$style.globeMessage">
			<MkLoading :em="true"/>
		</div>
		<div :class="$style.zoomButtons">
			<button v-tooltip="i18n.ts._radio.zoomIn" class="_button" :class="$style.zoomButton" :aria-label="i18n.ts._radio.zoomIn" @click="globeEl?.zoomBy(1.6)"><i class="ti ti-plus"></i></button>
			<button v-tooltip="i18n.ts._radio.zoomOut" class="_button" :class="$style.zoomButton" :aria-label="i18n.ts._radio.zoomOut" @click="globeEl?.zoomBy(1 / 1.6)"><i class="ti ti-minus"></i></button>
		</div>
		<div aria-live="polite">
			<div v-if="selectedPlace != null" :class="$style.placeLabel">
				<div :class="$style.placeTitle">{{ selectedPlace.title }}</div>
				<div :class="$style.placeSub">{{ selectedPlace.country }}<template v-if="selectedPlace.size > 0"> · {{ i18n.tsx._radio.stationCount({ n: selectedPlace.size }) }}</template></div>
			</div>
		</div>
	</div>

	<div :class="$style.tabs" role="tablist">
		<button
			v-for="t in tabs"
			:key="t.key"
			role="tab"
			:aria-selected="tab === t.key"
			class="_button"
			:class="[$style.tab, { [$style.tabActive]: tab === t.key }]"
			@click="tab = t.key"
		>
			<i :class="t.icon"></i>
			<span>{{ t.label }}</span>
		</button>
	</div>

	<div :class="$style.listArea" role="tabpanel">
		<template v-if="tab === 'place'">
			<div v-if="selectedIndex == null" :class="$style.empty">{{ i18n.ts._radio.selectPlace }}</div>
			<MkLoading v-else-if="placeLoading"/>
			<div v-else-if="placeError" :class="$style.empty">{{ i18n.ts._radio.unavailable }}</div>
			<div v-else-if="placeChannels.length === 0" :class="$style.empty">{{ i18n.ts._radio.noResults }}</div>
			<XChannels v-else :channels="placeChannels" :showPlace="false" @play="c => play(c, placeChannels)"/>
		</template>

		<template v-else-if="tab === 'search'">
			<MkInput v-model="query" type="search" :debounce="400" :placeholder="i18n.ts._radio.searchPlaceholder" :small="true" :class="$style.search">
				<template #prefix><i class="ti ti-search"></i></template>
			</MkInput>
			<MkLoading v-if="searching"/>
			<div v-else-if="searchError" :class="$style.empty">{{ i18n.ts._radio.unavailable }}</div>
			<template v-else-if="searchResult != null">
				<div v-if="searchResult.places.length === 0 && searchResult.channels.length === 0" :class="$style.empty">{{ i18n.ts._radio.noResults }}</div>
				<template v-if="searchResult.places.length > 0">
					<div :class="$style.sectionLabel">{{ i18n.ts._radio.places }}</div>
					<button v-for="p in searchResult.places" :key="p.id" class="_button" :class="$style.placeRow" @click="goToPlace(p.id)">
						<i class="ti ti-map-pin" :class="$style.placeRowIcon"></i>
						<span :class="$style.placeRowText">
							<span :class="$style.placeRowTitle">{{ p.title }}</span>
							<span :class="$style.placeRowSub">{{ p.country }}<template v-if="p.count > 0"> · {{ i18n.tsx._radio.stationCount({ n: p.count }) }}</template></span>
						</span>
					</button>
				</template>
				<template v-if="searchResult.channels.length > 0">
					<div :class="$style.sectionLabel">{{ i18n.ts._radio.stations }}</div>
					<XChannels :channels="searchResult.channels" @play="c => play(c, searchResult?.channels)"/>
				</template>
			</template>
		</template>

		<template v-else>
			<div v-if="!canFavorite" :class="$style.empty">{{ i18n.ts._radio.signInForFavorites }}</div>
			<MkLoading v-else-if="!radioFavoritesState.loaded && favoritesLoading"/>
			<div v-else-if="radioFavoritesState.list.length === 0" :class="$style.empty">{{ i18n.ts._radio.noFavorites }}</div>
			<XChannels v-else :channels="radioFavoritesState.list" @play="c => play(c, radioFavoritesState.list)"/>
		</template>
	</div>

	<div :class="$style.player">
		<button
			class="_button"
			:class="$style.playButton"
			:disabled="radioState.channel == null"
			:aria-label="active ? i18n.ts._radio.stop : i18n.ts._radio.play"
			@click="toggleRadio"
		>
			<MkLoading v-if="radioState.status === 'connecting'" :em="true" :class="$style.playLoading"/>
			<i v-else-if="active" class="ti ti-player-stop-filled"></i>
			<i v-else class="ti ti-player-play-filled"></i>
		</button>
		<div :class="$style.now" role="status">
			<div :class="$style.nowTitle">{{ radioState.channel?.title ?? i18n.ts._radio.notPlaying }}</div>
			<div :class="[$style.nowSub, { [$style.nowError]: radioState.status === 'error' }]">{{ statusText }}</div>
		</div>
		<button v-tooltip="i18n.ts._radio.previous" class="_button" :class="$style.iconButton" :disabled="radioState.queue.length < 2" :aria-label="i18n.ts._radio.previous" @click="stepRadio(-1)"><i class="ti ti-player-skip-back"></i></button>
		<button v-tooltip="i18n.ts._radio.next" class="_button" :class="$style.iconButton" :disabled="radioState.queue.length < 2" :aria-label="i18n.ts._radio.next" @click="stepRadio(1)"><i class="ti ti-player-skip-forward"></i></button>
		<button
			v-if="canFavorite && radioState.channel != null"
			v-tooltip="currentFavorite ? i18n.ts._radio.removeFavorite : i18n.ts._radio.addFavorite"
			class="_button"
			:class="[$style.iconButton, { [$style.favOn]: currentFavorite }]"
			:aria-label="i18n.ts._radio.favorite"
			:aria-pressed="currentFavorite"
			@click="toggleCurrentFavorite"
		>
			<i :class="currentFavorite ? 'ti ti-heart-filled' : 'ti ti-heart'"></i>
		</button>
	</div>

	<div :class="$style.controls">
		<button v-tooltip="i18n.ts._radio.mute" class="_button" :class="$style.iconButton" :aria-label="i18n.ts._radio.mute" :aria-pressed="radioState.muted" @click="toggleRadioMute">
			<i :class="radioState.muted || radioState.volume === 0 ? 'ti ti-volume-3' : 'ti ti-volume'"></i>
		</button>
		<MkMediaRange v-model="volume" :ariaLabel="i18n.ts._radio.volume" :class="$style.volume"/>
		<button
			v-tooltip="normalizeText"
			class="_button"
			:class="[$style.normalizeButton, { [$style.normalizeOn]: radioState.normalize }]"
			:aria-label="i18n.ts._radio.normalize"
			aria-haspopup="menu"
			@click="openNormalizeMenu"
		>
			<i class="ti ti-adjustments-horizontal"></i>
			<span v-if="radioState.normalize && active && radioState.route !== 'plain'" :class="$style.gain">{{ gainLabel }}</span>
		</button>
	</div>

	<div :class="$style.footer">
		<a href="https://radio.garden" target="_blank" rel="noopener" :class="$style.credit">{{ i18n.ts._radio.source }}</a>
		<span v-if="radioState.route === 'proxy'" :class="$style.route">{{ i18n.ts._radio.viaServer }}</span>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed, onMounted, ref, shallowRef, useTemplateRef, watch } from 'vue';
import { useWidgetPropsManager } from './widget.js';
import XGlobe from './WidgetRadio.globe.vue';
import XChannels from './WidgetRadio.channels.vue';
import type { WidgetComponentEmits, WidgetComponentExpose, WidgetComponentProps } from './widget.js';
import type { FormWithDefault, GetFormResultType } from '@/utility/form.js';
import type { MenuItem } from '@/types/menu.js';
import type { RadioChannel, RadioPlaces, RadioSearchResult } from '@/utility/radio-garden.js';
import MkInput from '@/components/MkInput.vue';
import MkMediaRange from '@/components/MkMediaRange.vue';
import { i18n } from '@/i18n.js';
import * as os from '@/os.js';
import {
	canUseRadioFavorites,
	channelSubtitle,
	fetchPlaceChannels,
	fetchRadioFavorites,
	isRadioFavorite,
	loadRadioPlaces,
	placeCountry,
	radioFavoritesState,
	searchRadio,
	setRadioFavorite,
} from '@/utility/radio-garden.js';
import {
	RADIO_TARGET_OPTIONS,
	isRadioActive,
	playRadio,
	radioState,
	setRadioNormalize,
	setRadioTarget,
	setRadioVolume,
	stepRadio,
	toggleRadio,
	toggleRadioMute,
} from '@/utility/radio-player.js';

const name = 'radio';

const widgetPropsDef = {
	height: {
		type: 'number',
		label: i18n.ts._widgetOptions.height,
		default: 220,
	},
	tuneOnRotate: {
		type: 'boolean',
		label: i18n.ts._widgetOptions._radio.tuneOnRotate,
		default: true,
	},
} satisfies FormWithDefault;

type WidgetProps = GetFormResultType<typeof widgetPropsDef>;

const props = defineProps<WidgetComponentProps<WidgetProps>>();
const emit = defineEmits<WidgetComponentEmits<WidgetProps>>();

const { widgetProps, configure } = useWidgetPropsManager(name,
	widgetPropsDef,
	props,
	emit,
);

const LAST_PLACE_KEY = 'mkRadioLastPlace';
// 初めて開いたときに向ける場所 (東京)
const DEFAULT_LON = 139.69;
const DEFAULT_LAT = 35.69;

type Tab = 'place' | 'search' | 'favorites';
const tabs: { key: Tab; label: string; icon: string }[] = [
	{ key: 'place', label: i18n.ts._radio.here, icon: 'ti ti-map-pin' },
	{ key: 'search', label: i18n.ts.search, icon: 'ti ti-search' },
	{ key: 'favorites', label: i18n.ts._radio.favorites, icon: 'ti ti-heart' },
];
const tab = ref<Tab>('place');

const globeEl = useTemplateRef('globeEl');
const places = shallowRef<RadioPlaces | null>(null);
const placesError = ref(false);
const selectedIndex = ref<number | null>(null);
const placeChannels = shallowRef<RadioChannel[]>([]);
const placeLoading = ref(false);
const placeError = ref(false);
let placeSeq = 0;

const canFavorite = canUseRadioFavorites();
const favoritesLoading = ref(false);

const active = computed(() => radioState.status === 'playing' || radioState.status === 'connecting');

const selectedPlace = computed(() => {
	const p = places.value;
	const i = selectedIndex.value;
	if (p == null || i == null) return null;
	return { title: p.titles[i], country: placeCountry(p, i), size: p.sizes[i] };
});

const playingIndex = computed(() => {
	const p = places.value;
	const placeId = radioState.channel?.placeId;
	if (p == null || placeId == null || !active.value) return null;
	return p.indexOf.get(placeId) ?? null;
});

const currentFavorite = computed(() => radioState.channel != null && isRadioFavorite(radioState.channel.id));

const statusText = computed(() => {
	switch (radioState.status) {
		case 'connecting': return i18n.ts._radio.connecting;
		case 'error': return radioState.error ?? i18n.ts._radio.cannotPlay;
		default: return radioState.channel != null ? channelSubtitle(radioState.channel) : i18n.ts._radio.chooseStation;
	}
});

const volume = computed({
	get: () => radioState.volume,
	set: (v: number) => setRadioVolume(v),
});

function formatDb(db: number): string {
	const rounded = Math.round(db * 10) / 10;
	return `${rounded > 0 ? '+' : ''}${rounded.toFixed(1)} dB`;
}

const gainLabel = computed(() => formatDb(radioState.gainDb));

const normalizeText = computed(() => {
	if (!radioState.normalize) return i18n.tsx._radio.normalizeState({ state: i18n.ts.disabled });
	if (radioState.route === 'plain') return i18n.ts._radio.normalizeUnavailable;
	if (!active.value) return i18n.tsx._radio.normalizeState({ state: i18n.ts.enabled });
	if (radioState.measureState === 'failed') return i18n.ts._radio.measureFailed;
	if (radioState.measuredLufs == null) return i18n.ts._radio.measuring;
	return i18n.tsx._radio.measured({ lufs: radioState.measuredLufs.toFixed(1), gain: formatDb(radioState.gainDb) });
});

function writeLastPlace(id: string): void {
	try {
		window.localStorage.setItem(LAST_PLACE_KEY, id);
	} catch {
		// 保存できなくても続ける
	}
}

function readLastPlace(): string | null {
	try {
		return window.localStorage.getItem(LAST_PLACE_KEY);
	} catch {
		return null;
	}
}

function nearestPlace(p: RadioPlaces, lonDeg: number, latDeg: number): number | null {
	const l = lonDeg * Math.PI / 180;
	const q = latDeg * Math.PI / 180;
	const x = Math.cos(q) * Math.sin(l);
	const y = Math.sin(q);
	const z = Math.cos(q) * Math.cos(l);
	let best: number | null = null;
	let bestDot = -2;
	for (let i = 0; i < p.count; i++) {
		const d = p.x[i] * x + p.y[i] * y + p.z[i] * z;
		if (d > bestDot) {
			bestDot = d;
			best = i;
		}
	}
	return best;
}

async function loadPlaces(): Promise<void> {
	placesError.value = false;
	try {
		const p = await loadRadioPlaces();
		places.value = p;
		const remembered = readLastPlace() ?? radioState.channel?.placeId ?? null;
		const index = (remembered != null ? p.indexOf.get(remembered) : undefined) ?? nearestPlace(p, DEFAULT_LON, DEFAULT_LAT);
		if (index != null) {
			globeEl.value?.focusPlace(index, false);
			selectPlace(index, false);
		}
	} catch {
		placesError.value = true;
	}
}

async function selectPlace(index: number, fromRotation: boolean): Promise<void> {
	const p = places.value;
	if (p == null) return;
	selectedIndex.value = index;
	const placeId = p.ids[index];
	writeLastPlace(placeId);
	const seq = ++placeSeq;
	placeLoading.value = true;
	placeError.value = false;
	try {
		const res = await fetchPlaceChannels(placeId);
		if (seq !== placeSeq) return;
		placeChannels.value = res.channels;
		// 本家と同じく、鳴らしている間は回した先の局に切り替える
		if (fromRotation && widgetProps.tuneOnRotate && isRadioActive() && res.channels.length > 0 && radioState.channel?.placeId !== placeId) {
			playRadio(res.channels[0], res.channels);
		}
	} catch {
		if (seq !== placeSeq) return;
		placeChannels.value = [];
		placeError.value = true;
	} finally {
		if (seq === placeSeq) placeLoading.value = false;
	}
}

function onSettle(index: number | null): void {
	if (index == null || index === selectedIndex.value) return;
	tab.value = 'place';
	selectPlace(index, true);
}

function goToPlace(placeId: string): void {
	const p = places.value;
	if (p == null) return;
	const index = p.indexOf.get(placeId);
	if (index == null) return;
	globeEl.value?.focusPlace(index, true);
	tab.value = 'place';
	selectPlace(index, false);
}

function play(channel: RadioChannel, queue?: RadioChannel[]): void {
	playRadio(channel, queue);
	// 検索やお気に入りから選んだ局の町へ地球儀を向ける
	const p = places.value;
	if (p != null && channel.placeId != null) {
		const index = p.indexOf.get(channel.placeId);
		if (index != null && index !== selectedIndex.value) {
			globeEl.value?.focusPlace(index, true);
			selectedIndex.value = index;
			writeLastPlace(channel.placeId);
			if (tab.value === 'place') selectPlace(index, false);
		}
	}
}

const query = ref('');
const searchResult = shallowRef<RadioSearchResult | null>(null);
const searching = ref(false);
const searchError = ref(false);
let searchSeq = 0;

watch(query, async (q) => {
	const text = q.trim();
	const seq = ++searchSeq;
	if (text.length < 2) {
		searchResult.value = null;
		searching.value = false;
		searchError.value = false;
		return;
	}
	searching.value = true;
	searchError.value = false;
	try {
		const res = await searchRadio(text);
		if (seq !== searchSeq) return;
		searchResult.value = res;
	} catch {
		if (seq !== searchSeq) return;
		searchError.value = true;
	} finally {
		if (seq === searchSeq) searching.value = false;
	}
});

function toggleCurrentFavorite(): void {
	const channel = radioState.channel;
	if (channel == null) return;
	setRadioFavorite(channel, !isRadioFavorite(channel.id)).catch(() => {
		os.alert({ type: 'error', text: i18n.ts.somethingHappened });
	});
}

function openNormalizeMenu(ev: MouseEvent): void {
	const enabled = ref(radioState.normalize);
	watch(enabled, v => setRadioNormalize(v));
	const target = ref<number>(radioState.targetLufs);
	watch(target, v => setRadioTarget(v));
	const targetLabels: Record<(typeof RADIO_TARGET_OPTIONS)[number], string> = {
		[-14]: i18n.ts._radio.targetLoud,
		[-18]: i18n.ts._radio.targetStandard,
		[-23]: i18n.ts._radio.targetQuiet,
	};
	const items: MenuItem[] = [
		{ type: 'label', text: normalizeText.value },
		{ type: 'switch', text: i18n.ts._radio.normalize, caption: i18n.ts._radio.normalizeDescription, ref: enabled },
		{
			type: 'radio',
			text: i18n.ts._radio.targetLoudness,
			ref: target,
			options: RADIO_TARGET_OPTIONS.map(v => ({ label: targetLabels[v], value: v })),
			disabled: computed(() => !enabled.value),
		},
	];
	os.popupMenu(items, ev.currentTarget ?? ev.target);
}

onMounted(() => {
	loadPlaces();
	if (canFavorite) {
		favoritesLoading.value = true;
		fetchRadioFavorites().catch(() => {}).finally(() => {
			favoritesLoading.value = false;
		});
	}
});

defineExpose<WidgetComponentExpose>({
	name,
	configure,
	id: props.widget ? props.widget.id : null,
});
</script>

<style lang="scss" module>
.root {
	// 本家 (Radio Garden) の緑。本家のデザインに合わせるため、地球儀の点に加えて再生ボタン・選択中のタブの下線・
	// 再生中の行の背景にも使う固定色 (テーマに合わせない意図的な例外。タブは太字でも、行はアイコンでも示す)
	--radioGreen: #40e878;
	// テーマの背景の上で読める濃さにした緑 (明るいテーマでは暗く、暗いテーマでは明るくなる)
	--radioGreenText: color-mix(in srgb, var(--radioGreen) 60%, var(--MI_THEME-fg));
	display: flex;
	flex-direction: column;
}

.globeArea {
	position: relative;
	min-height: 120px;
	// 地球儀は配信映像と同じく常に暗い背景に描く
	background: #000;
	color: #fff;
}

.globeMessage {
	position: absolute;
	inset: 0;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 8px;
	font-size: 0.85em;
	pointer-events: none;
}

.retry {
	pointer-events: auto;
	padding: 4px 12px;
	border-radius: 999px;
	background: rgba(255, 255, 255, 0.15);
}

.zoomButtons {
	position: absolute;
	top: 8px;
	right: 8px;
	display: flex;
	flex-direction: column;
	gap: 4px;
}

.zoomButton {
	width: 28px;
	height: 28px;
	border-radius: 50%;
	display: grid;
	place-items: center;
	background: rgba(255, 255, 255, 0.12);
	color: #fff;

	&:hover {
		background: rgba(255, 255, 255, 0.24);
	}
}

.placeLabel {
	position: absolute;
	left: 0;
	right: 0;
	bottom: 0;
	padding: 18px 12px 8px;
	background: linear-gradient(to top, rgba(0, 0, 0, 0.75), transparent);
	pointer-events: none;
}

.placeTitle {
	font-weight: bold;
	font-size: 1.05em;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.placeSub {
	font-size: 0.75em;
	opacity: 0.75;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.tabs {
	display: flex;
	border-bottom: solid 0.5px var(--MI_THEME-divider);
}

.tab {
	flex: 1;
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 4px;
	padding: 8px 4px;
	font-size: 0.85em;
	opacity: 0.7;
	border-bottom: solid 2px transparent;

	&:hover {
		opacity: 1;
	}
}

.tabActive {
	opacity: 1;
	font-weight: bold;
	border-bottom-color: var(--radioGreen);
}

.listArea {
	max-height: 240px;
	overflow-y: auto;
	padding: 6px;
}

.empty {
	padding: 16px 8px;
	text-align: center;
	font-size: 0.85em;
	opacity: 0.7;
}

.search {
	margin: 2px 2px 6px;
}

.sectionLabel {
	padding: 6px 8px 2px;
	font-size: 0.75em;
	font-weight: bold;
	opacity: 0.6;
}

.placeRow {
	display: flex;
	align-items: center;
	gap: 8px;
	width: 100%;
	padding: 6px 8px;
	border-radius: 6px;
	text-align: left;

	&:hover {
		background: var(--MI_THEME-buttonBg);
	}
}

.placeRowIcon {
	flex-shrink: 0;
	width: 18px;
	text-align: center;
	opacity: 0.6;
}

.placeRowText {
	min-width: 0;
	display: flex;
	flex-direction: column;
}

.placeRowTitle {
	font-size: 0.9em;
	font-weight: bold;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.placeRowSub {
	font-size: 0.75em;
	opacity: 0.7;
}

.player {
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 8px 10px 4px;
	border-top: solid 0.5px var(--MI_THEME-divider);
}

.playButton {
	flex-shrink: 0;
	width: 40px;
	height: 40px;
	border-radius: 50%;
	display: grid;
	place-items: center;
	font-size: 18px;
	background: var(--radioGreen);
	// 緑の上の記号は本家と同じく黒
	color: #000;

	&:disabled {
		opacity: 0.4;
	}
}

.playLoading {
	margin: 0;
}

.now {
	flex: 1;
	min-width: 0;
}

.nowTitle {
	font-size: 0.9em;
	font-weight: bold;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.nowSub {
	font-size: 0.75em;
	opacity: 0.7;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.nowError {
	color: var(--MI_THEME-error);
	opacity: 1;
}

.iconButton {
	flex-shrink: 0;
	padding: 6px;
	border-radius: 6px;

	&:hover:not(:disabled) {
		background: var(--MI_THEME-buttonBg);
	}

	&:disabled {
		opacity: 0.35;
	}
}

.favOn {
	color: var(--radioGreenText);
}

.controls {
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 0 10px 6px;
}

.volume {
	flex: 1;
	min-width: 0;
}

.normalizeButton {
	flex-shrink: 0;
	display: flex;
	align-items: center;
	gap: 4px;
	padding: 4px 8px;
	border-radius: 999px;
	font-size: 0.8em;
	opacity: 0.6;

	&:hover {
		background: var(--MI_THEME-buttonBg);
	}
}

.normalizeOn {
	opacity: 1;
	color: var(--radioGreenText);
}

.gain {
	font-variant-numeric: tabular-nums;
}

.footer {
	display: flex;
	justify-content: space-between;
	padding: 0 12px 8px;
	font-size: 0.7em;
	opacity: 0.6;
}

.credit {
	color: inherit;
}

.route {
	white-space: nowrap;
}
</style>
