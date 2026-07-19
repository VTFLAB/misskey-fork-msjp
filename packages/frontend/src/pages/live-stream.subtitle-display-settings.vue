<!--
SPDX-FileCopyrightText: misskey-bsky-integration fork
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkModalWindow
	ref="dialog"
	:width="480"
	:height="720"
	@close="onRequestClose"
	@closed="emit('closed')"
>
	<template #header>{{ i18n.ts._twitch.subtitleDisplaySettings }}</template>

	<div class="_spacer" style="--MI_SPACER-min: 20px; --MI_SPACER-max: 28px;">
		<div class="_gaps_m">
			<MkInfo>{{ i18n.ts._twitch.subtitleDisplayDescription }}</MkInfo>

			<div :class="$style.previewSection">
				<div :class="$style.previewLabel">{{ i18n.ts._twitch.subtitleDisplayLivePreview }}</div>
				<iframe :class="$style.previewFrame" :src="previewSrc" :title="i18n.ts._twitch.subtitleDisplayLivePreview" frameborder="0"></iframe>
			</div>

			<div :class="$style.applySection">
				<MkButton :primary="hasUnpreviewedChanges" @click="applyDraftToPreview">
					<i class="ti ti-device-floppy"></i> {{ i18n.ts._twitch.subtitleDisplayApply }}
				</MkButton>
				<span v-if="hasUnpreviewedChanges" :class="$style.unappliedBadge">
					<i class="ti ti-alert-circle"></i> {{ i18n.ts._twitch.subtitleDisplayUnappliedChanges }}
				</span>
			</div>

			<MkFolder :defaultOpen="true">
				<template #icon><i class="ti ti-template"></i></template>
				<template #label>{{ i18n.ts._twitch.subtitleDisplayTemplateGroup }}</template>

				<div class="_gaps_s">
					<div :class="$style.presetPickerLabel">{{ i18n.ts._twitch.subtitleDisplayTemplateSelect }}</div>
					<button
						ref="presetPickerButtonEl"
						type="button"
						class="_button"
						:class="$style.presetPickerButton"
						@click="showPresetMenu"
					>
						<span>{{ selectedPresetLabel }}</span>
						<i class="ti ti-chevron-down"></i>
					</button>
					<div class="_buttons">
						<MkButton @click="saveAsNewTemplate"><i class="ti ti-device-floppy"></i> {{ i18n.ts._twitch.subtitleDisplayTemplateSave }}</MkButton>
						<MkButton :disabled="!isUserTemplateSelected" @click="overwriteSelectedTemplate"><i class="ti ti-refresh"></i> {{ i18n.ts._twitch.subtitleDisplayTemplateOverwrite }}</MkButton>
						<MkButton :disabled="!isUserTemplateSelected" danger @click="deleteSelectedTemplate"><i class="ti ti-trash"></i> {{ i18n.ts._twitch.subtitleDisplayTemplateDelete }}</MkButton>
					</div>
					<div class="_buttons">
						<MkButton @click="exportSettings"><i class="ti ti-copy"></i> {{ i18n.ts._twitch.subtitleDisplayTemplateExport }}</MkButton>
						<MkButton @click="importSettings"><i class="ti ti-clipboard-text"></i> {{ i18n.ts._twitch.subtitleDisplayTemplateImport }}</MkButton>
					</div>
				</div>
			</MkFolder>

			<MkFolder>
				<template #icon><i class="ti ti-layout-align-center"></i></template>
				<template #label>{{ i18n.ts._twitch.subtitleDisplayPositionGroup }}</template>

				<div class="_gaps_s">
					<MkSelect v-model="draft.position" :items="positionItems">
						<template #label>{{ i18n.ts._twitch.subtitleDisplayPosition }}</template>
					</MkSelect>
					<MkSelect v-model="draft.align" :items="alignItems">
						<template #label>{{ i18n.ts._twitch.subtitleDisplayAlign }}</template>
					</MkSelect>
					<MkInput v-model="draft.offset" type="number" :min="0" :max="400">
						<template #label>{{ i18n.ts._twitch.subtitleDisplayOffset }}</template>
						<template #suffix>px</template>
					</MkInput>
					<MkInput v-model="draft.maxWidth" type="number" :min="20" :max="100">
						<template #label>{{ i18n.ts._twitch.subtitleDisplayMaxWidth }}</template>
						<template #suffix>%</template>
					</MkInput>
					<MkSwitch v-model="draft.original">{{ i18n.ts._twitch.subtitleDisplayShowOriginal }}</MkSwitch>
					<MkSwitch v-model="draft.translation">{{ i18n.ts._twitch.subtitleDisplayShowTranslation }}</MkSwitch>
					<MkSelect v-model="draft.interim" :items="interimItems">
						<template #label>{{ i18n.ts._twitch.subtitleDisplayInterimMode }}</template>
					</MkSelect>
				</div>
			</MkFolder>

			<MkFolder>
				<template #icon><i class="ti ti-typography"></i></template>
				<template #label>{{ i18n.ts._twitch.subtitleDisplayFontGroup }}</template>

				<div class="_gaps_s">
					<MkSelect v-model="selectedFontId" :items="fontPresetItems" @update:modelValue="onSelectFont">
						<template #label>{{ i18n.ts._twitch.subtitleDisplayFont }}</template>
						<template #caption>{{ i18n.ts._twitch.subtitleDisplayFontDescription }}</template>
					</MkSelect>
					<MkInput v-model="draft.fontSize" type="number" :min="8" :max="96">
						<template #label>{{ i18n.ts._twitch.subtitleDisplayFontSize }}</template>
						<template #suffix>px</template>
					</MkInput>
					<MkInput v-model="draft.transSize" type="number" :min="8" :max="96">
						<template #label>{{ i18n.ts._twitch.subtitleDisplayTransSize }}</template>
						<template #suffix>px</template>
					</MkInput>
					<MkInput v-model="draft.fontWeight" type="number" :min="100" :max="900" :step="100">
						<template #label>{{ i18n.ts._twitch.subtitleDisplayFontWeight }}</template>
					</MkInput>
				</div>
			</MkFolder>

			<MkFolder>
				<template #icon><i class="ti ti-palette"></i></template>
				<template #label>{{ i18n.ts._twitch.subtitleDisplayColorGroup }}</template>

				<div class="_gaps_s">
					<MkColorInput v-model="textColorHex">
						<template #label>{{ i18n.ts._twitch.subtitleDisplayTextColor }}</template>
					</MkColorInput>
					<MkColorInput v-model="transColorHex">
						<template #label>{{ i18n.ts._twitch.subtitleDisplayTransColor }}</template>
					</MkColorInput>
					<MkSwitch v-model="bgTransparent">
						{{ i18n.ts._twitch.subtitleDisplayBgTransparent }}
						<template #caption>{{ i18n.ts._twitch.subtitleDisplayBgColorDescription }}</template>
					</MkSwitch>
					<template v-if="!bgTransparent">
						<MkColorInput v-model="bgColorHex">
							<template #label>{{ i18n.ts._twitch.subtitleDisplayBgColor }}</template>
						</MkColorInput>
						<MkRange v-model="bgOpacity" :min="0" :max="100" :step="1">
							<template #label>{{ i18n.ts._twitch.subtitleDisplayBgOpacity }}</template>
							<template #suffix>%</template>
						</MkRange>
					</template>
					<MkColorInput v-model="outlineColorHex">
						<template #label>{{ i18n.ts._twitch.subtitleDisplayOutlineColor }}</template>
					</MkColorInput>
				</div>
			</MkFolder>

			<MkFolder>
				<template #icon><i class="ti ti-box-margin"></i></template>
				<template #label>{{ i18n.ts._twitch.subtitleDisplayLayoutGroup }}</template>

				<div class="_gaps_s">
					<MkInput v-model="draft.outline" type="number" :min="0" :max="20">
						<template #label>{{ i18n.ts._twitch.subtitleDisplayOutline }}</template>
						<template #suffix>px</template>
						<template #caption>{{ i18n.ts._twitch.subtitleDisplayOutlineDescription }}</template>
					</MkInput>
					<MkInput v-model="draft.radius" type="number" :min="0" :max="100">
						<template #label>{{ i18n.ts._twitch.subtitleDisplayRadius }}</template>
						<template #suffix>px</template>
					</MkInput>
					<MkInput v-model="draft.padding" type="number" :min="0" :max="100">
						<template #label>{{ i18n.ts._twitch.subtitleDisplayPadding }}</template>
						<template #suffix>px</template>
					</MkInput>
					<div :class="$style.presetPickerLabel">{{ i18n.ts._twitch.subtitleDisplayBgImageDescription }}</div>
					<div :class="$style.previewText" class="_monospace">{{ draft.bgImage.length > 0 ? draft.bgImage : '—' }}</div>
					<div class="_buttons">
						<MkButton @click="pickDriveBgImage"><i class="ti ti-cloud"></i> {{ i18n.ts._twitch.subtitleDisplayBgImageSelect }}</MkButton>
						<MkButton v-if="draft.bgImage.length > 0" danger @click="clearBgImage"><i class="ti ti-x"></i> {{ i18n.ts.remove }}</MkButton>
					</div>
				</div>
			</MkFolder>

			<MkFolder>
				<template #icon><i class="ti ti-clock"></i></template>
				<template #label>{{ i18n.ts._twitch.subtitleDisplayTimingGroup }}</template>

				<div class="_gaps_s">
					<MkInput v-model="draft.cps" type="number" :min="1" :max="30" :step="0.5">
						<template #label>{{ i18n.ts._twitch.subtitleDisplayCps }}</template>
						<template #caption>{{ i18n.ts._twitch.subtitleDisplayCpsDescription }}</template>
					</MkInput>
					<MkInput v-model="draft.minDur" type="number" :min="0.5" :max="5" :step="0.5">
						<template #label>{{ i18n.ts._twitch.subtitleDisplayMinDur }}</template>
						<template #suffix>s</template>
					</MkInput>
					<MkInput v-model="draft.maxDur" type="number" :min="2" :max="15" :step="0.5">
						<template #label>{{ i18n.ts._twitch.subtitleDisplayMaxDur }}</template>
						<template #suffix>s</template>
					</MkInput>
					<MkInput v-model="draft.idleClear" type="number" :min="0" :max="60">
						<template #label>{{ i18n.ts._twitch.subtitleDisplayIdleClear }}</template>
						<template #suffix>s</template>
						<template #caption>{{ i18n.ts._twitch.subtitleDisplayIdleClearDescription }}</template>
					</MkInput>
				</div>
			</MkFolder>

			<div :class="$style.urlSection">
				<div :class="$style.urlLabel">
					{{ i18n.ts._twitch.subtitleDisplayGeneratedUrl }}
					<span v-if="hasUncommittedChanges" :class="$style.uncommittedBadge">
						<i class="ti ti-alert-circle"></i> {{ i18n.ts._twitch.subtitleDisplayUncommittedBadge }}
					</span>
				</div>
				<div class="_panel _selectable" :class="$style.urlBox">{{ generatedUrl }}</div>
				<div class="_buttons">
					<MkButton :primary="hasUncommittedChanges" :disabled="!hasUncommittedChanges" @click="commitPreview"><i class="ti ti-cloud-upload"></i> {{ i18n.ts._twitch.subtitleDisplayCommit }}</MkButton>
					<MkButton @click="copyUrl"><i class="ti ti-copy"></i> {{ i18n.ts._twitch.subtitleDisplayCopyUrl }}</MkButton>
					<MkButton @click="openPreviewUrl"><i class="ti ti-external-link"></i> {{ i18n.ts._twitch.subtitleDisplayOpenPreview }}</MkButton>
				</div>
				<div v-if="hasUnpreviewedChanges" :class="$style.commitHint">{{ i18n.ts._twitch.subtitleDisplayCommitHint }}</div>
			</div>
		</div>
	</div>
