<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.root">
	<div :class="$style.banner" :style="{ backgroundImage: bannerUrl ? `url(${ bannerUrl })` : '' }">
		<div v-if="bannerUrl" :class="$style.fade"></div>
	</div>
	<div :class="$style.header">
		<div :class="$style.avatarWrap">
			<MkAvatar :class="[$style.avatar, { [$style.avatarLive]: isLive }]" :user="user" link indicator/>
			<div v-if="isLive" :class="$style.liveBadge">{{ i18n.ts._liveChannel.liveNow }}</div>
		</div>
		<div :class="$style.names">
			<div :class="$style.channelName">{{ channel.name ?? user.name ?? user.username }}</div>
			<div :class="$style.acct"><MkAcct :user="user" :detail="true"/></div>
		</div>
		<div :class="$style.actions">
			<MkButton v-if="isOwner" type="routerLink" :to="`/settings/streaming`" link rounded primary>{{ i18n.ts._liveChannel.editChannel }}</MkButton>
			<MkButton v-if="isLive" type="routerLink" :to="`/live/${acct}/stream`" link rounded primary>{{ i18n.ts._liveChannel.watchStream }}</MkButton>
			<MkButton v-else-if="isOwner" type="routerLink" :to="`/live/${acct}/stream`" link rounded>{{ i18n.ts._liveChannel.previewStream }}</MkButton>
			<MkFollowButton v-if="$i != null && $i.id !== user.id" v-model:user="user" :full="true"/>
		</div>
	</div>
	<div v-if="channel.description" :class="$style.description" class="_selectable">
		<Mfm :text="channel.description" :isNote="false" :author="user" :plain="true"/>
	</div>

	<MkTab v-model="tab" :tabs="[
		{ key: 'home', label: i18n.ts._liveChannel.home, icon: 'ti ti-home' },
		{ key: 'posts', label: i18n.ts._liveChannel.posts, icon: 'ti ti-pencil' },
		{ key: 'media', label: i18n.ts._liveChannel.media, icon: 'ti ti-photo' },
	]" :class="$style.tab"/>

	<div :class="$style.tabContent">
		<div v-if="tab === 'home'" :class="$style.placeholder">
			<i class="ti ti-live-photo"></i>
			<div>{{ i18n.ts._liveChannel.noStreamHistory }}</div>
		</div>

		<div v-else-if="tab === 'posts'">
			<div v-if="channelId == null" :class="$style.placeholder">
				<i class="ti ti-pencil-off"></i>
				<div>{{ i18n.ts._liveChannel.initializingChannel }}</div>
				<MkButton rounded primary @click="reload">
					<i class="ti ti-refresh"></i> {{ i18n.ts.retry }}
				</MkButton>
			</div>
			<template v-else>
				<div :class="$style.postFormArea" class="_buttonsCenter">
					<MkButton inline rounded primary gradate @click="openPostForm">
						<i class="ti ti-pencil"></i> {{ i18n.ts._liveChannel.postToChannel }}
					</MkButton>
				</div>
				<MkStreamingNotesTimeline :key="channelId" src="channel" :channel="channelId"/>
			</template>
		</div>

		<div v-else-if="tab === 'media'">
			<div v-if="channelId == null" :class="$style.placeholder">
				<i class="ti ti-pencil-off"></i>
				<div>{{ i18n.ts._liveChannel.initializingChannel }}</div>
				<MkButton rounded primary @click="reload">
					<i class="ti ti-refresh"></i> {{ i18n.ts.retry }}
				</MkButton>
			</div>
			<div v-else :class="$style.mediaRoot">
				<MkLoading v-if="mediaFetching"/>
				<div v-else-if="mediaNotes.length === 0" :class="$style.placeholder">
					<i class="ti ti-photo-off"></i>
					<div>{{ i18n.ts.nothing }}</div>
				</div>
				<div v-else :class="$style.mediaGrid">
					<template v-for="note in mediaNotes" :key="note.id">
						<MkA
							v-for="file in note.files"
							:key="`${note.id}:${file.id}`"
							:class="$style.mediaCell"
							:to="notePage(note)"
							:data-scroll-anchor="`${note.id}:${file.id}`"
						>
							<MkMediaImage
								v-if="file.type.startsWith('image')"
								:image="file"
								disableImageLink
								cover
								controls
								:class="$style.mediaImage"
							/>
							<MkDriveFileThumbnail
								v-else
								:file="file"
								fit="cover"
								:highlightWhenSensitive="prefer.s.highlightSensitiveMedia"
								:large="true"
								:class="$style.mediaThumb"
							/>
						</MkA>
					</template>
				</div>
			</div>
		</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from 'vue';
import * as Misskey from 'misskey-js';
import MkAvatar from '@/components/global/MkAvatar.vue';
import MkAcct from '@/components/global/MkAcct.vue';
import MkButton from '@/components/MkButton.vue';
import MkFollowButton from '@/components/MkFollowButton.vue';
import MkStreamingNotesTimeline from '@/components/MkStreamingNotesTimeline.vue';
import MkTab from '@/components/MkTab.vue';
import MkMediaImage from '@/components/MkMediaImage.vue';
import MkDriveFileThumbnail from '@/components/MkDriveFileThumbnail.vue';
import MkA from '@/components/global/MkA.vue';
import MkLoading from '@/components/global/MkLoading.vue';
import { i18n } from '@/i18n.js';
import { $i } from '@/i.js';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { notePage } from '@/filters/note.js';
import { prefer } from '@/preferences.js';

