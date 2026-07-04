<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkModalWindow
	ref="dialog"
	:width="420"
	:height="560"
	@close="dialog?.close()"
	@closed="emit('closed')"
>
	<template #header>{{ i18n.ts._twitch.ttsSettings }}</template>

	<div class="_spacer" style="--MI_SPACER-min: 20px; --MI_SPACER-max: 28px;">
		<div class="_gaps_m">
			<MkSwitch v-model="settings.enabled">
				{{ i18n.ts._twitch.ttsEnable }}
				<template #caption>{{ i18n.ts._twitch.ttsEnableDescription }}</template>
			</MkSwitch>

			<MkInput v-model="settings.engineUrl" type="url">
				<template #label>{{ i18n.ts._twitch.ttsEngineUrl }}</template>
				<template #caption>{{ i18n.ts._twitch.ttsEngineUrlDescription }}</template>
			</MkInput>

			<div class="_gaps_s">
				<MkSelect v-model="settings.styleId" :items="speakerItems" :placeholder="i18n.ts._twitch.ttsSpeakerNotLoaded">
					<template #label>{{ i18n.ts._twitch.ttsSpeaker }}</template>
				</MkSelect>
				<MkButton :disabled="loadingSpeakers" @click="loadSpeakers">
					<template v-if="!loadingSpeakers"><i class="ti ti-refresh"></i> {{ i18n.ts._twitch.ttsFetchSpeakers }}</template>
					<template v-else><MkLoading :em="true"/></template>
				</MkButton>
			</div>

			<MkRange v-model="settings.speedScale" :min="0.5" :max="2" :step="0.05" :textConverter="(v) => `x${v.toFixed(2)}`" :continuousUpdate="true">
				<template #label>{{ i18n.ts._twitch.ttsSpeed }}</template>
			</MkRange>

			<MkRange v-model="settings.volumeScale" :min="0" :max="2" :step="0.05" :textConverter="(v) => `${Math.round(v * 100)}%`" :continuousUpdate="true">
				<template #label>{{ i18n.ts._twitch.ttsVolume }}</template>
			</MkRange>

			<MkButton :disabled="settings.styleId == null" @click="test">
				<i class="ti ti-player-play"></i> {{ i18n.ts._twitch.ttsTest }}
			</MkButton>
		</div>
	</div>
</MkModalWindow>
</template>

<script lang="ts" setup>
import { ref, computed, useTemplateRef, onMounted } from 'vue';
import type { TtsSpeakerStyle } from '@/composables/use-twitch-tts.js';
import MkModalWindow from '@/components/MkModalWindow.vue';
import MkSwitch from '@/components/MkSwitch.vue';
import MkInput from '@/components/MkInput.vue';
import MkSelect from '@/components/MkSelect.vue';
import MkRange from '@/components/MkRange.vue';
import MkButton from '@/components/MkButton.vue';
import * as os from '@/os.js';
import { i18n } from '@/i18n.js';
import { twitchTtsSettings, fetchTtsSpeakers, enqueueTtsSpeech } from '@/composables/use-twitch-tts.js';

const emit = defineEmits<{
	(ev: 'closed'): void;
}>();

const dialog = useTemplateRef('dialog');

// モジュールシングルトンを直接編集する (watch で即座に永続化されるため OK/キャンセルは持たない)
const settings = twitchTtsSettings;

const speakers = ref<TtsSpeakerStyle[]>([]);
const loadingSpeakers = ref(false);

const speakerItems = computed(() => speakers.value.map(speaker => ({
	value: speaker.styleId as number | null,
	label: `${speaker.speakerName} (${speaker.styleName})`,
})));

async function loadSpeakers() {
	loadingSpeakers.value = true;
	try {
		speakers.value = await fetchTtsSpeakers(settings.value.engineUrl);
		// 未選択なら先頭スタイルを自動選択して「取得したのに読み上げられない」を避ける
		if (settings.value.styleId == null && speakers.value.length > 0) {
			settings.value.styleId = speakers.value[0].styleId;
		}
	} catch {
		os.alert({ type: 'error', text: i18n.ts._twitch.ttsFetchSpeakersFailed });
	} finally {
		loadingSpeakers.value = false;
	}
}

function test() {
	// テスト再生は有効化状態に関わらず鳴らしたいので、キューを介さず直接詰める。
	// enqueue 側は enabled チェックを持たないため、そのまま流用できる
	enqueueTtsSpeech(i18n.ts._twitch.ttsTestText);
}

onMounted(() => {
	// エンジンが起動していれば選択肢を自動で埋める。失敗してもダイアログは開けたままにする
	loadSpeakers();
});
</script>
