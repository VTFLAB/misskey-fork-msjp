<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<SearchMarker path="/settings/streaming" :label="i18n.ts._streaming.title" :keywords="['live', 'stream', 'twitch', 'ome', 'obs', 'whip', 'broadcast']" icon="ti ti-broadcast">
	<div class="_gaps_m">
		<!-- Section 1: MSJP配信 (OME self-hosted) -->
		<FormSection first>
			<template #label><i class="ti ti-broadcast"></i> {{ i18n.ts._liveChannel.selfStream }}</template>

			<MkInfo v-if="liveChannelState === 'loading'">{{ i18n.ts.loading }}</MkInfo>

			<template v-else>
				<MkInfo v-if="isBlocked" warn>
					<b>{{ i18n.ts._liveChannel.streamBlockedTitle }}</b><br>
					{{ i18n.tsx._liveChannel.streamBlockedDescription({ reason: channel?.lastCutReason ?? '', remainingMinutes: blockedRemainingMinutes }) }}
				</MkInfo>

				<div class="_gaps_m">
					<MkSwitch :modelValue="enabled" @update:modelValue="onToggleEnabled">
						<template #label>{{ i18n.ts._liveChannel.enableStreaming }}</template>
						<template #caption>{{ i18n.ts._liveChannel.enableStreamingDescription }}</template>
					</MkSwitch>
				</div>

				<template v-if="channel != null && channel.enabled">
					<div class="_gaps_m">
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

								<div class="_gaps_s">
									<div>{{ i18n.ts._liveChannel.offlineImage }}</div>
									<div :class="$style.caption">{{ i18n.ts._liveChannel.offlineImageDescription }}</div>
									<div v-if="offlineImageUrl" :class="$style.banner" :style="{ backgroundImage: `url(${offlineImageUrl})` }"></div>
									<MkButton primary rounded @click="changeOfflineImage">
										<i class="ti ti-photo"></i> {{ i18n.ts._liveChannel.changeOfflineImage }}
									</MkButton>
								</div>
							</div>
						</FormSection>

						<FormSection>
							<template #label><i class="ti ti-lock"></i> {{ i18n.ts._liveChannel.viewRestriction }}</template>

							<div class="_gaps_m">
								<MkSelect :modelValue="viewRestriction" :items="viewRestrictionItems" @update:modelValue="onVisibilitySave">
									<template #label>{{ i18n.ts._liveChannel.viewRestriction }}</template>
									<template #caption>{{ i18n.ts._liveChannel.viewRestrictionDescription }}</template>
								</MkSelect>

								<MkInput v-if="viewRestriction === 'password'" :modelValue="viewPassword" manualSave :max="128" :placeholder="i18n.ts._liveChannel.viewPasswordPlaceholder" @update:modelValue="onViewPasswordSave">
									<template #label>{{ i18n.ts._liveChannel.viewPassword }}</template>
									<template #caption>{{ i18n.ts._liveChannel.viewPasswordDescription }}</template>
								</MkInput>

								<div v-if="viewRestriction === 'users'" :class="$style.visibleUsersBox">
									<div :class="$style.caption">{{ i18n.ts._liveChannel.visibleUsersDescription }}</div>
									<div :class="$style.visibleUsersList">
										<span v-for="u in visibleUsers" :key="u.id" :class="$style.visibleUserItem">
											<MkAcct :user="u"/>
											<button class="_button" :class="$style.actionButton" :aria-label="i18n.ts.remove" @click="removeVisibleUser(u.id)"><i class="ti ti-x"></i></button>
										</span>
									</div>
									<MkButton rounded @click="addVisibleUser"><i class="ti ti-plus"></i> {{ i18n.ts._liveChannel.addVisibleUser }}</MkButton>
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

										<template v-if="maxVideoBitrate != null || maxAudioBitrate != null">
											<div :class="$style.guideTitle">{{ i18n.ts._liveChannel.obsBitrateLimitsTitle }}</div>
											<div :class="$style.settingsTableWrap">
												<table :class="$style.limitsTable">
													<tbody>
														<tr v-if="maxVideoBitrate != null">
															<th>{{ i18n.ts._liveChannel.obsMaxVideoBitrate }}</th>
															<td>{{ maxVideoBitrate }}kbps</td>
														</tr>
														<tr v-if="maxAudioBitrate != null">
															<th>{{ i18n.ts._liveChannel.obsMaxAudioBitrate }}</th>
															<td>{{ maxAudioBitrate }}kbps</td>
														</tr>
													</tbody>
												</table>
											</div>
											<div :class="$style.caption">{{ i18n.ts._liveChannel.obsBitrateLimitsCaption }}</div>
										</template>

										<details :class="$style.settingsDetails">
											<summary :class="$style.guideTitle">{{ i18n.ts._liveChannel.obsRecommendedSettingsTitle }}</summary>
											<div :class="$style.caption">{{ i18n.ts._liveChannel.obsRecommendedSettingsCaption }}</div>

											<div :class="$style.settingsTableWrap">
												<table :class="$style.settingsTable">
													<thead>
														<tr>
															<th>{{ i18n.ts._liveChannel.obsSettingsColItem }}</th>
															<th>{{ i18n.ts._liveChannel.obsSettingsColValue }}</th>
															<th>{{ i18n.ts._liveChannel.obsSettingsColNote }}</th>
														</tr>
													</thead>
													<tbody>
														<tr v-if="recommendedVideoBitrate != null && maxVideoBitrate != null">
															<th>{{ i18n.ts._liveChannel.obsSettingItemVideoBitrate }}</th>
															<td>{{ i18n.tsx._liveChannel.obsSettingValueVideoBitrateRecommended({ value: recommendedVideoBitrate, max: maxVideoBitrate }) }}</td>
															<td>{{ i18n.ts._liveChannel.obsBitrateLimitsCaption }}</td>
														</tr>
														<tr>
															<th>{{ i18n.ts._liveChannel.obsSettingItemRateControl }}</th>
															<td>CBR</td>
															<td>{{ i18n.ts._liveChannel.obsSettingNoteRateControl }}</td>
														</tr>
														<tr>
															<th>{{ i18n.ts._liveChannel.obsSettingItemKeyframeInterval }}</th>
															<td>1〜2</td>
															<td>{{ i18n.ts._liveChannel.obsSettingNoteKeyframeInterval }}</td>
														</tr>
														<tr v-if="recommendedAudioBitrate != null && maxAudioBitrate != null">
															<th>{{ i18n.ts._liveChannel.obsSettingItemAudioBitrate }}</th>
															<td>{{ i18n.tsx._liveChannel.obsSettingValueAudioBitrateRecommended({ value: recommendedAudioBitrate, max: maxAudioBitrate }) }}</td>
															<td>{{ i18n.ts._liveChannel.obsSettingNoteAudioBitrate }}</td>
														</tr>
													</tbody>
												</table>
											</div>

											<details :class="$style.settingsDetails">
												<summary>{{ i18n.ts._liveChannel.x264SectionTitle }}</summary>
												<div :class="$style.caption">{{ i18n.ts._liveChannel.x264SectionCaption }}</div>
												<div :class="$style.settingsTableWrap">
													<table :class="$style.settingsTable">
														<thead>
															<tr>
																<th>{{ i18n.ts._liveChannel.obsSettingsColItem }}</th>
																<th>{{ i18n.ts._liveChannel.obsSettingsColValue }}</th>
																<th>{{ i18n.ts._liveChannel.obsSettingsColNote }}</th>
															</tr>
														</thead>
														<tbody>
															<tr>
																<th>{{ i18n.ts._liveChannel.obsSettingItemX264Preset }}</th>
																<td>veryfast</td>
																<td>{{ i18n.ts._liveChannel.obsSettingNoteX264Preset }}</td>
															</tr>
															<tr>
																<th>{{ i18n.ts._liveChannel.obsSettingItemX264Profile }}</th>
																<td>baseline</td>
																<td>{{ i18n.ts._liveChannel.obsSettingNoteX264Profile }}</td>
															</tr>
															<tr>
																<th>{{ i18n.ts._liveChannel.obsSettingItemX264Tune }}</th>
																<td>zerolatency</td>
																<td>{{ i18n.ts._liveChannel.obsSettingNoteX264Tune }}</td>
															</tr>
															<tr>
																<th>{{ i18n.ts._liveChannel.obsSettingItemX264Options }}</th>
																<td>bframes=0 scenecut=0</td>
																<td>{{ i18n.ts._liveChannel.obsSettingNoteX264Options }}</td>
															</tr>
														</tbody>
													</table>
												</div>
											</details>

											<details :class="$style.settingsDetails">
												<summary>{{ i18n.ts._liveChannel.nvencSectionTitle }}</summary>
												<div :class="$style.caption">{{ i18n.ts._liveChannel.nvencSectionCaption }}</div>
												<div :class="$style.settingsTableWrap">
													<table :class="$style.settingsTable">
														<thead>
															<tr>
																<th>{{ i18n.ts._liveChannel.obsSettingsColItem }}</th>
																<th>{{ i18n.ts._liveChannel.obsSettingsColValue }}</th>
																<th>{{ i18n.ts._liveChannel.obsSettingsColNote }}</th>
															</tr>
														</thead>
														<tbody>
															<tr>
																<th>{{ i18n.ts._liveChannel.obsSettingItemNvencPreset }}</th>
																<td>P1〜P4</td>
																<td>{{ i18n.ts._liveChannel.obsSettingNoteNvencPreset }}</td>
															</tr>
															<tr>
																<th>{{ i18n.ts._liveChannel.obsSettingItemNvencTuning }}</th>
																<td>低遅延 / 超低遅延</td>
																<td>{{ i18n.ts._liveChannel.obsSettingNoteNvencTuning }}</td>
															</tr>
															<tr>
																<th>{{ i18n.ts._liveChannel.obsSettingItemNvencMultipass }}</th>
																<td>無効</td>
																<td>{{ i18n.ts._liveChannel.obsSettingNoteNvencMultipass }}</td>
															</tr>
															<tr>
																<th>{{ i18n.ts._liveChannel.obsSettingItemNvencProfile }}</th>
																<td>Main</td>
																<td>{{ i18n.ts._liveChannel.obsSettingNoteNvencProfile }}</td>
															</tr>
															<tr>
																<th>{{ i18n.ts._liveChannel.obsSettingItemNvencLookAhead }}</th>
																<td>オフ</td>
																<td>{{ i18n.ts._liveChannel.obsSettingNoteNvencLookAhead }}</td>
															</tr>
															<tr>
																<th>{{ i18n.ts._liveChannel.obsSettingItemMaxBFrames }}</th>
																<td>0</td>
																<td>{{ i18n.ts._liveChannel.obsSettingNoteMaxBFrames }}</td>
															</tr>
														</tbody>
													</table>
												</div>
											</details>
										</details>
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

						<FormSection>
							<template #label><i class="ti ti-message-circle"></i> {{ i18n.ts._liveChannel.autoPostNote }}</template>

							<div class="_gaps_m">
								<MkSwitch :modelValue="autoPostNoteEnabled" @update:modelValue="onToggleAutoPostNote">
									<template #label>{{ i18n.ts._liveChannel.autoPostNoteEnabled }}</template>
									<template #caption>{{ i18n.ts._liveChannel.autoPostNoteEnabledDescription }}</template>
								</MkSwitch>

								<MkTextarea :modelValue="autoPostNoteTemplate" manualSave :max="512" :placeholder="i18n.ts._liveChannel.autoPostNoteTemplateDefault" @update:modelValue="onAutoPostNoteTemplateSave">
									<template #label>{{ i18n.ts._liveChannel.autoPostNoteTemplate }}</template>
									<template #caption>{{ i18n.ts._liveChannel.autoPostNoteTemplateDescription }}</template>
								</MkTextarea>
							</div>
						</FormSection>
					</div>
				</template>
			</template>
		</FormSection>

		<!-- Section 2: Twitch連携 -->
		<FormSection>
			<template #label><i class="ti ti-brand-twitch"></i> {{ i18n.ts._twitch.twitchIntegration }}</template>

			<MkInfo v-if="twitchState === 'loading'">{{ i18n.ts.loading }}</MkInfo>
			<MkInfo v-else-if="!twitchAvailable" warn>{{ i18n.ts._twitch.notConfigured }}</MkInfo>

			<template v-else>
				<div class="_gaps_m">
					<FormSection first>
						<template #label><i class="ti ti-brand-twitch"></i> {{ i18n.ts._twitch.myAccount }}</template>

						<div class="_gaps_m">
							<MkInfo v-if="!enabled" warn>{{ i18n.ts._twitch.enableChannelFirst }}</MkInfo>
							<template v-else-if="twitchLinked">
								<MkKeyValue>
									<template #key>{{ i18n.ts._twitch.linkedAs }}</template>
									<template #value>{{ twitchDisplayName }} (@{{ twitchLogin }})</template>
								</MkKeyValue>
								<MkButton danger @click="unlink">{{ i18n.ts._twitch.unlink }}</MkButton>
							</template>
							<template v-else>
								<div>{{ i18n.ts._twitch.linkDescription }}</div>
								<MkButton primary @click="link">{{ i18n.ts._twitch.linkAccount }}</MkButton>
							</template>
						</div>
					</FormSection>

					<FormSection v-if="iAmAdmin">
						<template #label><i class="ti ti-robot"></i> {{ i18n.ts._twitch.relayBot }}</template>

						<div class="_gaps_m">
							<div>{{ i18n.ts._twitch.relayBotDescription }}</div>
							<MkKeyValue v-if="botLinked">
								<template #key>{{ i18n.ts._twitch.botLinkedAs }}</template>
								<template #value>@{{ botLogin }}</template>
							</MkKeyValue>
							<MkInfo v-else warn>{{ i18n.ts._twitch.botNotLinked }}</MkInfo>
							<MkButton @click="linkBot">{{ i18n.ts._twitch.linkBotAccount }}</MkButton>
						</div>
					</FormSection>
				</div>
			</template>
		</FormSection>

		<!-- Section 3: 配信者ツール -->
		<FormSection>
			<template #label><i class="ti ti-settings"></i> {{ i18n.ts._twitch.streamerSettings }}</template>

			<div class="_gaps_s">
				<FormLink @click="copyObsOverlayUrl">
					<template #icon><i class="ti ti-copy"></i></template>
					{{ i18n.ts._twitch.copyObsOverlayUrl }}
				</FormLink>
				<FormLink @click="openTtsSettings">
					<template #icon><i class="ti ti-speakerphone"></i></template>
					{{ i18n.ts._twitch.ttsSettings }}
				</FormLink>
				<FormLink @click="openCommentGeneratorSettings">
					<template #icon><i class="ti ti-message-2-cog"></i></template>
					{{ i18n.ts._twitch.commentGenSettings }}
				</FormLink>
				<FormLink @click="openBlocks">
					<template #icon><i class="ti ti-ban"></i></template>
					{{ i18n.ts._twitch.manageBlocks }}
				</FormLink>
				<FormLink @click="openTranslationSettings">
					<template #icon><i class="ti ti-language"></i></template>
					{{ i18n.ts._twitch.translationSettings }}
				</FormLink>
			</div>
		</FormSection>
	</div>
