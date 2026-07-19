<!--
SPDX-FileCopyrightText: misskey-bsky-integration fork
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkModalWindow
	ref="dialog"
	:width="480"
	:height="680"
	@close="dialog?.close()"
	@closed="emit('closed')"
>
	<template #header>{{ i18n.ts._twitch.subtitleSettings }}</template>

	<div class="_spacer" style="--MI_SPACER-min: 20px; --MI_SPACER-max: 28px;">
		<div class="_gaps_m">
			<div :class="$style.startStopRow">
				<MkButton v-if="!running" primary rounded @click="onStart">
					<i class="ti ti-microphone"></i> {{ i18n.ts._twitch.subtitleStart }}
				</MkButton>
				<MkButton v-else danger rounded @click="onStop">
					<i class="ti ti-microphone-off"></i> {{ i18n.ts._twitch.subtitleStop }}
				</MkButton>
				<span v-if="running" :class="$style.runningBadge">
					<i class="ti ti-point-filled"></i> {{ i18n.ts._twitch.subtitleRunningIndicator }}
				</span>
			</div>

			<MkInfo v-if="asrStatus === 'unsupported'" warn>
				{{ i18n.ts._twitch.subtitleErrorUnsupportedBrowser }}
			</MkInfo>
			<MkInfo v-else-if="asrStatus === 'error'">
				{{ i18n.ts._twitch.subtitleAsrStatusError }}{{ asrErrorMessage ? `: ${asrErrorMessage}` : '' }}
			</MkInfo>

			<div :class="$style.previewBox">
				<div :class="$style.previewLabel">{{ i18n.ts._twitch.subtitlePreviewCaption }}</div>
				<div :class="$style.previewText">
					<template v-if="currentCaption != null">
						<template v-if="!currentCaption.isFinal">&lt;&lt;{{ currentCaption.text }}&gt;&gt;</template>
						<template v-else>{{ currentCaption.text }}</template>
					</template>
					<span v-else :class="$style.previewEmpty">—</span>
				</div>
				<div :class="$style.previewLabel">{{ i18n.ts._twitch.subtitlePreviewTranslation }}</div>
				<div :class="$style.previewText">
					{{ currentTranslation ?? '—' }}
				</div>
			</div>

			<MkFolder>
				<template #label>{{ i18n.ts._twitch.subtitleAsrEngine }}</template>

				<div class="_gaps_s">
					<MkSelect v-model="settings.engine" :items="asrEngineItems" :disabled="running">
						<template #label>{{ i18n.ts._twitch.subtitleAsrEngine }}</template>
					</MkSelect>
					<MkInfo v-if="settings.engine === 'wasm'">
						{{ i18n.ts._twitch.subtitleAsrEngineWasmNotice }}
					</MkInfo>

					<div :class="$style.micRow">
						<MkSelect v-model="micDeviceIdModel" :items="micItems" :disabled="running">
							<template #label>{{ i18n.ts._twitch.subtitleMicDevice }}</template>
						</MkSelect>
						<MkButton :disabled="loadingMics" @click="refreshMics">
							<template v-if="!loadingMics"><i class="ti ti-refresh"></i></template>
							<template v-else><MkLoading :em="true"/></template>
						</MkButton>
					</div>
					<MkInfo>{{ i18n.ts._twitch.subtitleMicDeviceWebSpeechNotice }}</MkInfo>

					<MkSwitch v-model="settings.processLocally" :disabled="running">
						{{ i18n.ts._twitch.subtitleProcessLocally }}
						<template #caption>
							{{ i18n.ts._twitch.subtitleProcessLocallyDescription }}
							<span v-if="processLocallyAvailability !== 'unknown'"> ({{ processLocallyAvailabilityText }})</span>
						</template>
					</MkSwitch>
				</div>
			</MkFolder>

			<MkFolder>
				<template #label>{{ i18n.ts._twitch.subtitleTranslatorEngine }}</template>

				<div class="_gaps_s">
					<MkSelect v-model="settings.translatorEngine" :items="translatorEngineItems">
						<template #label>{{ i18n.ts._twitch.subtitleTranslatorEngine }}</template>
					</MkSelect>

					<MkSelect v-model="settings.targetLang" :items="targetLangItems">
						<template #label>{{ i18n.ts._twitch.subtitleTargetLang }}</template>
					</MkSelect>

					<MkInput v-if="settings.translatorEngine === 'gas'" v-model="settings.gasUrl" type="url">
						<template #label>{{ i18n.ts._twitch.subtitleGasUrl }}</template>
						<template #caption>{{ i18n.ts._twitch.subtitleGasUrlDescription }}</template>
					</MkInput>

					<MkInput v-if="settings.translatorEngine === 'deepl'" v-model="settings.deeplApiKey" type="password">
						<template #label>{{ i18n.ts._twitch.subtitleDeeplApiKey }}</template>
						<template #caption>{{ i18n.ts._twitch.subtitleDeeplApiKeyDescription }}</template>
					</MkInput>

					<MkInfo v-if="translatorStatusText != null" :warn="currentTranslatorStatus?.state === 'error' || currentTranslatorStatus?.state === 'unsupported'">
						{{ translatorStatusText }}
					</MkInfo>
				</div>
			</MkFolder>

			<MkFolder>
				<template #label>{{ i18n.ts._twitch.subtitleObsUrl }}</template>

				<div class="_gaps_s">
					<div :class="$style.previewText" class="_monospace">{{ obsUrl }}</div>
					<div>{{ i18n.ts._twitch.subtitleObsUrlDescription }}</div>
					<div class="_buttons">
						<MkButton @click="copyObsUrl"><i class="ti ti-copy"></i> {{ i18n.ts._twitch.subtitleCopyUrl }}</MkButton>
						<MkButton primary @click="openDisplaySettings"><i class="ti ti-adjustments"></i> {{ i18n.ts._twitch.subtitleObsUrlOpenSettings }}</MkButton>
					</div>
				</div>
			</MkFolder>
		</div>
	</div>