</MkModalWindow>
</template>

<script lang="ts" setup>
import { computed, reactive, ref, useTemplateRef } from 'vue';
import { url as serverUrl } from '@@/js/config.js';
import MkModalWindow from '@/components/MkModalWindow.vue';
import MkFolder from '@/components/MkFolder.vue';
import MkInfo from '@/components/MkInfo.vue';
import MkInput from '@/components/MkInput.vue';
import MkSelect from '@/components/MkSelect.vue';
import MkSwitch from '@/components/MkSwitch.vue';
import MkButton from '@/components/MkButton.vue';
import MkColorInput from '@/components/MkColorInput.vue';
import MkRange from '@/components/MkRange.vue';
import { i18n } from '@/i18n.js';
import { miLocalStorage } from '@/local-storage.js';
import { copyToClipboard } from '@/utility/copy-to-clipboard.js';
import { chooseDriveFile } from '@/utility/drive.js';
import * as os from '@/os.js';

const props = defineProps<{
	acct: string;
}>();

const emit = defineEmits<{
	(ev: 'closed'): void;
}>();

const dialog = useTemplateRef('dialog');
const presetPickerButtonEl = useTemplateRef('presetPickerButtonEl');

// OBS用ライブ字幕表示ページ (backend側で実装、素のHTML + URLクエリパラメータ駆動) の
// 見た目設定ビルダー。backend実装 (subtitles.js) と合意済みのクエリパラメータ契約は
// doc/live-streaming/subtitle-contract.md Phase B/D を参照。デフォルト値・min/max/enumは
// subtitles.js の config 構築部と完全一致させること (三点同期)
type SubtitleDisplayAlign = 'left' | 'center' | 'right';
type SubtitleDisplayPosition = 'top' | 'bottom';
type SubtitleDisplayInterim = 'brackets' | 'dim' | 'hidden';

