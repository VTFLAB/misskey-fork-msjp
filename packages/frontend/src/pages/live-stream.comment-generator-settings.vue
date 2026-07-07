<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkModalWindow
	ref="dialog"
	:width="480"
	:height="720"
	@close="dialog?.close()"
	@closed="emit('closed')"
>
	<template #header>{{ i18n.ts._twitch.commentGenSettings }}</template>

	<div class="_spacer" style="--MI_SPACER-min: 20px; --MI_SPACER-max: 28px;">
		<div class="_gaps_m">
			<MkInfo>{{ i18n.ts._twitch.commentGenDescription }}</MkInfo>

			<div :class="$style.previewSection">
				<div :class="$style.previewLabel">{{ i18n.ts._twitch.commentGenLivePreview }}</div>
				<iframe :class="$style.previewFrame" :src="previewSrc" :title="i18n.ts._twitch.commentGenLivePreview" frameborder="0"></iframe>
			</div>

			<MkFolder :defaultOpen="true">
				<template #icon><i class="ti ti-template"></i></template>
				<template #label>{{ i18n.ts._twitch.commentGenTemplateGroup }}</template>

				<div class="_gaps_s">
					<MkSelect v-model="selectedPresetId" :items="presetItems">
						<template #label>{{ i18n.ts._twitch.commentGenTemplateSelect }}</template>
					</MkSelect>
					<div class="_buttons">
						<MkButton @click="saveAsNewTemplate"><i class="ti ti-device-floppy"></i> {{ i18n.ts._twitch.commentGenTemplateSave }}</MkButton>
						<MkButton :disabled="!isUserTemplateSelected" @click="overwriteSelectedTemplate"><i class="ti ti-refresh"></i> {{ i18n.ts._twitch.commentGenTemplateOverwrite }}</MkButton>
						<MkButton :disabled="!isUserTemplateSelected" danger @click="deleteSelectedTemplate"><i class="ti ti-trash"></i> {{ i18n.ts._twitch.commentGenTemplateDelete }}</MkButton>
					</div>
					<div class="_buttons">
						<MkButton @click="exportSettings"><i class="ti ti-copy"></i> {{ i18n.ts._twitch.commentGenTemplateExport }}</MkButton>
						<MkButton @click="importSettings"><i class="ti ti-clipboard-text"></i> {{ i18n.ts._twitch.commentGenTemplateImport }}</MkButton>
					</div>
				</div>
			</MkFolder>

			<MkFolder>
				<template #icon><i class="ti ti-adjustments"></i></template>
				<template #label>{{ i18n.ts._twitch.commentGenModeGroup }}</template>

				<div class="_gaps_s">
					<MkSelect v-model="settings.mode" :items="modeItems">
						<template #label>{{ i18n.ts._twitch.commentGenMode }}</template>
					</MkSelect>
					<MkSelect v-model="settings.order" :items="orderItems">
						<template #label>{{ i18n.ts._twitch.commentGenOrder }}</template>
					</MkSelect>
					<MkInput v-model="settings.limit" type="number" :min="1" :max="50">
						<template #label>{{ i18n.ts._twitch.commentGenLimit }}</template>
					</MkInput>
					<MkInput v-if="settings.mode === 'fade'" v-model="settings.duration" type="number" :min="0" :max="600000" :step="500">
						<template #label>{{ i18n.ts._twitch.commentGenDuration }}</template>
						<template #suffix>ms</template>
						<template #caption>{{ i18n.ts._twitch.commentGenDurationDescription }}</template>
					</MkInput>
					<MkInput v-model="settings.history" type="number" :min="0" :max="30">
						<template #label>{{ i18n.ts._twitch.commentGenHistory }}</template>
						<template #caption>{{ i18n.ts._twitch.commentGenHistoryDescription }}</template>
					</MkInput>
				</div>
			</MkFolder>

			<MkFolder>
				<template #icon><i class="ti ti-typography"></i></template>
				<template #label>{{ i18n.ts._twitch.commentGenFontGroup }}</template>

				<div class="_gaps_s">
					<MkInput v-model="settings.font">
						<template #label>{{ i18n.ts._twitch.commentGenFont }}</template>
						<template #caption>{{ i18n.ts._twitch.commentGenFontDescription }}</template>
					</MkInput>
					<MkInput v-model="settings.fontSize" type="number" :min="8" :max="96">
						<template #label>{{ i18n.ts._twitch.commentGenFontSize }}</template>
						<template #suffix>px</template>
					</MkInput>
					<MkSelect v-model="settings.fontWeight" :items="fontWeightItems">
						<template #label>{{ i18n.ts._twitch.commentGenFontWeight }}</template>
					</MkSelect>
				</div>
			</MkFolder>

			<MkFolder>
				<template #icon><i class="ti ti-palette"></i></template>
				<template #label>{{ i18n.ts._twitch.commentGenColorGroup }}</template>

				<div class="_gaps_s">
					<MkInput v-model="settings.textColor">
						<template #label>{{ i18n.ts._twitch.commentGenTextColor }}</template>
					</MkInput>
					<MkInput v-model="settings.nameColor">
						<template #label>{{ i18n.ts._twitch.commentGenNameColor }}</template>
					</MkInput>
					<MkInput v-model="settings.transColor">
						<template #label>{{ i18n.ts._twitch.commentGenTransColor }}</template>
					</MkInput>
					<MkInput v-model="settings.bgColor">
						<template #label>{{ i18n.ts._twitch.commentGenBgColor }}</template>
						<template #caption>{{ i18n.ts._twitch.commentGenBgColorDescription }}</template>
					</MkInput>
					<MkInput v-model="settings.outlineColor">
						<template #label>{{ i18n.ts._twitch.commentGenOutlineColor }}</template>
					</MkInput>
				</div>
			</MkFolder>

			<MkFolder>
				<template #icon><i class="ti ti-layout"></i></template>
				<template #label>{{ i18n.ts._twitch.commentGenLayoutGroup }}</template>

				<div class="_gaps_s">
					<MkInput v-model="settings.outline" type="number" :min="0" :max="20">
						<template #label>{{ i18n.ts._twitch.commentGenOutline }}</template>
						<template #suffix>px</template>
						<template #caption>{{ i18n.ts._twitch.commentGenOutlineDescription }}</template>
					</MkInput>
					<MkInput v-model="settings.radius" type="number" :min="0" :max="100">
						<template #label>{{ i18n.ts._twitch.commentGenRadius }}</template>
						<template #suffix>px</template>
					</MkInput>
					<MkInput v-model="settings.padding" type="number" :min="0" :max="100">
						<template #label>{{ i18n.ts._twitch.commentGenPadding }}</template>
						<template #suffix>px</template>
					</MkInput>
					<MkInput v-model="settings.gap" type="number" :min="0" :max="100">
						<template #label>{{ i18n.ts._twitch.commentGenGap }}</template>
						<template #suffix>px</template>
					</MkInput>
					<MkInput v-model="settings.iconSize" type="number" :min="12" :max="128">
						<template #label>{{ i18n.ts._twitch.commentGenIconSize }}</template>
						<template #suffix>px</template>
					</MkInput>
					<MkInput v-model="settings.emojiScale" type="number" :min="0.5" :max="4" :step="0.1">
						<template #label>{{ i18n.ts._twitch.commentGenEmojiScale }}</template>
					</MkInput>
				</div>
			</MkFolder>

			<MkFolder>
				<template #icon><i class="ti ti-player-play"></i></template>
				<template #label>{{ i18n.ts._twitch.commentGenAnimGroup }}</template>

				<div class="_gaps_s">
					<MkSelect v-model="settings.animIn" :items="animInItems">
						<template #label>{{ i18n.ts._twitch.commentGenAnimIn }}</template>
					</MkSelect>
					<MkSelect v-model="settings.animOut" :items="animOutItems">
						<template #label>{{ i18n.ts._twitch.commentGenAnimOut }}</template>
					</MkSelect>
					<MkInput v-model="settings.animTime" type="number" :min="0" :max="5000" :step="50">
						<template #label>{{ i18n.ts._twitch.commentGenAnimTime }}</template>
						<template #suffix>ms</template>
					</MkInput>
				</div>
			</MkFolder>

			<MkFolder>
				<template #icon><i class="ti ti-eye"></i></template>
				<template #label>{{ i18n.ts._twitch.commentGenElementsGroup }}</template>

				<div class="_gaps_s">
					<MkSwitch v-model="settings.icon">{{ i18n.ts._twitch.commentGenShowIcon }}</MkSwitch>
					<MkSwitch v-model="settings.name">{{ i18n.ts._twitch.commentGenShowName }}</MkSwitch>
					<MkSwitch v-model="settings.translation">{{ i18n.ts._twitch.commentGenShowTranslation }}</MkSwitch>
					<MkSwitch v-model="settings.media">{{ i18n.ts._twitch.commentGenShowMedia }}</MkSwitch>
				</div>
			</MkFolder>

			<div :class="$style.urlSection">
				<div :class="$style.urlLabel">{{ i18n.ts._twitch.commentGenGeneratedUrl }}</div>
				<div class="_panel _selectable" :class="$style.urlBox">{{ generatedUrl }}</div>
				<div class="_buttons">
					<MkButton @click="copyUrl"><i class="ti ti-copy"></i> {{ i18n.ts._twitch.commentGenCopyUrl }}</MkButton>
					<MkButton @click="openPreviewUrl"><i class="ti ti-external-link"></i> {{ i18n.ts._twitch.commentGenOpenPreview }}</MkButton>
				</div>
			</div>
		</div>
	</div>