</MkModalWindow>
</template>

<script lang="ts" setup>
import { computed, ref, useTemplateRef, onMounted } from 'vue';
import { url as serverUrl } from '@@/js/config.js';
import MkModalWindow from '@/components/MkModalWindow.vue';
import MkButton from '@/components/MkButton.vue';
import MkSwitch from '@/components/MkSwitch.vue';
import MkInput from '@/components/MkInput.vue';
import MkSelect from '@/components/MkSelect.vue';
import MkInfo from '@/components/MkInfo.vue';
import MkFolder from '@/components/MkFolder.vue';
import MkLoading from '@/components/global/MkLoading.vue';
import { i18n } from '@/i18n.js';
import * as os from '@/os.js';
import { copyToClipboard } from '@/utility/copy-to-clipboard.js';
import type { ProcessLocallyAvailability } from '@/composables/use-live-subtitle.js';
import {
	liveSubtitleSettings,
	liveSubtitleRunning,
	liveSubtitleAsrStatus,
	liveSubtitleAsrErrorMessage,
	liveSubtitleCurrentCaption,
	liveSubtitleCurrentTranslation,
	startLiveSubtitle,
	stopLiveSubtitle,
	listMicDevices,
	checkProcessLocallyAvailable,
} from '@/composables/use-live-subtitle.js';
import { translatorStatuses } from '@/composables/live-subtitle-translators.js';

const props = defineProps<{
	acct: string;
}>();

const emit = defineEmits<{
	(ev: 'closed'): void;
}>();

const dialog = useTemplateRef('dialog');

// モジュールシングルトンを直接編集する (watch で即座に永続化されるため OK/キャンセルは持たない)
const settings = liveSubtitleSettings;
const running = liveSubtitleRunning;
const asrStatus = liveSubtitleAsrStatus;
const asrErrorMessage = liveSubtitleAsrErrorMessage;
const currentCaption = liveSubtitleCurrentCaption;
const currentTranslation = liveSubtitleCurrentTranslation;

const asrEngineItems = computed(() => [
	{ value: 'webspeech' as const, label: i18n.ts._twitch.subtitleAsrEngineWebSpeech },
	{ value: 'wasm' as const, label: i18n.ts._twitch.subtitleAsrEngineWasm },
]);

const translatorEngineItems = computed(() => [
	{ value: 'local' as const, label: i18n.ts._twitch.subtitleTranslatorEngineLocal },
	{ value: 'local-wasm' as const, label: i18n.ts._twitch.subtitleTranslatorEngineLocalWasm },
	{ value: 'google' as const, label: i18n.ts._twitch.subtitleTranslatorEngineGoogle },
	{ value: 'gas' as const, label: i18n.ts._twitch.subtitleTranslatorEngineGas },
	{ value: 'deepl' as const, label: i18n.ts._twitch.subtitleTranslatorEngineDeepl },
]);