type SubtitleDisplaySettings = {
	font: string;
	fontUrl: string;
	fontSize: number;
	transSize: number;
	fontWeight: number;
	textColor: string;
	transColor: string;
	outline: number;
	outlineColor: string;
	bgColor: string;
	bgImage: string;
	radius: number;
	padding: number;
	align: SubtitleDisplayAlign;
	position: SubtitleDisplayPosition;
	offset: number;
	maxWidth: number;
	original: boolean;
	translation: boolean;
	interim: SubtitleDisplayInterim;
	cps: number;
	minDur: number;
	maxDur: number;
	idleClear: number;
};

type SubtitleDisplayTemplate = {
	name: string;
	settings: SubtitleDisplaySettings;
};

type SubtitleDisplayStoredData = {
	current: SubtitleDisplaySettings;
	templates: SubtitleDisplayTemplate[];
};

// subtitles.js の config 構築部 (query params -> --st-* CSS variables) のデフォルト値と
// 完全一致させること。デフォルト値と同じ項目はURLから省略される (下の buildUrl 参照)
const DEFAULT_SETTINGS: SubtitleDisplaySettings = {
	font: '',
	fontUrl: '',
	fontSize: 32,
	transSize: 28,
	fontWeight: 700,
	textColor: '#ffffff',
	transColor: '#a8d8ff',
	outline: 4,
	outlineColor: '#000000',
	bgColor: '',
	bgImage: '',
	radius: 8,
	padding: 12,
	align: 'center',
	position: 'bottom',
	offset: 40,
	maxWidth: 90,
	original: true,
	translation: true,
	interim: 'brackets',
	cps: 4,
	minDur: 1.5,
	maxDur: 7,
	idleClear: 6,
};