</MkModalWindow>
</template>

<script lang="ts" setup>
import { computed, reactive, ref, useTemplateRef, watch } from 'vue';
import { url as serverUrl } from '@@/js/config.js';
import MkModalWindow from '@/components/MkModalWindow.vue';
import MkFolder from '@/components/MkFolder.vue';
import MkInfo from '@/components/MkInfo.vue';
import MkInput from '@/components/MkInput.vue';
import MkSelect from '@/components/MkSelect.vue';
import MkSwitch from '@/components/MkSwitch.vue';
import MkButton from '@/components/MkButton.vue';
import { i18n } from '@/i18n.js';
import { miLocalStorage } from '@/local-storage.js';
import { copyToClipboard } from '@/utility/copy-to-clipboard.js';
import * as os from '@/os.js';

const props = defineProps<{
	acct: string;
}>();

const emit = defineEmits<{
	(ev: 'closed'): void;
}>();

const dialog = useTemplateRef('dialog');

// OBS用コメントジェネレーターページ (backend側で実装、素のHTML + URLクエリパラメータ駆動) の
// 設定ビルダー。backend実装と合意済みのクエリパラメータ契約はこのファイルのみが把握しており、
// backend/HTMLページ側の実装には立ち入らない
type CommentGenMode = 'fade' | 'stack';
type CommentGenOrder = 'bottom' | 'top';
type CommentGenAnimIn = 'slide' | 'slideRight' | 'fade' | 'pop' | 'none';
type CommentGenAnimOut = 'fade' | 'slideLeft' | 'none';

