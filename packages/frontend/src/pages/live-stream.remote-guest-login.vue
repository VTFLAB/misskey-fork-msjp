<!--
SPDX-FileCopyrightText: misskey-bsky-integration fork
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.root" class="_panel _gaps_s">
	<div :class="$style.title">{{ i18n.ts._remoteGuestLogin.title }}</div>
	<div :class="$style.description">{{ i18n.ts._remoteGuestLogin.description }}</div>
	<MkInput v-model="acct" type="text" :placeholder="i18n.ts._remoteGuestLogin.acctPlaceholder" :disabled="loading" @keydown.enter="onLogin">
		<template #label>{{ i18n.ts._remoteGuestLogin.acctPlaceholder }}</template>
	</MkInput>
	<MkButton primary full :disabled="acct.trim().length === 0" :wait="loading" @click="onLogin">{{ i18n.ts._remoteGuestLogin.loginButton }}</MkButton>
	<button class="_button" :class="$style.localLoginLink" @click="onLocalLogin">{{ i18n.ts.login }}</button>
</div>
</template>

<script lang="ts" setup>
import { ref } from 'vue';
import { i18n } from '@/i18n.js';
import * as os from '@/os.js';
import MkInput from '@/components/MkInput.vue';
import MkButton from '@/components/MkButton.vue';
import { startRemoteGuestLogin } from '@/composables/use-remote-guest-session.js';
import { pleaseLogin } from '@/utility/please-login.js';

const props = defineProps<{
	returnTo: string;
}>();

const acct = ref('');
const loading = ref(false);

async function onLogin() {
	if (loading.value) return;
	const value = acct.value.trim().replace(/^@/, '');
	if (value.length === 0) return;
	loading.value = true;
	try {
		await startRemoteGuestLogin(value, props.returnTo);
	} catch (err) {
		os.alert({ type: 'error', text: err instanceof Error ? err.message : i18n.ts._remoteGuestLogin.loginError });
	} finally {
		loading.value = false;
	}
}

function onLocalLogin() {
	pleaseLogin();
}
</script>

<style lang="scss" module>
.root {
	padding: 20px;
	text-align: center;
}

.title {
	font-weight: bold;
}

.description {
	font-size: 0.9em;
	opacity: 0.8;
}

.localLoginLink {
	color: var(--MI_THEME-accent);
	font-size: 0.9em;
}
</style>