const SETTINGS_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof SubtitleDisplaySettings)[];

const ALIGN_VALUES: readonly SubtitleDisplayAlign[] = ['left', 'center', 'right'];
const POSITION_VALUES: readonly SubtitleDisplayPosition[] = ['top', 'bottom'];
const INTERIM_VALUES: readonly SubtitleDisplayInterim[] = ['brackets', 'dim', 'hidden'];

function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
	return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? value as T : fallback;
}

function pickString(value: unknown, fallback: string): string {
	return typeof value === 'string' ? value : fallback;
}

function pickUrlString(value: unknown, fallback: string): string {
	if (typeof value !== 'string' || value.length === 0) return fallback;
	try {
		const u = new URL(value);
		if (u.protocol !== 'http:' && u.protocol !== 'https:') return fallback;
		return value;
	} catch {
		return fallback;
	}
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
// 数値は範囲外ならクランプ、enum は許可値以外ならデフォルト値にフォールバックする。
// min/max/enum は subtitles.js の対応する clampNumber/pickEnum 呼び出しと一致させること
function sanitizeSettings(raw: unknown): SubtitleDisplaySettings {
	const src = (raw != null && typeof raw === 'object') ? raw as Record<string, unknown> : {};
	return {
		font: pickString(src.font, DEFAULT_SETTINGS.font),
		fontUrl: pickUrlString(src.fontUrl, DEFAULT_SETTINGS.fontUrl),
		fontSize: clampNumber(src.fontSize, DEFAULT_SETTINGS.fontSize, 8, 96),
		transSize: clampNumber(src.transSize, DEFAULT_SETTINGS.transSize, 8, 96),
		fontWeight: clampNumber(src.fontWeight, DEFAULT_SETTINGS.fontWeight, 100, 900),
		textColor: pickString(src.textColor, DEFAULT_SETTINGS.textColor),
		transColor: pickString(src.transColor, DEFAULT_SETTINGS.transColor),
		outline: clampNumber(src.outline, DEFAULT_SETTINGS.outline, 0, 20),
		outlineColor: pickString(src.outlineColor, DEFAULT_SETTINGS.outlineColor),
		bgColor: pickString(src.bgColor, DEFAULT_SETTINGS.bgColor),
		bgImage: pickUrlString(src.bgImage, DEFAULT_SETTINGS.bgImage),
		radius: clampNumber(src.radius, DEFAULT_SETTINGS.radius, 0, 100),
		padding: clampNumber(src.padding, DEFAULT_SETTINGS.padding, 0, 100),
		align: pickEnum(src.align, ALIGN_VALUES, DEFAULT_SETTINGS.align),
		position: pickEnum(src.position, POSITION_VALUES, DEFAULT_SETTINGS.position),
		offset: clampNumber(src.offset, DEFAULT_SETTINGS.offset, 0, 400),
		maxWidth: clampNumber(src.maxWidth, DEFAULT_SETTINGS.maxWidth, 20, 100),
		original: pickBoolean(src.original, DEFAULT_SETTINGS.original),
		translation: pickBoolean(src.translation, DEFAULT_SETTINGS.translation),
		interim: pickEnum(src.interim, INTERIM_VALUES, DEFAULT_SETTINGS.interim),
		cps: clampNumber(src.cps, DEFAULT_SETTINGS.cps, 1, 30),
		minDur: clampNumber(src.minDur, DEFAULT_SETTINGS.minDur, 0.5, 5),
		maxDur: clampNumber(src.maxDur, DEFAULT_SETTINGS.maxDur, 2, 15),
		idleClear: clampNumber(src.idleClear, DEFAULT_SETTINGS.idleClear, 0, 60),
	};
}

function sanitizeTemplates(raw: unknown): SubtitleDisplayTemplate[] {
	if (!Array.isArray(raw)) return [];
	return raw
		.filter((t): t is Record<string, unknown> => t != null && typeof t === 'object')
		.map(t => ({
			name: pickString(t.name, ''),
			settings: sanitizeSettings(t.settings),
		}))
		.filter(t => t.name.length > 0);
}

function load(): SubtitleDisplayStoredData {
	try {
		const raw = miLocalStorage.getItem('liveSubtitleDisplay');
		if (raw == null) return { current: { ...DEFAULT_SETTINGS }, templates: [] };
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		return {
			current: sanitizeSettings(parsed.current),
			templates: sanitizeTemplates(parsed.templates),
		};
	} catch {
		return { current: { ...DEFAULT_SETTINGS }, templates: [] };
	}
}

function settingsEqual(a: SubtitleDisplaySettings, b: SubtitleDisplaySettings): boolean {
	return SETTINGS_KEYS.every(key => a[key] === b[key]);
}

function persist() {
	miLocalStorage.setItem('liveSubtitleDisplay', JSON.stringify({
		current: { ...committed },
		templates: templates.value,
	}));
}

const stored = load();

// 3段階の状態を持つ (comment-generator-settings.vue と同じ契約):
// draft (フォーム編集) → [プレビューに適用] → preview (iframeプレビューのみ更新) →
// [設定を反映] → committed (生成URL表示・URLコピー・miLocalStorage永続化に使われる、
// OBSで実際に使う本番URLの元)。フォーム編集は draft にのみ反映され、明示的な
// ボタン操作なしに preview/committed へは伝播しない
const draft = reactive<SubtitleDisplaySettings>({ ...stored.current });
const preview = reactive<SubtitleDisplaySettings>({ ...stored.current });
const committed = reactive<SubtitleDisplaySettings>({ ...stored.current });
const templates = ref<SubtitleDisplayTemplate[]>(stored.templates);

const templateBaseline = reactive<SubtitleDisplaySettings>({ ...stored.current });

const hasUnpreviewedChanges = computed(() => !settingsEqual(draft, preview));
const hasUncommittedChanges = computed(() => !settingsEqual(preview, committed));

function applyDraftToPreview() {
	Object.assign(preview, draft);
	Object.assign(templateBaseline, draft);
}

function commitPreview() {
	Object.assign(committed, preview);
	persist();
}

async function onRequestClose() {
	if (hasUncommittedChanges.value) {
		const { canceled } = await os.confirm({
			type: 'warning',
			text: i18n.ts._twitch.subtitleDisplayCloseConfirm,
		});
		if (canceled) return;
	}
	dialog.value?.close();
}

const positionItems = [
	{ value: 'bottom', label: i18n.ts._twitch.subtitleDisplayPositionBottom },
	{ value: 'top', label: i18n.ts._twitch.subtitleDisplayPositionTop },
];

const alignItems = [
	{ value: 'left', label: i18n.ts._twitch.subtitleDisplayAlignLeft },
	{ value: 'center', label: i18n.ts._twitch.subtitleDisplayAlignCenter },
	{ value: 'right', label: i18n.ts._twitch.subtitleDisplayAlignRight },
];

const interimItems = [
	{ value: 'brackets', label: i18n.ts._twitch.subtitleDisplayInterimBrackets },
	{ value: 'dim', label: i18n.ts._twitch.subtitleDisplayInterimDim },
	{ value: 'hidden', label: i18n.ts._twitch.subtitleDisplayInterimHidden },
];

//#region フォント (汎用フォントスタックのプリセット + Driveのカスタムフォント)
type FontPreset = {
	id: string;
	family: string;
	label: string;
};

// backend (subtitles.js) 側の sanitizeFontFamily が許可する文字種
// ([a-zA-Z0-9 ,._'"-]) の範囲内でのみ定義する
const FONT_PRESETS: FontPreset[] = [
	{ id: 'default', family: '', label: i18n.ts._twitch.subtitleDisplayFontPresetDefault },
	{ id: 'gothic', family: '"Hiragino Sans", "Yu Gothic", "Meiryo", sans-serif', label: i18n.ts._twitch.subtitleDisplayFontPresetGothic },
	{ id: 'mincho', family: '"Hiragino Mincho ProN", "Yu Mincho", "MS PMincho", serif', label: i18n.ts._twitch.subtitleDisplayFontPresetMincho },
	{ id: 'rounded', family: '"Zen Maru Gothic", "Rounded Mplus 1c", sans-serif', label: i18n.ts._twitch.subtitleDisplayFontPresetRounded },
	{ id: 'monospace', family: '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace', label: i18n.ts._twitch.subtitleDisplayFontPresetMonospace },
];

const DRIVE_FONT_ID = 'drive-custom';
const SELECT_DRIVE_FONT_ID = 'select-drive';
const LEGACY_FONT_ID = 'legacy-custom';

const driveFontFileName = ref('');

const fontPresetItems = computed(() => {
	const items = FONT_PRESETS.map(p => ({ value: p.id, label: p.label }));
	if (draft.fontUrl.length > 0) {
		items.push({
			value: DRIVE_FONT_ID,
			label: driveFontFileName.value.length > 0
				? i18n.tsx._twitch.subtitleDisplayFontDriveLabel({ name: driveFontFileName.value })
				: i18n.ts._twitch.subtitleDisplayFontDriveLabelUnknown,
		});
	} else if (draft.font.length > 0 && !FONT_PRESETS.some(p => p.family === draft.font)) {
		items.push({ value: LEGACY_FONT_ID, label: `${i18n.ts._twitch.subtitleDisplayFontPresetDefault} (${draft.font})` });
	}
	items.push({ value: SELECT_DRIVE_FONT_ID, label: i18n.ts._twitch.subtitleDisplayFontDriveSelect });
	return items;
});

const selectedFontId = computed(() => {
	if (draft.fontUrl.length > 0) return DRIVE_FONT_ID;
	const preset = FONT_PRESETS.find(p => p.family === draft.font);
	if (preset != null) return preset.id;
	if (draft.font.length > 0) return LEGACY_FONT_ID;
	return 'default';
});

function isFontDriveFile(file: { name: string; type: string }): boolean {
	if (/\.(woff2|woff|ttf|otf)$/i.test(file.name)) return true;
	const type = file.type.toLowerCase();
	return type.startsWith('font/') || type.startsWith('application/font-');
}

async function pickDriveFont() {
	const files = await chooseDriveFile({ multiple: false });
	const file = files[0];
	if (file == null) return;
	if (!isFontDriveFile(file)) {
		os.alert({ type: 'error', text: i18n.ts._twitch.subtitleDisplayFontDriveInvalidType });
		return;
	}
	draft.fontUrl = file.url;
	driveFontFileName.value = file.name;
}

function onSelectFont(id: string) {
	if (id === SELECT_DRIVE_FONT_ID) {
		pickDriveFont();
		return;
	}
	if (id === DRIVE_FONT_ID || id === LEGACY_FONT_ID) return;
	const preset = FONT_PRESETS.find(p => p.id === id);
	if (preset == null) return;
	draft.font = preset.family;
	draft.fontUrl = '';
	driveFontFileName.value = '';
}
//#endregion

//#region 背景画像 (Driveから選択、URLのみ保持)
function isImageDriveFile(file: { type: string }): boolean {
	return file.type.toLowerCase().startsWith('image/');
}

async function pickDriveBgImage() {
	const files = await chooseDriveFile({ multiple: false });
	const file = files[0];
	if (file == null) return;
	if (!isImageDriveFile(file)) {
		os.alert({ type: 'error', text: i18n.ts._twitch.subtitleDisplayFontDriveInvalidType });
		return;
	}
	draft.bgImage = file.url;
}

function clearBgImage() {
	draft.bgImage = '';
}
//#endregion

//#region 色 (input type=color + rgba/none 変換)
const DEFAULT_TEXT_COLOR_HEX = '#ffffff';
const DEFAULT_TRANS_COLOR_HEX = '#a8d8ff';
const DEFAULT_OUTLINE_COLOR_HEX = '#000000';
const DEFAULT_BG_COLOR_HEX = '#000000';
const DEFAULT_BG_OPACITY = 55; // %

function normalizeCssColor(input: string): string | null {
	const opt = window.document.createElement('option');
	opt.style.color = '';
	opt.style.color = input;
	return opt.style.color.length > 0 ? opt.style.color : null;
}

function parseCssColor(input: string): { r: number; g: number; b: number; a: number } | null {
	const normalized = normalizeCssColor(input);
	if (normalized == null) return null;
	const m = normalized.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/);
	if (m == null) return null;
	return {
		r: Number(m[1]),
		g: Number(m[2]),
		b: Number(m[3]),
		a: m[4] !== undefined ? Number(m[4]) : 1,
	};
}