type CommentGenSettings = {
	mode: CommentGenMode;
	limit: number;
	duration: number;
	order: CommentGenOrder;
	animIn: CommentGenAnimIn;
	animOut: CommentGenAnimOut;
	animTime: number;
	font: string;
	fontSize: number;
	fontWeight: string;
	textColor: string;
	nameColor: string;
	transColor: string;
	bgColor: string;
	outlineColor: string;
	outline: number;
	radius: number;
	padding: number;
	gap: number;
	icon: boolean;
	name: boolean;
	translation: boolean;
	media: boolean;
	iconSize: number;
	emojiScale: number;
	history: number;
};

type CommentGenTemplate = {
	name: string;
	settings: CommentGenSettings;
};

type CommentGenStoredData = {
	current: CommentGenSettings;
	templates: CommentGenTemplate[];
};

const DEFAULT_SETTINGS: CommentGenSettings = {
	mode: 'fade',
	limit: 8,
	duration: 12000,
	order: 'bottom',
	animIn: 'slide',
	animOut: 'fade',
	animTime: 300,
	font: '',
	fontSize: 16,
	fontWeight: '700',
	textColor: '',
	nameColor: '',
	transColor: '',
	bgColor: '',
	outlineColor: '',
	outline: 0,
	radius: 8,
	padding: 10,
	gap: 8,
	icon: true,
	name: true,
	translation: true,
	media: true,
	iconSize: 36,
	emojiScale: 1.4,
	history: 0,
};