</SearchMarker>
</template>

<script lang="ts" setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import * as Misskey from 'misskey-js';
import FormSection from '@/components/form/section.vue';
import FormLink from '@/components/form/link.vue';
import MkAcct from '@/components/global/MkAcct.vue';
import MkButton from '@/components/MkButton.vue';
import MkInfo from '@/components/MkInfo.vue';
import MkInput from '@/components/MkInput.vue';
import MkKeyValue from '@/components/MkKeyValue.vue';
import MkSelect from '@/components/MkSelect.vue';
import MkSwitch from '@/components/MkSwitch.vue';
import MkTextarea from '@/components/MkTextarea.vue';
import { chooseDriveFile } from '@/utility/drive.js';
import { copyToClipboard } from '@/utility/copy-to-clipboard.js';
import { url as serverUrl } from '@@/js/config.js';

import * as os from '@/os.js';
import { i18n } from '@/i18n.js';
import { ensureSignin, iAmAdmin } from '@/i.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { definePage } from '@/page.js';

const $i = ensureSignin();

// OME / live-channel state
const liveChannelState = ref<'loading' | 'ready'>('loading');
const channel = ref<Misskey.entities.LiveChannelsMyResponse['channel']>(null);
const whipUrl = ref<string | null>(null);
const maxVideoBitrate = ref<number | null>(null);
const maxAudioBitrate = ref<number | null>(null);
const urlRevealed = ref(false);
const channelName = ref('');
const channelDescription = ref('');
const autoPostNoteEnabled = ref(false);
const autoPostNoteTemplate = ref('');
const viewRestriction = ref<'public' | 'followers' | 'password' | 'users'>('public');
const viewPassword = ref('');
const visibleUsers = ref<Misskey.entities.UserDetailed[]>([]);