function toHex2(n: number): string {
	return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
}

function rgbToHex(r: number, g: number, b: number): string {
	return `#${toHex2(r)}${toHex2(g)}${toHex2(b)}`;
}

function makeHexColorProxy(key: 'textColor' | 'transColor' | 'outlineColor', fallbackHex: string) {
	return computed<string>({
		get: () => {
			if (draft[key].length === 0) return fallbackHex;
			const parsed = parseCssColor(draft[key]);
			return parsed != null ? rgbToHex(parsed.r, parsed.g, parsed.b) : fallbackHex;
		},
		set: (hex: string) => {
			draft[key] = hex;
		},
	});
}

const textColorHex = makeHexColorProxy('textColor', DEFAULT_TEXT_COLOR_HEX);
const transColorHex = makeHexColorProxy('transColor', DEFAULT_TRANS_COLOR_HEX);
const outlineColorHex = makeHexColorProxy('outlineColor', DEFAULT_OUTLINE_COLOR_HEX);

// bgColor は "" (透過/背景なし) を持つ (subtitles.js 側の契約。comment-generator の
// 'none' とは異なる文字列だが役割は同じ)。透過をオンにしても直前の色/不透明度を記憶しておき、
// オフに戻したときに復元する
function initialBgMemory(): { hex: string; opacity: number } {
	if (draft.bgColor.length === 0) {
		return { hex: DEFAULT_BG_COLOR_HEX, opacity: DEFAULT_BG_OPACITY };
	}
	const parsed = parseCssColor(draft.bgColor);
	if (parsed == null) return { hex: DEFAULT_BG_COLOR_HEX, opacity: DEFAULT_BG_OPACITY };
	return { hex: rgbToHex(parsed.r, parsed.g, parsed.b), opacity: Math.round(parsed.a * 100) };
}