const MODE_VALUES: readonly CommentGenMode[] = ['fade', 'stack'];
const ORDER_VALUES: readonly CommentGenOrder[] = ['bottom', 'top'];
const ANIM_IN_VALUES: readonly CommentGenAnimIn[] = ['slide', 'slideRight', 'fade', 'pop', 'none'];
const ANIM_OUT_VALUES: readonly CommentGenAnimOut[] = ['fade', 'slideLeft', 'none'];

function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
	return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? value as T : fallback;
}

function pickString(value: unknown, fallback: string): string {
	return typeof value === 'string' ? value : fallback;
}

function pickBoolean(value: unknown, fallback: boolean): boolean {
	return typeof value === 'boolean' ? value : fallback;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
	const n = typeof value === 'number' ? value : typeof value === 'string' ? parseFloat(value) : NaN;
	if (!Number.isFinite(n)) return fallback;
	return Math.min(max, Math.max(min, n));
}

// インポート/永続化データの検証: 未知キーは無視 (読まない)、既知キーは型不一致ならデフォルト値、
// 数値は範囲外ならクランプ、enum は許可値以外ならデフォルト値にフォールバックする
function sanitizeSettings(raw: unknown): CommentGenSettings {
	const src = (raw != null && typeof raw === 'object') ? raw as Record<string, unknown> : {};
	return {
		mode: pickEnum(src.mode, MODE_VALUES, DEFAULT_SETTINGS.mode),
		limit: clampNumber(src.limit, DEFAULT_SETTINGS.limit, 1, 50),
		duration: clampNumber(src.duration, DEFAULT_SETTINGS.duration, 0, 600000),
		order: pickEnum(src.order, ORDER_VALUES, DEFAULT_SETTINGS.order),
		animIn: pickEnum(src.animIn, ANIM_IN_VALUES, DEFAULT_SETTINGS.animIn),
		animOut: pickEnum(src.animOut, ANIM_OUT_VALUES, DEFAULT_SETTINGS.animOut),
		animTime: clampNumber(src.animTime, DEFAULT_SETTINGS.animTime, 0, 5000),
		font: pickString(src.font, DEFAULT_SETTINGS.font),
		fontSize: clampNumber(src.fontSize, DEFAULT_SETTINGS.fontSize, 8, 96),
		fontWeight: pickString(src.fontWeight, DEFAULT_SETTINGS.fontWeight),
		textColor: pickString(src.textColor, DEFAULT_SETTINGS.textColor),
		nameColor: pickString(src.nameColor, DEFAULT_SETTINGS.nameColor),
		transColor: pickString(src.transColor, DEFAULT_SETTINGS.transColor),
		bgColor: pickString(src.bgColor, DEFAULT_SETTINGS.bgColor),
		outlineColor: pickString(src.outlineColor, DEFAULT_SETTINGS.outlineColor),
		outline: clampNumber(src.outline, DEFAULT_SETTINGS.outline, 0, 20),
		radius: clampNumber(src.radius, DEFAULT_SETTINGS.radius, 0, 100),
		padding: clampNumber(src.padding, DEFAULT_SETTINGS.padding, 0, 100),
		gap: clampNumber(src.gap, DEFAULT_SETTINGS.gap, 0, 100),
		icon: pickBoolean(src.icon, DEFAULT_SETTINGS.icon),
		name: pickBoolean(src.name, DEFAULT_SETTINGS.name),
		translation: pickBoolean(src.translation, DEFAULT_SETTINGS.translation),
		media: pickBoolean(src.media, DEFAULT_SETTINGS.media),
		iconSize: clampNumber(src.iconSize, DEFAULT_SETTINGS.iconSize, 12, 128),
		emojiScale: clampNumber(src.emojiScale, DEFAULT_SETTINGS.emojiScale, 0.5, 4),
		history: clampNumber(src.history, DEFAULT_SETTINGS.history, 0, 30),
	};
}