const viewRestrictionItems = [
	{ value: 'public' as const, label: i18n.ts._liveChannel.viewRestrictionPublic },
	{ value: 'followers' as const, label: i18n.ts._liveChannel.viewRestrictionFollowers },
	{ value: 'password' as const, label: i18n.ts._liveChannel.viewRestrictionPassword },
	{ value: 'users' as const, label: i18n.ts._liveChannel.viewRestrictionUsers },
];

const enabled = computed(() => channel.value != null && channel.value.enabled);
const ingestReady = computed(() => whipUrl.value != null);
// blockedUntil はビットレート超過遮断 (OmeStreamMonitorService.cutStream) の Redis blacklist TTL 由来。
// ポーリングではなく 1 秒 tick の now と比較するだけで、解除タイミングでバナーが自動的に消える。
const now = ref(Date.now());
let nowTimer: number | undefined;
const isBlocked = computed(() => {
	const blockedUntil = channel.value?.blockedUntil;
	return blockedUntil != null && new Date(blockedUntil).getTime() > now.value;
});
const blockedRemainingMinutes = computed(() => {
	const blockedUntil = channel.value?.blockedUntil;
	if (blockedUntil == null) return 0;
	return Math.max(1, Math.ceil((new Date(blockedUntil).getTime() - now.value) / 60000));
});
// 上限ちょうどだと瞬間的な変動で断続的に超過判定されうるため、1割ほど余裕を持たせた値を推奨として提示する
const recommendedVideoBitrate = computed(() => maxVideoBitrate.value != null ? Math.round(maxVideoBitrate.value * 0.9) : null);
const recommendedAudioBitrate = computed(() => maxAudioBitrate.value);
const bannerUrl = computed(() => channel.value?.bannerUrl ?? null);
const offlineImageUrl = computed(() => channel.value?.offlineImageUrl ?? null);