const bgMemory = reactive(initialBgMemory());

function applyBgColorFromMemory() {
	const parsed = parseCssColor(bgMemory.hex) ?? { r: 0, g: 0, b: 0 };
	draft.bgColor = `rgba(${parsed.r}, ${parsed.g}, ${parsed.b}, ${(bgMemory.opacity / 100).toFixed(2)})`;
}

const bgTransparent = computed<boolean>({
	get: () => draft.bgColor === '',
	set: (transparent: boolean) => {
		if (transparent) {
			draft.bgColor = '';
		} else {
			applyBgColorFromMemory();
		}
	},
});

const bgColorHex = computed<string>({
	get: () => bgMemory.hex,
	set: (hex: string) => {
		bgMemory.hex = hex;
		if (draft.bgColor !== '') applyBgColorFromMemory();
	},
});

const bgOpacity = computed<number>({
	get: () => bgMemory.opacity,
	set: (opacity: number) => {
		bgMemory.opacity = opacity;
		if (draft.bgColor !== '') applyBgColorFromMemory();
	},
});
//#endregion

//#region テンプレート (組み込みプリセット + ユーザー保存分)
type SubtitleDisplayPreset = {
	id: string;
	name: string;
	overrides: Partial<SubtitleDisplaySettings>;
};

const BUILTIN_PRESETS: SubtitleDisplayPreset[] = [
	{ id: 'builtin:standard', name: i18n.ts._twitch.subtitleDisplayPresetStandard, overrides: {} },
	{
		id: 'builtin:top',
		name: i18n.ts._twitch.subtitleDisplayPresetTop,
		overrides: { position: 'top' },
	},
	{
		id: 'builtin:minimal',
		name: i18n.ts._twitch.subtitleDisplayPresetMinimal,
		overrides: { bgColor: '', outline: 3, fontWeight: 900 },
	},
	{
		id: 'builtin:boxed',
		name: i18n.ts._twitch.subtitleDisplayPresetBoxed,
		overrides: { bgColor: 'rgba(0,0,0,0.65)', outline: 0, radius: 12, padding: 16 },
	},
];