function sanitizeTemplates(raw: unknown): CommentGenTemplate[] {
	if (!Array.isArray(raw)) return [];
	return raw
		.filter((t): t is Record<string, unknown> => t != null && typeof t === 'object')
		.map(t => ({
			name: pickString(t.name, ''),
			settings: sanitizeSettings(t.settings),
		}))
		.filter(t => t.name.length > 0);
}

function load(): CommentGenStoredData {
	try {
		const raw = miLocalStorage.getItem('twitchCommentGen');
		if (raw == null) return { current: { ...DEFAULT_SETTINGS }, templates: [] };
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		// 旧形式 (フラットな設定オブジェクトそのもの) からの移行も許容する
		return {
			current: sanitizeSettings(parsed.current ?? parsed),
			templates: sanitizeTemplates(parsed.templates),
		};
	} catch {
		return { current: { ...DEFAULT_SETTINGS }, templates: [] };
	}
}

const stored = load();
const settings = reactive<CommentGenSettings>(stored.current);
const templates = ref<CommentGenTemplate[]>(stored.templates);

watch([settings, templates], () => {
	miLocalStorage.setItem('twitchCommentGen', JSON.stringify({
		current: { ...settings },
		templates: templates.value,
	}));
}, { deep: true });

const modeItems = [
	{ value: 'fade', label: i18n.ts._twitch.commentGenModeFade },
	{ value: 'stack', label: i18n.ts._twitch.commentGenModeStack },
];

const orderItems = [
	{ value: 'bottom', label: i18n.ts._twitch.commentGenOrderBottom },
	{ value: 'top', label: i18n.ts._twitch.commentGenOrderTop },
];

const animInItems = [
	{ value: 'slide', label: i18n.ts._twitch.commentGenAnimSlide },
	{ value: 'slideRight', label: i18n.ts._twitch.commentGenAnimSlideRight },
	{ value: 'fade', label: i18n.ts._twitch.commentGenAnimFade },
	{ value: 'pop', label: i18n.ts._twitch.commentGenAnimPop },
	{ value: 'none', label: i18n.ts._twitch.commentGenAnimNone },
];

const animOutItems = [
	{ value: 'fade', label: i18n.ts._twitch.commentGenAnimFade },
	{ value: 'slideLeft', label: i18n.ts._twitch.commentGenAnimSlideLeft },
	{ value: 'none', label: i18n.ts._twitch.commentGenAnimNone },
];

const fontWeightItems = [
	{ value: '400', label: i18n.ts._twitch.commentGenFontWeightNormal },
	{ value: '700', label: i18n.ts._twitch.commentGenFontWeightBold },
	{ value: '900', label: i18n.ts._twitch.commentGenFontWeightBlack },
];

//#region テンプレート (組み込みプリセット + ユーザー保存分)
type CommentGenPreset = {
	id: string;
	name: string;
	overrides: Partial<CommentGenSettings>;
};