const props = defineProps<{
	user: Misskey.entities.UserDetailed;
	channel: Misskey.Endpoints['live-channels/show']['res'];
	isOwner: boolean;
	isLive: boolean;
	acct: string;
}>();

const user = ref(props.user);
const tab = ref<'home' | 'posts' | 'media'>('home');
const mediaFetching = ref(false);
const mediaNotes = ref<Misskey.entities.Note[]>([]);
const misskeyChannel = ref<Misskey.entities.Channel | null>(null);

const channelId = computed<string | null>(() => props.channel.channelId ?? null);

const bannerUrl = computed(() => {
	if (props.channel.bannerUrl != null) return props.channel.bannerUrl;
	return props.user.bannerUrl;
});

async function fetchMisskeyChannel() {
	const id = channelId.value;
	if (id == null) {
		misskeyChannel.value = null;
		return;
	}
	try {
		misskeyChannel.value = await misskeyApi('channels/show', { channelId: id });
	} catch {
		misskeyChannel.value = null;
	}
}

function openPostForm() {
	if (misskeyChannel.value == null) return;
	os.post({ channel: misskeyChannel.value });
}

watch(channelId, fetchMisskeyChannel, { immediate: true });

const emit = defineEmits<{
	(ev: 'reload'): void;
}>();

function reload() {
	emit('reload');
}

async function loadMedia() {
	if (channelId.value == null) {
		mediaNotes.value = [];
		return;
	}
	mediaFetching.value = true;
	try {
		const notes = await misskeyApi('channels/timeline', {
			channelId: channelId.value,
			limit: 30,
		});
		mediaNotes.value = notes.filter(note => note.fileIds != null && note.fileIds.length > 0);
	} finally {
		mediaFetching.value = false;
	}
}

watch(tab, (newTab) => {
	if (newTab === 'media') {
		loadMedia();
	}
}, { immediate: true });

watch(() => props.channel, () => {
	if (tab.value === 'media') {
		loadMedia();
	}
});
</script>

<style lang="scss" module>
.root {
	display: flex;
	flex-direction: column;
	gap: var(--MI-margin);
}

.banner {
	position: relative;
	--bannerHeight: 200px;
	height: var(--bannerHeight);
	background-color: var(--MI_THEME-panel);
	background-size: cover;
	background-position: center;
	overflow: clip;
	border-radius: var(--MI-radius);

	> .fade {
		position: absolute;
		bottom: 0;
		left: 0;
		width: 100%;
		height: 64px;
		background: linear-gradient(transparent, color-mix(in srgb, #000, transparent 30%));
	}
}

.header {
	position: relative;
	display: flex;
	align-items: flex-end;
	gap: 16px;
	padding: 0 16px;
	margin-top: -40px;
}

.avatarWrap {
	display: flex;
	flex-direction: column;
	align-items: center;
	flex-shrink: 0;
	gap: 6px;
}

.avatar {
	width: 96px;
	height: 96px;
	box-shadow: 0 0 0 4px var(--MI_THEME-bg);
	border-radius: var(--MI-radius);
	background: var(--MI_THEME-bg);
}

.avatarLive {
	box-shadow: 0 0 0 3px var(--MI_THEME-bg), 0 0 0 5px var(--MI_THEME-error);
}

.liveBadge {
	padding: 2px 10px;
	font-size: 0.75em;
	font-weight: bold;
	color: var(--MI_THEME-fgOnAccent);
	background: var(--MI_THEME-error);
	border-radius: 999px;
	white-space: nowrap;
}

.names {
	flex: 1;
	min-width: 0;
	padding-bottom: 8px;
}

.channelName {
	font-weight: bold;
	font-size: 1.4em;
	line-height: 1.3;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.acct {
	font-size: 0.9em;
	opacity: 0.8;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.actions {
	flex-shrink: 0;
	display: flex;
	gap: 8px;
	padding-bottom: 8px;
	flex-wrap: wrap;
}

.description {
	padding: 0 16px;
}

.tab {
	padding: calc(var(--MI-margin) / 2) 16px;
	background: var(--MI_THEME-bg);
}

.tabContent {
	padding: 0 16px;
}

.placeholder {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 8px;
	padding: 48px 16px;
	color: var(--MI_THEME-fg);
	opacity: 0.7;
	font-size: 1em;
	text-align: center;

	> i {
		font-size: 2em;
		opacity: 0.6;
	}
}

.postFormArea {
	padding: 16px 0;
}

.mediaRoot {
	min-height: 120px;
}

.mediaGrid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
	gap: 8px;
}

.mediaCell {
	position: relative;
	aspect-ratio: 1;
	border-radius: calc(var(--MI-radius) / 2);
	overflow: clip;
	background: var(--MI_THEME-bg);

	&:hover {
		text-decoration: none;
	}
}

.mediaImage,
.mediaThumb {
	width: 100%;
	height: 100%;
	border-radius: calc(var(--MI-radius) / 2);
}

@media (max-width: 500px) {
	.banner {
		--bannerHeight: 120px;
		border-radius: 0;
	}

	.header {
		align-items: center;
		margin-top: -46px;
		flex-wrap: wrap;
	}

	.avatar {
		width: 92px;
		height: 92px;
	}

	.names {
		padding-top: 46px;
	}

	.actions {
		padding-top: 46px;
		justify-content: flex-end;
		width: 100%;
	}

	.description {
		text-align: center;
	}

	.mediaGrid {
		grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
	}
}
</style>
