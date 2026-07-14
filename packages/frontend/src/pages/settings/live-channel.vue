<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<SearchMarker path="/settings/live-channel" :label="i18n.ts._liveChannel.liveChannelSettings" :keywords="['live', 'stream', 'channel', 'ome', 'obs']" icon="ti ti-broadcast">
	<div class="_gaps_m">
		<MkInfo v-if="state === 'loading'">{{ i18n.ts.loading }}</MkInfo>

		<template v-else>
			<FormSection first>
				<template #label><i class="ti ti-broadcast"></i> {{ i18n.ts._liveChannel.liveChannelSettings }}</template>

				<div class="_gaps_m">
					<MkSwitch :modelValue="enabled" @update:modelValue="onToggleEnabled">
						<template #label>{{ i18n.ts._liveChannel.enableStreaming }}</template>
						<template #caption>{{ i18n.ts._liveChannel.enableStreamingDescription }}</template>
					</MkSwitch>
				</div>
			</FormSection>

			<template v-if="channel != null && channel.enabled">
				<FormSection>
					<template #label><i class="ti ti-info-circle"></i> {{ i18n.ts._liveChannel.channelName }}</template>

					<div class="_gaps_m">
						<MkInput :modelValue="channelName" manualSave :max="128" :placeholder="$i.name ?? $i.username" @update:modelValue="onNameSave">
							<template #label>{{ i18n.ts._liveChannel.channelName }}</template>
							<template #caption>{{ i18n.ts._liveChannel.channelNamePlaceholder }}</template>
						</MkInput>

						<MkTextarea :modelValue="channelDescription" manualSave :max="2048" tall @update:modelValue="onDescriptionSave">
							<template #label>{{ i18n.ts._liveChannel.channelDescription }}</template>
						</MkTextarea>

						<div class="_gaps_s">
							<div>{{ i18n.ts._liveChannel.channelBanner }}</div>
							<div v-if="bannerUrl" :class="$style.banner" :style="{ backgroundImage: `url(${bannerUrl})` }"></div>
							<MkButton primary rounded @click="changeBanner">
								<i class="ti ti-photo"></i> {{ i18n.ts._liveChannel.changeBanner }}
							</MkButton>
						</div>
					</div>
				</FormSection>

				<FormSection>
					<template #label><i class="ti ti-server"></i> {{ i18n.ts._liveChannel.streamServerInfo }}</template>

					<div class="_gaps_m">
						<MkInfo v-if="!ingestReady" warn>{{ i18n.ts._liveChannel.notConfiguredServer }}</MkInfo>

						<template v-else>
							<div class="_gaps_s">
								<MkKeyValue>
									<template #key>WHIP URL</template>
									<template #value>
										<div :class="$style.valueRow">
											<span :class="[$style.valueText, { [$style.blurred]: !urlRevealed }]">{{ whipUrl }}</span>
											<button class="_button" :class="$style.actionButton" :aria-label="urlRevealed ? i18n.ts._liveChannel.hideKey : i18n.ts._liveChannel.showKey" @click="urlRevealed = !urlRevealed">
												<i class="ti" :class="urlRevealed ? 'ti-eye-off' : 'ti-eye'"></i>
											</button>
											<button class="_button" :class="$style.actionButton" :aria-label="i18n.ts._liveChannel.copyWhipUrl" @click="copyToClipboard(whipUrl)">
												<i class="ti ti-copy"></i>
											</button>
										</div>
									</template>
								</MkKeyValue>
								<div :class="$style.caption">{{ i18n.ts._liveChannel.whipUrlDescription }}</div>
							</div>

							<div class="_gaps_s">
								<div :class="$style.guideTitle"><i class="ti ti-help-circle"></i> {{ i18n.ts._liveChannel.obsSetupTitle }}</div>
								<ol :class="$style.guideList">
									<li>{{ i18n.ts._liveChannel.obsSetupStep1 }}</li>
									<li>{{ i18n.ts._liveChannel.obsSetupStep2 }}</li>
									<li>{{ i18n.ts._liveChannel.obsSetupStep3 }}</li>
									<li>{{ i18n.ts._liveChannel.obsSetupStep4 }}</li>
								</ol>
								<MkInfo>{{ i18n.ts._liveChannel.obsSetupCodecNote }}</MkInfo>
							</div>

							<div class="_gaps_s">
								<div v-if="channel.streamKeyRegeneratedAt" :class="$style.caption">{{ i18n.ts._liveChannel.streamKeyRegeneratedAt }}: {{ new Date(channel.streamKeyRegeneratedAt).toLocaleString() }}</div>
								<div>{{ i18n.ts._liveChannel.streamKeyDescription }}</div>
								<MkButton danger @click="regenerateKey">
									<i class="ti ti-refresh"></i> {{ i18n.ts._liveChannel.regenerateStreamKey }}
								</MkButton>
							</div>
						</template>
					</div>
				</FormSection>
			</template>
		</template>
	</div>
</SearchMarker>
</template>

<script lang="ts" setup>
import { computed, onMounted, ref } from 'vue';
import * as Misskey from 'misskey-js';
import FormSection from '@/components/form/section.vue';
import MkButton from '@/components/MkButton.vue';
import MkInfo from '@/components/MkInfo.vue';
import MkInput from '@/components/MkInput.vue';
import MkKeyValue from '@/components/MkKeyValue.vue';
import MkSwitch from '@/components/MkSwitch.vue';
import MkTextarea from '@/components/MkTextarea.vue';
import { chooseDriveFile } from '@/utility/drive.js';
import { copyToClipboard } from '@/utility/copy-to-clipboard.js';