const USER_ID_PREFIX = 'user:';

const selectedPresetId = ref<string>('builtin:standard');

const isUserTemplateSelected = computed(() => selectedPresetId.value.startsWith(USER_ID_PREFIX));

const presetItems = computed(() => [
	...BUILTIN_PRESETS.map(p => ({ value: p.id, label: p.name })),
	...templates.value.map((t, i) => ({ value: `${USER_ID_PREFIX}${i}`, label: t.name })),
]);

const selectedPresetLabel = computed(() => presetItems.value.find(item => item.value === selectedPresetId.value)?.label ?? '');

function findSelectedUserTemplateIndex(): number | null {
	if (!selectedPresetId.value.startsWith(USER_ID_PREFIX)) return null;
	const idx = Number(selectedPresetId.value.slice(USER_ID_PREFIX.length));
	return templates.value[idx] != null ? idx : null;
}

function applyPresetToDraft(id: string) {
	if (id.startsWith(USER_ID_PREFIX)) {
		const idx = Number(id.slice(USER_ID_PREFIX.length));
		const template = templates.value[idx];
		if (template == null) return;
		Object.assign(draft, sanitizeSettings(template.settings));
		return;
	}
	const preset = BUILTIN_PRESETS.find(p => p.id === id);
	if (preset == null) return;
	Object.assign(draft, DEFAULT_SETTINGS, preset.overrides);
}

// テンプレート選択は os.popupMenu で直接実装する (MkSelect の v-model / defineModel は
// 「選択中の値と同じ値を選び直す」ケースで emit そのものを抑止してしまうため、comment-generator
// の設定ダイアログと同じ回避策を踏襲する)
async function onSelectPreset(id: string) {
	if (!settingsEqual(draft, templateBaseline)) {
		const { canceled } = await os.confirm({
			type: 'warning',
			text: i18n.ts._twitch.subtitleDisplayDiscardConfirm,
		});
		if (canceled) return;
	}
	selectedPresetId.value = id;
	applyPresetToDraft(id);
	Object.assign(templateBaseline, draft);
}

function showPresetMenu() {
	const menu = presetItems.value.map(item => ({
		text: item.label,
		active: item.value === selectedPresetId.value,
		action: () => onSelectPreset(item.value),
	}));
	os.popupMenu(menu, presetPickerButtonEl.value);
}

async function saveAsNewTemplate() {
	const { canceled, result } = await os.inputText({
		title: i18n.ts._twitch.subtitleDisplayTemplateNamePrompt,
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
			text: i18n.tsx._twitch.subtitleDisplayTemplateOverwriteConfirm({ name }),
		});
		if (overwriteCanceled) return;
		templates.value[existingIndex] = { name, settings: { ...draft } };
		selectedPresetId.value = `${USER_ID_PREFIX}${existingIndex}`;
	} else {
		templates.value.push({ name, settings: { ...draft } });
		selectedPresetId.value = `${USER_ID_PREFIX}${templates.value.length - 1}`;
	}
	Object.assign(templateBaseline, draft);
	persist();
	os.toast(i18n.ts._twitch.subtitleDisplayTemplateSaved);
}