const targetLangItems = computed(() => [
	{ value: 'en', label: 'English' },
	{ value: 'ko', label: '한국어' },
	{ value: 'zh-CN', label: '中文 (简体)' },
	{ value: 'zh-TW', label: '中文 (繁體)' },
]);

const mics = ref<MediaDeviceInfo[]>([]);
const loadingMics = ref(false);

const micItems = computed(() => [
	{ value: null as string | null, label: i18n.ts._twitch.subtitleMicDeviceDefault },
	...mics.value.map(d => ({ value: d.deviceId as string | null, label: d.label || d.deviceId })),
]);

const micDeviceIdModel = computed<string | null>({
	get: () => settings.value.micDeviceId,
	set: (value) => { settings.value.micDeviceId = value; },
});

async function refreshMics() {
	loadingMics.value = true;
	try {
		mics.value = await listMicDevices();
	} finally {
		loadingMics.value = false;
	}
}

const processLocallyAvailability = ref<ProcessLocallyAvailability>('unknown');
const processLocallyAvailabilityText = computed(() => {
	switch (processLocallyAvailability.value) {
		case 'available': return i18n.ts._twitch.subtitleProcessLocallyAvailable;
		case 'downloadable': return i18n.ts._twitch.subtitleProcessLocallyDownloadable;
		case 'downloading': return i18n.ts._twitch.subtitleProcessLocallyDownloadable;
		case 'unavailable': return i18n.ts._twitch.subtitleProcessLocallyUnavailable;
		default: return '';
	}
});

const currentTranslatorStatus = computed(() => translatorStatuses[settings.value.translatorEngine]);
const translatorStatusText = computed(() => {
	const status = currentTranslatorStatus.value;
	if (status == null) return null;
	switch (status.state) {
		case 'downloading': return `${i18n.ts._twitch.subtitleModelDownloading} (${status.downloadProgress ?? 0}%)`;
		case 'checking': return i18n.ts._twitch.subtitleEngineStateChecking;
		case 'unsupported': return i18n.ts._twitch.subtitleEngineStateUnsupported;
		case 'error':
			if (status.errorReason === 'cors' && settings.value.translatorEngine === 'deepl') {
				return i18n.ts._twitch.subtitleDeeplCorsError;
			}
			if (status.errorReason === 'not-configured') return i18n.ts._twitch.subtitleEngineStateNotConfigured;
			if (status.errorReason === 'rate-limited') return i18n.ts._twitch.subtitleEngineStateRateLimited;
			return i18n.ts._twitch.subtitleEngineStateError;
		default: return null;
	}
});

const obsUrl = computed(() => `${serverUrl}/live/${props.acct}/subtitles`);

function copyObsUrl() {
	copyToClipboard(obsUrl.value);
}

async function openDisplaySettings() {
	const { dispose } = await os.popupAsyncWithDialog(
		import('@/pages/live-stream.subtitle-display-settings.vue').then(x => x.default),
		{ acct: props.acct },
		{ closed: () => dispose() },
	);
}

function onStart() {
	startLiveSubtitle();
}

function onStop() {
	stopLiveSubtitle();
}

onMounted(async () => {
	// ラベル付きデバイス一覧はマイク許可済みの場合のみ取得できるが、
	// 拒否されていても空配列で失敗しないため無条件に試みる
	await refreshMics();
	processLocallyAvailability.value = await checkProcessLocallyAvailable();
});

// ダイアログが閉じられても (onUnmounted) 字幕配信自体は composable シングルトンが
// 保持するため、ここでは意図的に何も止めない (契約: Phase C シングルトン継続要件)
</script>

<style lang="scss" module>
.startStopRow {
	display: flex;
	align-items: center;
	gap: 12px;
}

.runningBadge {
	display: inline-flex;
	align-items: center;
	gap: 2px;
	color: var(--MI_THEME-error);
	font-size: 0.9em;
}

.previewBox {
	padding: 10px 12px;
	border-radius: var(--MI-radius);
	background: var(--MI_THEME-panel);
	display: flex;
	flex-direction: column;
	gap: 4px;
}

.previewLabel {
	font-size: 0.8em;
	opacity: 0.7;
}

.previewText {
	min-height: 1.4em;
	word-break: break-word;
}

.previewEmpty {
	opacity: 0.5;
}

.micRow {
	display: flex;
	align-items: flex-end;
	gap: 8px;
}
</style>