import * as os from '@/os.js';
import { i18n } from '@/i18n.js';
import { ensureSignin } from '@/i.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { definePage } from '@/page.js';

const $i = ensureSignin();

const state = ref<'loading' | 'ready'>('loading');
const channel = ref<Misskey.entities.LiveChannelsMyResponse['channel']>(null);
const whipUrl = ref<string | null>(null);
const urlRevealed = ref(false);

const channelName = ref('');
const channelDescription = ref('');

const enabled = computed(() => channel.value != null && channel.value.enabled);
const ingestReady = computed(() => whipUrl.value != null);
const bannerUrl = computed(() => channel.value?.bannerUrl ?? null);

async function fetchMy() {
	state.value = 'loading';
	const res = await misskeyApi('live-channels/my', {});
	channel.value = res.channel;
	whipUrl.value = res.whipUrl ?? null;
	channelName.value = res.channel?.name ?? '';
	channelDescription.value = res.channel?.description ?? '';
	state.value = 'ready';
}

async function onToggleEnabled(v: boolean) {
	if (v) {
		if (channel.value == null) {
			const created = await os.apiWithDialog('live-channels/create', {});
			channel.value = created;
		} else {
			const updated = await os.apiWithDialog('live-channels/update', { enabled: true });
			channel.value = updated;
		}
	} else {
		if (channel.value != null) {
			const updated = await os.apiWithDialog('live-channels/update', { enabled: false });
			channel.value = updated;
		}
	}
	await fetchMy();
}

async function onNameSave(v: string) {
	if (channel.value == null) return;
	channelName.value = v;
	const updated = await os.apiWithDialog('live-channels/update', { name: v || null });
	channel.value = updated;
}

async function onDescriptionSave(v: string) {
	if (channel.value == null) return;
	channelDescription.value = v;
	const updated = await os.apiWithDialog('live-channels/update', { description: v || null });
	channel.value = updated;
}

function changeBanner(ev: PointerEvent) {
	async function done(driveFile: Misskey.entities.DriveFile) {
		if (channel.value == null) return;
		const updated = await os.apiWithDialog('live-channels/update', {
			bannerId: driveFile.id,
		});
		channel.value = updated;
	}

	os.popupMenu([{
		text: i18n.ts.banner,
		type: 'label',
	}, {
		text: i18n.ts.upload,
		icon: 'ti ti-upload',
		action: async () => {
			const files = await os.chooseFileFromPc({ multiple: false });
			const file = files[0];
			let originalOrCropped = file;
			const { canceled } = await os.confirm({
				type: 'question',
				text: i18n.ts.cropImageAsk,
				okText: i18n.ts.cropYes,
				cancelText: i18n.ts.cropNo,
			});
			if (!canceled) {
				originalOrCropped = await os.cropImageFile(file, { aspectRatio: 3 / 1 });
			}
			const driveFile = (await os.launchUploader([originalOrCropped], { multiple: false }))[0];
			done(driveFile);
		},
	}, {
		text: i18n.ts.fromDrive,
		icon: 'ti ti-cloud',
		action: () => {
			chooseDriveFile({ multiple: false }).then(files => {
				done(files[0]);
			});
		},
	}], ev.currentTarget ?? ev.target);
}

async function regenerateKey() {
	if (channel.value == null) return;
	const { canceled } = await os.confirm({
		type: 'warning',
		text: i18n.ts._liveChannel.regenerateStreamKeyConfirm,
	});
	if (canceled) return;
	await os.apiWithDialog('live-channels/regenerate-key', {});
	urlRevealed.value = false;
	await fetchMy();
}

onMounted(() => {
	fetchMy();
});

const headerActions = computed(() => []);

const headerTabs = computed(() => []);

definePage(() => ({
	title: i18n.ts._liveChannel.liveChannelSettings,
	icon: 'ti ti-broadcast',
}));
</script>

<style lang="scss" module>
.banner {
	width: 100%;
	height: 120px;
	background: var(--MI_THEME-panel);
	background-size: cover;
	background-position: center;
	border-radius: var(--MI-radius);
}

.valueRow {
	display: flex;
	align-items: center;
	gap: 8px;
}

.valueText {
	flex: 1;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.caption {
	font-size: 0.85em;
	color: color(from var(--MI_THEME-fg) srgb r g b / 0.75);
}

.blurred {
	filter: blur(6px);
	user-select: none;
	-webkit-user-select: none;
	cursor: default;
}

.guideTitle {
	font-weight: 700;
	margin-bottom: 4px;
}

.guideList {
	margin: 0;
	padding-left: 1.4em;
	font-size: 0.9em;
	line-height: 1.75;
	color: color(from var(--MI_THEME-fg) srgb r g b / 0.85);
}

.actionButton {
	flex-shrink: 0;
	width: 32px;
	height: 32px;
	display: flex;
	align-items: center;
	justify-content: center;
	border-radius: 6px;
	background: var(--MI_THEME-panel);

	&:hover:not(:disabled) {
		background: var(--MI_THEME-panelHighlight);
	}

	&:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
}
</style>