function overwriteSelectedTemplate() {
	const idx = findSelectedUserTemplateIndex();
	if (idx == null) return;
	templates.value[idx] = { name: templates.value[idx].name, settings: { ...draft } };
	Object.assign(templateBaseline, draft);
	persist();
	os.toast(i18n.ts._twitch.subtitleDisplayTemplateSaved);
}

async function deleteSelectedTemplate() {
	const idx = findSelectedUserTemplateIndex();
	if (idx == null) return;
	const name = templates.value[idx].name;
	const { canceled } = await os.confirm({
		type: 'warning',
		text: i18n.tsx._twitch.subtitleDisplayTemplateDeleteConfirm({ name }),
	});
	if (canceled) return;
	templates.value.splice(idx, 1);
	selectedPresetId.value = 'builtin:standard';
	persist();
}

function exportSettings() {
	copyToClipboard(JSON.stringify(draft));
}

async function importSettings() {
	const { canceled, result } = await os.inputText({
		title: i18n.ts._twitch.subtitleDisplayImportPrompt,
		default: '',
	});
	if (canceled || result == null) return;
	try {
		const parsed = JSON.parse(result);
		Object.assign(draft, sanitizeSettings(parsed));
		selectedPresetId.value = 'builtin:standard';
		Object.assign(templateBaseline, draft);
		os.toast(i18n.ts._twitch.subtitleDisplayImported);
	} catch {
		os.alert({ type: 'error', text: i18n.ts._twitch.subtitleDisplayImportFailed });
	}
}
//#endregion

// デフォルト値と同じ項目はURLに含めない (短いURLを保つ、subtitles.js 側の契約と一致)。
// 真偽値は 1/0 で表現する。iframeプレビューは preview (プレビューに適用済み) から、
// 生成URL表示・URLコピー・新規タブでの確認はいずれも committed (設定を反映済み、
// OBSで使う本番用URLの元) から生成する
function buildUrl(source: SubtitleDisplaySettings, demo: boolean): string {
	const params = new URLSearchParams();
	for (const key of SETTINGS_KEYS) {
		const value = source[key];
		const defaultValue = DEFAULT_SETTINGS[key];
		if (value === defaultValue) continue;
		params.set(key, typeof value === 'boolean' ? (value ? '1' : '0') : String(value));
	}
	if (demo) params.set('demo', '1');
	const qs = params.toString();
	return `${serverUrl}/live/${props.acct}/subtitles${qs.length > 0 ? `?${qs}` : ''}`;
}

const generatedUrl = computed(() => buildUrl(committed, false));
const previewSrc = computed(() => buildUrl(preview, true));

function copyUrl() {
	copyToClipboard(generatedUrl.value);
}

function openPreviewUrl() {
	window.open(buildUrl(committed, true), '_blank', 'noopener');
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
	height: 220px;
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

.applySection {
	display: flex;
	align-items: center;
	gap: 10px;
	flex-wrap: wrap;
}

.unappliedBadge {
	font-size: 0.85em;
	color: var(--MI_THEME-warn);
	display: inline-flex;
	align-items: center;
	gap: 4px;
}

.presetPickerLabel {
	font-size: 0.85em;
	opacity: 0.8;
}

.presetPickerButton {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
	width: 100%;
	height: 42px;
	padding: 0 12px;
	box-sizing: border-box;
	background: var(--MI_THEME-panel);
	border: solid 1px var(--MI_THEME-panel);
	border-radius: 6px;
	color: var(--MI_THEME-fg);

	&:hover {
		border-color: var(--MI_THEME-inputBorderHover);
	}

	&:focus-visible {
		outline: 2px solid var(--MI_THEME-accent);
		outline-offset: -2px;
	}
}

.urlSection {
	padding-top: 8px;
	border-top: solid 1px var(--MI_THEME-divider);
}

.urlLabel {
	font-size: 0.85em;
	padding-bottom: 8px;
	opacity: 0.8;
	display: flex;
	align-items: center;
	gap: 8px;
	flex-wrap: wrap;
}

.uncommittedBadge {
	color: var(--MI_THEME-warn);
	display: inline-flex;
	align-items: center;
	gap: 4px;
}

.commitHint {
	font-size: 0.85em;
	color: var(--MI_THEME-warn);
	padding-top: 8px;
}

.urlBox {
	padding: 10px 12px;
	margin-bottom: 12px;
	font-size: 0.9em;
	word-break: break-all;
	border-radius: var(--MI-radius, 8px);
}

.previewText {
	min-height: 1.4em;
	word-break: break-all;
	font-size: 0.85em;
	opacity: 0.85;
}
</style>