async function fetchMy() {
	liveChannelState.value = 'loading';
	const res = await misskeyApi('live-channels/my', {});
	channel.value = res.channel;
	whipUrl.value = res.whipUrl ?? null;
	maxVideoBitrate.value = res.maxVideoBitrate ?? null;
	maxAudioBitrate.value = res.maxAudioBitrate ?? null;
	channelName.value = res.channel?.name ?? '';
	channelDescription.value = res.channel?.description ?? '';
	autoPostNoteEnabled.value = res.channel?.autoPostNoteEnabled ?? false;
	autoPostNoteTemplate.value = res.channel?.autoPostNoteTemplate ?? '';
	viewRestriction.value = res.channel?.visibility ?? 'public';
	viewPassword.value = res.channel?.viewPassword ?? '';
	await loadVisibleUsers(res.channel?.visibleUserIds ?? []);
	liveChannelState.value = 'ready';
}

async function loadVisibleUsers(ids: string[]) {
	if (ids.length === 0) {
		visibleUsers.value = [];
		return;
	}
	const users = await misskeyApi('users/show', { userIds: ids });
	visibleUsers.value = Array.isArray(users) ? users : [users];
}

async function onVisibilitySave(v: 'public' | 'followers' | 'password' | 'users') {
	if (channel.value == null) return;
	viewRestriction.value = v;
	const updated = await os.apiWithDialog('live-channels/update', { visibility: v });
	channel.value = updated;
	viewRestriction.value = updated.visibility ?? 'public';
}

