<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkModalWindow
	ref="dialog"
	:width="420"
	:height="260"
	@close="dialog?.close()"
	@closed="emit('closed')"
>
	<template #header>{{ i18n.ts._twitch.translationSettings }}</template>

	<div class="_spacer" style="--MI_SPACER-min: 20px; --MI_SPACER-max: 28px;">
		<div class="_gaps_m">
			<MkSwitch v-model="enabled" :disabled="saving" @update:modelValue="onToggle">
				{{ i18n.ts._twitch.translationEnable }}
				<template #caption>{{ i18n.ts._twitch.translationEnableDescription }}</template>
			</MkSwitch>
		</div>
	</div>
</MkModalWindow>
</template>

<script lang="ts" setup>
import { ref, useTemplateRef, onMounted } from 'vue';
import MkModalWindow from '@/components/MkModalWindow.vue';
import MkSwitch from '@/components/MkSwitch.vue';
import * as os from '@/os.js';
import { i18n } from '@/i18n.js';
import { misskeyApi } from '@/utility/misskey-api.js';

const emit = defineEmits<{
	(ev: 'closed'): void;
}>();

const dialog = useTemplateRef('dialog');

// サーバー永続化 (MiTwitchAccount.translationEnabled) の設定なので、TTS 設定と違い
// 現在値をダイアログを開くたびに取得してから編集する
const enabled = ref(false);
const saving = ref(false);

async function onToggle(value: boolean) {
	saving.value = true;
	try {
		const res = await os.apiWithDialog('twitch/update-settings', { translationEnabled: value });
		enabled.value = res.translationEnabled;
	} catch {
		// 失敗時は表示上も元に戻す (apiWithDialog がエラーダイアログを出す)
		enabled.value = !value;
	} finally {
		saving.value = false;
	}
}

onMounted(async () => {
	try {
		const res = await misskeyApi('twitch/my-account', {});
		enabled.value = res.translationEnabled;
	} catch {
		// 取得失敗時は false のままにする (ダイアログ自体は開いたままにする)
	}
});
</script>
