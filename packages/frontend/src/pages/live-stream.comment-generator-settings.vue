<!--
SPDX-FileCopyrightText: syuilo and misskey-project
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
	<template #header>{{ i18n.ts._twitch.commentGenSettings }}</template>

	<div class="_spacer" style="--MI_SPACER-min: 20px; --MI_SPACER-max: 28px;">
		<div class="_gaps_m">
			<MkInfo>{{ i18n.ts._twitch.commentGenDescription }}</MkInfo>

			<div :class="$style.previewSection">
				<div :class="$style.previewLabel">{{ i18n.ts._twitch.commentGenLivePreview }}</div>
				<iframe :class="$style.previewFrame" :src="previewSrc" :title="i18n.ts._twitch.commentGenLivePreview" frameborder="0"></iframe>
			</div>

			<div :class="$style.applySection">
				<MkButton :primary="hasUnpreviewedChanges" @click="applyDraftToPreview">
					<i class="ti ti-device-floppy"></i> {{ i18n.ts._twitch.commentGenApply }}
				</MkButton>
				<span v-if="hasUnpreviewedChanges" :class="$style.unappliedBadge">
					<i class="ti ti-alert-circle"></i> {{ i18n.ts._twitch.commentGenUnappliedChanges }}
				</span>
			</div>

			<MkFolder :defaultOpen="true">
				<template #icon><i class="ti ti-template"></i></template>
				<template #label>{{ i18n.ts._twitch.commentGenTemplateGroup }}</template>

				<div class="_gaps_s">
					<div :class="$style.presetPickerLabel">{{ i18n.ts._twitch.commentGenTemplateSelect }}</div>
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
					<MkSelect v-model="draft.mode" :items="modeItems">
						<template #label>{{ i18n.ts._twitch.commentGenMode }}</template>
					</MkSelect>
					<div :class="$style.positionGroupLabel">{{ i18n.ts._twitch.commentGenPositionGroup }}</div>
					<MkSelect v-model="draft.order" :items="orderItems">
						<template #label>{{ i18n.ts._twitch.commentGenOrder }}</template>
					</MkSelect>
					<MkSelect v-model="draft.align" :items="alignItems">
						<template #label>{{ i18n.ts._twitch.commentGenAlign }}</template>
					</MkSelect>
					<MkInput v-model="draft.limit" type="number" :min="1" :max="50">
						<template #label>{{ i18n.ts._twitch.commentGenLimit }}</template>
					</MkInput>
					<MkInput v-if="draft.mode === 'fade'" v-model="draft.duration" type="number" :min="0" :max="600000" :step="500">
						<template #label>{{ i18n.ts._twitch.commentGenDuration }}</template>
						<template #suffix>ms</template>
						<template #caption>{{ i18n.ts._twitch.commentGenDurationDescription }}</template>
					</MkInput>
					<MkInput v-model="draft.history" type="number" :min="0" :max="30">
						<template #label>{{ i18n.ts._twitch.commentGenHistory }}</template>
						<template #caption>{{ i18n.ts._twitch.commentGenHistoryDescription }}</template>
					</MkInput>
				</div>
			</MkFolder>

			<MkFolder>
				<template #icon><i class="ti ti-typography"></i></template>
				<template #label>{{ i18n.ts._twitch.commentGenFontGroup }}</template>

				<div class="_gaps_s">
					<MkSelect v-model="selectedFontId" :items="fontPresetItems" @update:modelValue="onSelectFont">
						<template #label>{{ i18n.ts._twitch.commentGenFont }}</template>
						<template #caption>{{ i18n.ts._twitch.commentGenFontDescription }}</template>
					</MkSelect>
					<MkInput v-model="draft.fontSize" type="number" :min="8" :max="96">
						<template #label>{{ i18n.ts._twitch.commentGenFontSize }}</template>
						<template #suffix>px</template>
					</MkInput>
					<MkSelect v-model="draft.fontWeight" :items="fontWeightItems">
						<template #label>{{ i18n.ts._twitch.commentGenFontWeight }}</template>
					</MkSelect>
				</div>
			</MkFolder>

			<MkFolder>
				<template #icon><i class="ti ti-palette"></i></template>
				<template #label>{{ i18n.ts._twitch.commentGenColorGroup }}</template>

				<div class="_gaps_s">
					<MkColorInput v-model="textColorHex">
						<template #label>{{ i18n.ts._twitch.commentGenTextColor }}</template>
					</MkColorInput>
					<MkColorInput v-model="nameColorHex">
						<template #label>{{ i18n.ts._twitch.commentGenNameColor }}</template>
					</MkColorInput>
					<MkColorInput v-model="transColorHex">
						<template #label>{{ i18n.ts._twitch.commentGenTransColor }}</template>
					</MkColorInput>
					<MkSwitch v-model="bgTransparent">
						{{ i18n.ts._twitch.commentGenBgTransparent }}
						<template #caption>{{ i18n.ts._twitch.commentGenBgColorDescription }}</template>
					</MkSwitch>
					<template v-if="!bgTransparent">
						<MkColorInput v-model="bgColorHex">
							<template #label>{{ i18n.ts._twitch.commentGenBgColor }}</template>
						</MkColorInput>
						<MkRange v-model="bgOpacity" :min="0" :max="100" :step="1">
							<template #label>{{ i18n.ts._twitch.commentGenBgOpacity }}</template>
							<template #suffix>%</template>
						</MkRange>
					</template>
					<MkColorInput v-model="outlineColorHex">
						<template #label>{{ i18n.ts._twitch.commentGenOutlineColor }}</template>
					</MkColorInput>
				</div>
			</MkFolder>

			<MkFolder>
				<template #icon><i class="ti ti-layout"></i></template>
				<template #label>{{ i18n.ts._twitch.commentGenLayoutGroup }}</template>

				<div class="_gaps_s">
					<MkInput v-model="draft.outline" type="number" :min="0" :max="20">
						<template #label>{{ i18n.ts._twitch.commentGenOutline }}</template>
						<template #suffix>px</template>
						<template #caption>{{ i18n.ts._twitch.commentGenOutlineDescription }}</template>
					</MkInput>
					<MkInput v-model="draft.radius" type="number" :min="0" :max="100">
						<template #label>{{ i18n.ts._twitch.commentGenRadius }}</template>
						<template #suffix>px</template>
					</MkInput>
					<MkInput v-model="draft.padding" type="number" :min="0" :max="100">
						<template #label>{{ i18n.ts._twitch.commentGenPadding }}</template>
						<template #suffix>px</template>
					</MkInput>
					<MkInput v-model="draft.gap" type="number" :min="0" :max="100">
						<template #label>{{ i18n.ts._twitch.commentGenGap }}</template>
						<template #suffix>px</template>
					</MkInput>
					<MkInput v-model="draft.iconSize" type="number" :min="12" :max="128">
						<template #label>{{ i18n.ts._twitch.commentGenIconSize }}</template>
						<template #suffix>px</template>
					</MkInput>
					<MkInput v-model="draft.emojiScale" type="number" :min="0.5" :max="4" :step="0.1">
						<template #label>{{ i18n.ts._twitch.commentGenEmojiScale }}</template>
					</MkInput>
				</div>
			</MkFolder>

			<MkFolder>
				<template #icon><i class="ti ti-player-play"></i></template>
				<template #label>{{ i18n.ts._twitch.commentGenAnimGroup }}</template>

				<div class="_gaps_s">
					<MkSelect v-model="draft.animIn" :items="animInItems">
						<template #label>{{ i18n.ts._twitch.commentGenAnimIn }}</template>
					</MkSelect>
					<MkSelect v-model="draft.animOut" :items="animOutItems">
						<template #label>{{ i18n.ts._twitch.commentGenAnimOut }}</template>
					</MkSelect>
					<MkInput v-model="draft.animTime" type="number" :min="0" :max="5000" :step="50">
						<template #label>{{ i18n.ts._twitch.commentGenAnimTime }}</template>
						<template #suffix>ms</template>
					</MkInput>
				</div>
			</MkFolder>

			<MkFolder>
				<template #icon><i class="ti ti-eye"></i></template>
				<template #label>{{ i18n.ts._twitch.commentGenElementsGroup }}</template>

				<div class="_gaps_s">
					<MkSwitch v-model="draft.icon">{{ i18n.ts._twitch.commentGenShowIcon }}</MkSwitch>
					<MkSwitch v-model="draft.name">{{ i18n.ts._twitch.commentGenShowName }}</MkSwitch>
					<MkSwitch v-model="draft.translation">{{ i18n.ts._twitch.commentGenShowTranslation }}</MkSwitch>
					<MkSwitch v-model="draft.media">{{ i18n.ts._twitch.commentGenShowMedia }}</MkSwitch>
				</div>
			</MkFolder>

			<div :class="$style.urlSection">
				<div :class="$style.urlLabel">
					{{ i18n.ts._twitch.commentGenGeneratedUrl }}
					<span v-if="hasUncommittedChanges" :class="$style.uncommittedBadge">
						<i class="ti ti-alert-circle"></i> {{ i18n.ts._twitch.commentGenUncommittedBadge }}
					</span>
				</div>
				<div class="_panel _selectable" :class="$style.urlBox">{{ generatedUrl }}</div>
				<div class="_buttons">
					<MkButton :primary="hasUncommittedChanges" :disabled="!hasUncommittedChanges" @click="commitPreview"><i class="ti ti-cloud-upload"></i> {{ i18n.ts._twitch.commentGenCommit }}</MkButton>
					<MkButton @click="copyUrl"><i class="ti ti-copy"></i> {{ i18n.ts._twitch.commentGenCopyUrl }}</MkButton>
					<MkButton @click="openPreviewUrl"><i class="ti ti-external-link"></i> {{ i18n.ts._twitch.commentGenOpenPreview }}</MkButton>
				</div>
				<div v-if="hasUnpreviewedChanges" :class="$style.commitHint">{{ i18n.ts._twitch.commentGenCommitHint }}</div>
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