async function onViewPasswordSave(v: string) {
	if (channel.value == null) return;
	viewPassword.value = v;
	const updated = await os.apiWithDialog('live-channels/update', { viewPassword: v || null });
	channel.value = updated;
	viewPassword.value = updated.viewPassword ?? '';
}

async function addVisibleUser() {
	if (channel.value == null) return;
	const user = await os.selectUser({ includeSelf: false });
	if (visibleUsers.value.some(u => u.id === user.id)) return;
	const nextIds = [...visibleUsers.value.map(u => u.id), user.id];
	const updated = await os.apiWithDialog('live-channels/update', { visibleUserIds: nextIds });
	channel.value = updated;
	await loadVisibleUsers(updated.visibleUserIds ?? []);
}

async function removeVisibleUser(id: string) {
	if (channel.value == null) return;
	const nextIds = visibleUsers.value.filter(u => u.id !== id).map(u => u.id);
	const updated = await os.apiWithDialog('live-channels/update', { visibleUserIds: nextIds });
	channel.value = updated;
	await loadVisibleUsers(updated.visibleUserIds ?? []);
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

async function onToggleAutoPostNote(v: boolean) {
	if (channel.value == null) return;
	autoPostNoteEnabled.value = v;
	const updated = await os.apiWithDialog('live-channels/update', { autoPostNoteEnabled: v });
	channel.value = updated;
}

async function onAutoPostNoteTemplateSave(v: string) {
	if (channel.value == null) return;
	autoPostNoteTemplate.value = v;
	const updated = await os.apiWithDialog('live-channels/update', { autoPostNoteTemplate: v || null });
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

function changeOfflineImage(ev: PointerEvent) {
	async function done(driveFile: Misskey.entities.DriveFile) {
		if (channel.value == null) return;
		const updated = await os.apiWithDialog('live-channels/update', {
			offlineImageId: driveFile.id,
		});
		channel.value = updated;
	}

	os.popupMenu([{
		text: i18n.ts._liveChannel.offlineImage,
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

// Twitch state
const twitchState = ref<'loading' | 'ready'>('loading');
const twitchAvailable = ref(false);
const twitchLinked = ref(false);
const twitchLogin = ref<string | null>(null);
const twitchDisplayName = ref<string | null>(null);
const botLinked = ref(false);
const botLogin = ref<string | null>(null);

async function fetchStatus() {
	const res = await misskeyApi('twitch/my-account', {});
	twitchAvailable.value = res.available;
	twitchLinked.value = res.linked;
	twitchLogin.value = res.twitchLogin;
	twitchDisplayName.value = res.twitchDisplayName;
	botLinked.value = res.botLinked;
	botLogin.value = res.botLogin;
	twitchState.value = 'ready';
}

async function link() {
	const { url } = await os.apiWithDialog('twitch/generate-oauth-url', {});
	window.location.href = url;
}

async function linkBot() {
	const { canceled } = await os.confirm({
		type: 'question',
		text: i18n.ts._twitch.linkBotConfirm,
	});
	if (canceled) return;
	const { url } = await os.apiWithDialog('twitch/generate-oauth-url', { forBot: true });
	window.location.href = url;
}

async function unlink() {
	const { canceled } = await os.confirm({
		type: 'warning',
		text: i18n.ts._twitch.unlinkConfirm,
	});
	if (canceled) return;
	await os.apiWithDialog('twitch/unlink', {});
	await fetchStatus();
}

function handleCallbackResult() {
	const params = new URLSearchParams(window.location.search);
	const result = params.get('twitchResult');
	if (result == null) return;

	// query を消してリロード/共有時の再表示を防ぐ
	window.history.replaceState(null, '', window.location.pathname);

	switch (result) {
		case 'linked':
			os.alert({ type: 'success', text: i18n.ts._twitch.linked });
			break;
		case 'botLinked':
			os.alert({ type: 'success', text: i18n.ts._twitch.botLinkedSuccess });
			break;
		case 'denied':
			os.alert({ type: 'warning', text: i18n.ts._twitch.linkDenied });
			break;
		case 'error': {
			const reason = params.get('reason');
			os.alert({ type: 'error', text: reason != null ? `${i18n.ts._twitch.linkError}\n${reason}` : i18n.ts._twitch.linkError });
			break;
		}
	}
}

// Streamer tools
function copyObsOverlayUrl() {
	// ?zen で最小レイアウト (ヘッダー等なし) になる。OBS のブラウザソースは
	// ログインできないため、オーバーレイページは匿名アクセス前提
	copyToClipboard(`${serverUrl}/live/${$i.username}/overlay?zen`);
}

async function openTtsSettings() {
	const { dispose } = await os.popupAsyncWithDialog(
		import('@/pages/live-stream.tts-settings.vue').then(x => x.default),
		{},
		{ closed: () => dispose() },
	);
}

async function openCommentGeneratorSettings() {
	const { dispose } = await os.popupAsyncWithDialog(
		import('@/pages/live-stream.comment-generator-settings.vue').then(x => x.default),
		{ acct: $i.username },
		{ closed: () => dispose() },
	);
}

async function openBlocks() {
	const { dispose } = await os.popupAsyncWithDialog(
		import('@/pages/live-stream.blocks.vue').then(x => x.default),
		{},
		{ closed: () => dispose() },
	);
}

async function openTranslationSettings() {
	const { dispose } = await os.popupAsyncWithDialog(
		import('@/pages/live-stream.translation-settings.vue').then(x => x.default),
		{},
		{ closed: () => dispose() },
	);
}

onMounted(async () => {
	handleCallbackResult();
	await Promise.all([fetchMy(), fetchStatus()]);
	nowTimer = window.setInterval(() => {
		now.value = Date.now();
	}, 1000);
});

onUnmounted(() => {
	if (nowTimer != null) window.clearInterval(nowTimer);
});

const headerActions = computed(() => []);

const headerTabs = computed(() => []);

definePage(() => ({
	title: i18n.ts._streaming.title,
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

.settingsDetails {
	border: 1px solid var(--MI_THEME-divider);
	border-radius: var(--MI-radius);
	padding: 10px 12px;

	> summary {
		cursor: pointer;
		font-weight: 700;

		&::marker {
			color: color(from var(--MI_THEME-fg) srgb r g b / 0.6);
		}
	}

	> .settingsDetails {
		margin-top: 10px;
	}
}

.settingsTableWrap {
	overflow-x: auto;
	margin-top: 8px;
}

// item / value の2列のみ (配信上限の表示用)
.limitsTable {
	width: 100%;
	min-width: 320px;
	table-layout: fixed;
	border-collapse: collapse;
	font-size: 0.9em;

	th, td {
		text-align: left;
		padding: 6px 10px;
		border-bottom: 1px solid var(--MI_THEME-divider);
		vertical-align: top;
		overflow-wrap: break-word;
	}

	th {
		width: 55%;
		font-weight: 500;
	}

	td {
		width: 45%;
	}
}

// item / value / note の3列 (推奨設定テーブル用)
.settingsTable {
	width: 100%;
	min-width: 480px;
	table-layout: fixed;
	border-collapse: collapse;
	font-size: 0.9em;

	th, td {
		text-align: left;
		padding: 6px 10px;
		border-bottom: 1px solid var(--MI_THEME-divider);
		vertical-align: top;
		overflow-wrap: break-word;
	}

	thead th {
		color: color(from var(--MI_THEME-fg) srgb r g b / 0.75);
		font-weight: 700;
	}

	tbody th {
		font-weight: 500;
	}

	th:nth-child(1), td:nth-child(1) {
		width: 30%;
	}

	th:nth-child(2), td:nth-child(2) {
		width: 22%;
	}

	th:nth-child(3), td:nth-child(3) {
		width: 48%;
	}
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

.visibleUsersBox {
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.visibleUsersList {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
}

.visibleUserItem {
	display: flex;
	align-items: center;
	gap: 4px;
	padding: 6px 6px 6px 10px;
	border-radius: 999px;
	background: var(--MI_THEME-panel);
}
</style>