// 見た目の差がはっきり出る組み合わせのみを組み込みプリセットとして用意する。
// パラメータ契約 (クエリパラメータ仕様) を変えないよう、既存フィールドの組み合わせのみで構成する
const BUILTIN_PRESETS: CommentGenPreset[] = [
	{ id: 'builtin:standard', name: i18n.ts._twitch.commentGenPresetStandard, overrides: {} },
	{
		id: 'builtin:simpleWhite',
		name: i18n.ts._twitch.commentGenPresetSimpleWhite,
		overrides: { textColor: '#ffffff', nameColor: '#ffffff', bgColor: 'none', outline: 3, outlineColor: '#000000', fontWeight: '900' },
	},
	{
		id: 'builtin:darkBubble',
		name: i18n.ts._twitch.commentGenPresetDarkBubble,
		overrides: { bgColor: 'rgba(20,20,30,0.85)', textColor: '#ffffff', nameColor: '#7c9eff', radius: 20, padding: 14, gap: 10 },
	},
	{
		id: 'builtin:pop',
		name: i18n.ts._twitch.commentGenPresetPop,
		overrides: { animIn: 'pop', animOut: 'fade', radius: 24, emojiScale: 2.2, fontSize: 20, fontWeight: '900' },
	},
	{
		id: 'builtin:stack',
		name: i18n.ts._twitch.commentGenPresetStack,
		overrides: { mode: 'stack', gap: 6 },
	},
	{
		id: 'builtin:minimal',
		name: i18n.ts._twitch.commentGenPresetMinimal,
		overrides: { icon: false, bgColor: 'none', outline: 0, fontSize: 15 },
	},
];

const USER_ID_PREFIX = 'user:';

const selectedPresetId = ref<string>('builtin:standard');

const isUserTemplateSelected = computed(() => selectedPresetId.value.startsWith(USER_ID_PREFIX));

const presetItems = computed(() => [
	...BUILTIN_PRESETS.map(p => ({ value: p.id, label: p.name })),
	...templates.value.map((t, i) => ({ value: `${USER_ID_PREFIX}${i}`, label: t.name })),
]);

function findSelectedUserTemplateIndex(): number | null {
	if (!selectedPresetId.value.startsWith(USER_ID_PREFIX)) return null;
	const idx = Number(selectedPresetId.value.slice(USER_ID_PREFIX.length));
	return templates.value[idx] != null ? idx : null;
}

function applyPreset(id: string) {
	if (id.startsWith(USER_ID_PREFIX)) {
		const idx = Number(id.slice(USER_ID_PREFIX.length));
		const template = templates.value[idx];
		if (template == null) return;
		Object.assign(settings, sanitizeSettings(template.settings));
		return;
	}
	const preset = BUILTIN_PRESETS.find(p => p.id === id);
	if (preset == null) return;
	Object.assign(settings, DEFAULT_SETTINGS, preset.overrides);
}

watch(selectedPresetId, id => applyPreset(id));

async function saveAsNewTemplate() {
	const { canceled, result } = await os.inputText({
		title: i18n.ts._twitch.commentGenTemplateNamePrompt,
		default: '',
		minLength: 1,
		maxLength: 30,
	});
	if (canceled) return;
	const name = result.trim();
	if (name.length === 0) return;

	const existingIndex = templates.value.findIndex(t => t.name === name);
	if (existingIndex >= 0) {
		const { canceled: overwriteCanceled } = await os.confirm({
			type: 'warning',
			text: i18n.tsx._twitch.commentGenTemplateOverwriteConfirm({ name }),
		});
		if (overwriteCanceled) return;
		templates.value[existingIndex] = { name, settings: { ...settings } };
		selectedPresetId.value = `${USER_ID_PREFIX}${existingIndex}`;
	} else {
		templates.value.push({ name, settings: { ...settings } });
		selectedPresetId.value = `${USER_ID_PREFIX}${templates.value.length - 1}`;
	}
	os.toast(i18n.ts._twitch.commentGenTemplateSaved);
}