// OBS用コメントジェネレーターページ (backend側で実装、素のHTML + URLクエリパラメータ駆動) の
// 設定ビルダー。backend実装と合意済みのクエリパラメータ契約はこのファイルのみが把握しており、
// backend/HTMLページ側の実装には立ち入らない
type CommentGenMode = 'fade' | 'stack';
type CommentGenOrder = 'bottom' | 'top';
type CommentGenAlign = 'left' | 'center' | 'right';
type CommentGenAnimIn = 'slide' | 'slideRight' | 'fade' | 'pop' | 'none';
type CommentGenAnimOut = 'fade' | 'slideLeft' | 'none';

type CommentGenSettings = {
	mode: CommentGenMode;
	limit: number;
	duration: number;
	order: CommentGenOrder;
	align: CommentGenAlign;
	animIn: CommentGenAnimIn;
	animOut: CommentGenAnimOut;
	animTime: number;
	font: string;
	fontUrl: string;
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
	align: 'left',
	animIn: 'slide',
	animOut: 'fade',
	animTime: 300,
	font: '',
	fontUrl: '',
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

const SETTINGS_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof CommentGenSettings)[];

const MODE_VALUES: readonly CommentGenMode[] = ['fade', 'stack'];
const ORDER_VALUES: readonly CommentGenOrder[] = ['bottom', 'top'];
const ALIGN_VALUES: readonly CommentGenAlign[] = ['left', 'center', 'right'];
const ANIM_IN_VALUES: readonly CommentGenAnimIn[] = ['slide', 'slideRight', 'fade', 'pop', 'none'];
const ANIM_OUT_VALUES: readonly CommentGenAnimOut[] = ['fade', 'slideLeft', 'none'];

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
// 数値は範囲外ならクランプ、enum は許可値以外ならデフォルト値にフォールバックする
function sanitizeSettings(raw: unknown): CommentGenSettings {
	const src = (raw != null && typeof raw === 'object') ? raw as Record<string, unknown> : {};
	return {
		mode: pickEnum(src.mode, MODE_VALUES, DEFAULT_SETTINGS.mode),
		limit: clampNumber(src.limit, DEFAULT_SETTINGS.limit, 1, 50),
		duration: clampNumber(src.duration, DEFAULT_SETTINGS.duration, 0, 600000),
		order: pickEnum(src.order, ORDER_VALUES, DEFAULT_SETTINGS.order),
		align: pickEnum(src.align, ALIGN_VALUES, DEFAULT_SETTINGS.align),
		animIn: pickEnum(src.animIn, ANIM_IN_VALUES, DEFAULT_SETTINGS.animIn),
		animOut: pickEnum(src.animOut, ANIM_OUT_VALUES, DEFAULT_SETTINGS.animOut),
		animTime: clampNumber(src.animTime, DEFAULT_SETTINGS.animTime, 0, 5000),
		font: pickString(src.font, DEFAULT_SETTINGS.font),
		fontUrl: pickUrlString(src.fontUrl, DEFAULT_SETTINGS.fontUrl),
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

function settingsEqual(a: CommentGenSettings, b: CommentGenSettings): boolean {
	return SETTINGS_KEYS.every(key => a[key] === b[key]);
}

function persist() {
	miLocalStorage.setItem('twitchCommentGen', JSON.stringify({
		current: { ...committed },
		templates: templates.value,
	}));
}

const stored = load();

// 3段階の状態を持つ:
// draft (フォーム編集) → [プレビューに適用] → preview (iframeプレビューのみ更新) →
// [設定を反映] → committed (生成URL表示・URLコピー・miLocalStorage永続化に使われる、OBSで実際に使う本番URLの元)
// フォーム編集は draft にのみ反映され、明示的なボタン操作なしに preview/committed へは伝播しない
// (旧デバウンス自動反映は撤去済み)
const draft = reactive<CommentGenSettings>({ ...stored.current });
const preview = reactive<CommentGenSettings>({ ...stored.current });
const committed = reactive<CommentGenSettings>({ ...stored.current });
const templates = ref<CommentGenTemplate[]>(stored.templates);

// 「最後に適用したテンプレート or 保存済み値」を表す基準値。draft がこれと異なる状態で
// 別のテンプレートを選択しようとしたら確認ダイアログを出す
const templateBaseline = reactive<CommentGenSettings>({ ...stored.current });

// draft が preview からまだ「プレビューに適用」されていない変更を持っているか
const hasUnpreviewedChanges = computed(() => !settingsEqual(draft, preview));
// preview が committed (生成URL・OBS本番URLの元) へまだ「設定を反映」されていない変更を持っているか
const hasUncommittedChanges = computed(() => !settingsEqual(preview, committed));

function applyDraftToPreview() {
	Object.assign(preview, draft);
	Object.assign(templateBaseline, draft);
}

// 「設定を反映」: その時点の preview (=ユーザーがプレビューで確認済みの内容) を
// committed (生成URL・URLコピー・永続化) へ昇格させる。draft に未プレビューの変更が
// 残っていてもここでは含めない (先に「プレビューに適用」を促すヒントを別途表示する)
function commitPreview() {
	Object.assign(committed, preview);
	persist();
}

async function onRequestClose() {
	if (hasUncommittedChanges.value) {
		const { canceled } = await os.confirm({
			type: 'warning',
			text: i18n.ts._twitch.commentGenCloseConfirm,
		});
		if (canceled) return;
	}
	dialog.value?.close();
}

const modeItems = [
	{ value: 'fade', label: i18n.ts._twitch.commentGenModeFade },
	{ value: 'stack', label: i18n.ts._twitch.commentGenModeStack },
];

const orderItems = [
	{ value: 'bottom', label: i18n.ts._twitch.commentGenOrderBottom },
	{ value: 'top', label: i18n.ts._twitch.commentGenOrderTop },
];

const alignItems = [
	{ value: 'left', label: i18n.ts._twitch.commentGenAlignLeft },
	{ value: 'center', label: i18n.ts._twitch.commentGenAlignCenter },
	{ value: 'right', label: i18n.ts._twitch.commentGenAlignRight },
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

//#region フォント (汎用フォントスタックのプリセット + Driveのカスタムフォント)
type FontPreset = {
	id: string;
	family: string;
	label: string;
};

// backend (comment-generator.js) 側の sanitizeFontFamily が許可する文字種
// ([a-zA-Z0-9 ,._'"-]) の範囲内でのみ定義する
const FONT_PRESETS: FontPreset[] = [
	{ id: 'default', family: '', label: i18n.ts._twitch.commentGenFontPresetDefault },
	{ id: 'gothic', family: '"Hiragino Sans", "Yu Gothic", "Meiryo", sans-serif', label: i18n.ts._twitch.commentGenFontPresetGothic },
	{ id: 'mincho', family: '"Hiragino Mincho ProN", "Yu Mincho", "MS PMincho", serif', label: i18n.ts._twitch.commentGenFontPresetMincho },
	{ id: 'rounded', family: '"Zen Maru Gothic", "Rounded Mplus 1c", sans-serif', label: i18n.ts._twitch.commentGenFontPresetRounded },
	{ id: 'monospace', family: '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace', label: i18n.ts._twitch.commentGenFontPresetMonospace },
];

const DRIVE_FONT_ID = 'drive-custom';
const SELECT_DRIVE_FONT_ID = 'select-drive';
const LEGACY_FONT_ID = 'legacy-custom';

// Driveから選んだフォントファイルの表示名 (見た目のみ、URLパラメータ契約には含めない)
const driveFontFileName = ref('');

const fontPresetItems = computed(() => {
	const items = FONT_PRESETS.map(p => ({ value: p.id, label: p.label }));
	if (draft.fontUrl.length > 0) {
		items.push({
			value: DRIVE_FONT_ID,
			label: driveFontFileName.value.length > 0
				? i18n.tsx._twitch.commentGenFontDriveLabel({ name: driveFontFileName.value })
				: i18n.ts._twitch.commentGenFontDriveLabelUnknown,
		});
	} else if (draft.font.length > 0 && !FONT_PRESETS.some(p => p.family === draft.font)) {
		// このコンポーネント導入前に自由入力されていたフォント文字列との互換用
		items.push({ value: LEGACY_FONT_ID, label: `${i18n.ts._twitch.commentGenFontPresetDefault} (${draft.font})` });
	}
	items.push({ value: SELECT_DRIVE_FONT_ID, label: i18n.ts._twitch.commentGenFontDriveSelect });
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
		os.alert({ type: 'error', text: i18n.ts._twitch.commentGenFontDriveInvalidType });
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
	if (id === DRIVE_FONT_ID || id === LEGACY_FONT_ID) return; // 見た目のみの選択肢、実際の値は変えない
	const preset = FONT_PRESETS.find(p => p.id === id);
	if (preset == null) return;
	draft.font = preset.family;
	draft.fontUrl = '';
	driveFontFileName.value = '';
}
//#endregion

//#region 色 (input type=color + rgba/none 変換)
const DEFAULT_TEXT_COLOR_HEX = '#ffffff';
const DEFAULT_NAME_COLOR_HEX = '#ffe08a';
const DEFAULT_TRANS_COLOR_HEX = '#b9e3ff';
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

// パースできない既存値はデフォルトにフォールバックする単純な色 (透過なし) 用の v-model プロキシ
function makeHexColorProxy(key: 'textColor' | 'nameColor' | 'transColor' | 'outlineColor', fallbackHex: string) {
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
const nameColorHex = makeHexColorProxy('nameColor', DEFAULT_NAME_COLOR_HEX);
const transColorHex = makeHexColorProxy('transColor', DEFAULT_TRANS_COLOR_HEX);
const outlineColorHex = makeHexColorProxy('outlineColor', DEFAULT_OUTLINE_COLOR_HEX);

// bgColor は "none" (透過) を持つため、hex + 不透明度 + 透過スイッチの複合 UI にする。
// 透過をオンにしても直前の色/不透明度を記憶しておき、オフに戻したときに復元する
function initialBgMemory(): { hex: string; opacity: number } {
	if (draft.bgColor.length === 0 || draft.bgColor === 'none') {
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
	get: () => draft.bgColor === 'none',
	set: (transparent: boolean) => {
		if (transparent) {
			draft.bgColor = 'none';
		} else {
			applyBgColorFromMemory();
		}
	},
});

const bgColorHex = computed<string>({
	get: () => bgMemory.hex,
	set: (hex: string) => {
		bgMemory.hex = hex;
		if (draft.bgColor !== 'none') applyBgColorFromMemory();
	},
});

const bgOpacity = computed<number>({
	get: () => bgMemory.opacity,
	set: (opacity: number) => {
		bgMemory.opacity = opacity;
		if (draft.bgColor !== 'none') applyBgColorFromMemory();
	},
});
//#endregion

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
// 「選択中の値と同じ値を選び直す」ケースで emit そのものを抑止してしまい、既に選択中の
// テンプレートを選び直しても何も起きないバグの原因だった。ここでは menu の action が
// 常にクリックのたびに呼ばれるため、再選択でも確実に再適用できる)
async function onSelectPreset(id: string) {
	if (!settingsEqual(draft, templateBaseline)) {
		const { canceled } = await os.confirm({
			type: 'warning',
			text: i18n.ts._twitch.commentGenDiscardConfirm,
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
		templates.value[existingIndex] = { name, settings: { ...draft } };
		selectedPresetId.value = `${USER_ID_PREFIX}${existingIndex}`;
	} else {
		templates.value.push({ name, settings: { ...draft } });
		selectedPresetId.value = `${USER_ID_PREFIX}${templates.value.length - 1}`;
	}
	Object.assign(templateBaseline, draft);
	persist();
	os.toast(i18n.ts._twitch.commentGenTemplateSaved);
}

function overwriteSelectedTemplate() {
	const idx = findSelectedUserTemplateIndex();
	if (idx == null) return;
	templates.value[idx] = { name: templates.value[idx].name, settings: { ...draft } };
	Object.assign(templateBaseline, draft);
	persist();
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
	persist();
}

function exportSettings() {
	copyToClipboard(JSON.stringify(draft));
}

async function importSettings() {
	const { canceled, result } = await os.inputText({
		title: i18n.ts._twitch.commentGenImportPrompt,
		default: '',
	});
	if (canceled || result == null) return;
	try {
		const parsed = JSON.parse(result);
		Object.assign(draft, sanitizeSettings(parsed));
		// インポートした内容はどの組み込み/保存済テンプレートとも一致しないため選択状態を外す
		selectedPresetId.value = 'builtin:standard';
		Object.assign(templateBaseline, draft);
		os.toast(i18n.ts._twitch.commentGenImported);
	} catch {
		os.alert({ type: 'error', text: i18n.ts._twitch.commentGenImportFailed });
	}
}
//#endregion

// デフォルト値と同じ項目はURLに含めない (短いURLを保つ)。真偽値は 1/0 で表現する
// iframeプレビューは preview (プレビューに適用済み) から、生成URL表示・URLコピー・
// 新規タブでの確認はいずれも committed (設定を反映済み、OBSで使う本番用URLの元) から生成する
function buildUrl(source: CommentGenSettings, demo: boolean): string {
	const params = new URLSearchParams();
	for (const key of SETTINGS_KEYS) {
		const value = source[key];
		const defaultValue = DEFAULT_SETTINGS[key];
		if (value === defaultValue) continue;
		params.set(key, typeof value === 'boolean' ? (value ? '1' : '0') : String(value));
	}
	if (demo) params.set('demo', '1');
	const qs = params.toString();
	return `${serverUrl}/live/${props.acct}/comment-generator${qs.length > 0 ? `?${qs}` : ''}`;
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

.positionGroupLabel {
	font-size: 0.85em;
	opacity: 0.8;
	padding-top: 4px;
	border-top: solid 1px var(--MI_THEME-divider);
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
</style>