function overwriteSelectedTemplate() {
	const idx = findSelectedUserTemplateIndex();
	if (idx == null) return;
	templates.value[idx] = { name: templates.value[idx].name, settings: { ...settings } };
	os.toast(i18n.ts._twitch.commentGenTemplateSaved);
}

async function deleteSelectedTemplate() {
	const idx = findSelectedUserTemplateIndex();
	if (idx == null) return;
	const name = templates.value[idx].name;
	const { canceled } = await os.confirm({
		type: 'warning',
		text: i18n.tsx._twitch.commentGenTemplateDeleteConfirm({ name }),
	});
	if (canceled) return;
	templates.value.splice(idx, 1);
	selectedPresetId.value = 'builtin:standard';
}

function exportSettings() {
	copyToClipboard(JSON.stringify(settings));
}

async function importSettings() {
	const { canceled, result } = await os.inputText({
		title: i18n.ts._twitch.commentGenImportPrompt,
		default: '',
	});
	if (canceled || result == null) return;
	try {
		const parsed = JSON.parse(result);
		Object.assign(settings, sanitizeSettings(parsed));
		// インポートした内容はどの組み込み/保存済テンプレートとも一致しないため選択状態を外す
		selectedPresetId.value = 'builtin:standard';
		os.toast(i18n.ts._twitch.commentGenImported);
	} catch {
		os.alert({ type: 'error', text: i18n.ts._twitch.commentGenImportFailed });
	}
}
//#endregion

// デフォルト値と同じ項目はURLに含めない (短いURLを保つ)。真偽値は 1/0 で表現する
function buildUrl(demo: boolean): string {
	const params = new URLSearchParams();
	for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof CommentGenSettings)[]) {
		const value = settings[key];
		const defaultValue = DEFAULT_SETTINGS[key];
		if (value === defaultValue) continue;
		params.set(key, typeof value === 'boolean' ? (value ? '1' : '0') : String(value));
	}
	if (demo) params.set('demo', '1');
	const qs = params.toString();
	return `${serverUrl}/live/${props.acct}/comment-generator${qs.length > 0 ? `?${qs}` : ''}`;
}

const generatedUrl = computed(() => buildUrl(false));

// プレビュー用iframeのsrc。設定変更のたびに毎回reloadすると重いため500msデバウンスして差し替える
const previewSrc = ref(buildUrl(true));
let previewDebounceTimer: number | null = null;

watch(generatedUrl, () => {
	if (previewDebounceTimer != null) window.clearTimeout(previewDebounceTimer);
	previewDebounceTimer = window.setTimeout(() => {
		previewSrc.value = buildUrl(true);
	}, 500);
});

function copyUrl() {
	copyToClipboard(generatedUrl.value);
}

function openPreviewUrl() {
	window.open(buildUrl(true), '_blank', 'noopener');
}
</script>

<style lang="scss" module>
.previewSection {
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.previewLabel {
	font-size: 0.85em;
	opacity: 0.8;
}

.previewFrame {
	width: 100%;
	height: 360px;
	border: none;
	border-radius: var(--MI-radius, 8px);
	background-color: var(--MI_THEME-panel);
	background-image:
		linear-gradient(45deg, var(--MI_THEME-divider) 25%, transparent 25%),
		linear-gradient(-45deg, var(--MI_THEME-divider) 25%, transparent 25%),
		linear-gradient(45deg, transparent 75%, var(--MI_THEME-divider) 75%),
		linear-gradient(-45deg, transparent 75%, var(--MI_THEME-divider) 75%);
	background-size: 20px 20px;
	background-position: 0 0, 0 10px, 10px -10px, -10px 0;
}

.urlSection {
	padding-top: 8px;
	border-top: solid 1px var(--MI_THEME-divider);
}

.urlLabel {
	font-size: 0.85em;
	padding-bottom: 8px;
	opacity: 0.8;
}

.urlBox {
	padding: 10px 12px;
	margin-bottom: 12px;
	font-size: 0.9em;
	word-break: break-all;
	border-radius: var(--MI-radius, 8px);
}
</style>
