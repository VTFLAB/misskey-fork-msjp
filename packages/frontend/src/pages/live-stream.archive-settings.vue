<!--
SPDX-FileCopyrightText: misskey-bsky-integration fork
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkModalWindow
	ref="dialog"
	:width="480"
	:height="500"
	@close="dialog?.close()"
	@closed="emit('closed')"
>
	<template #header>{{ i18n.ts._liveChannel.archiveSettingsTitle }}</template>

	<div class="_spacer" style="--MI_SPACER-min: 20px; --MI_SPACER-max: 28px;">
		<div class="_gaps_m">
			<MkInfo>{{ i18n.ts._liveChannel.archiveSettingsDescription }}</MkInfo>

			<MkSelect :modelValue="visibility" :items="viewRestrictionItems" @update:modelValue="onVisibilitySave">
				<template #label>{{ i18n.ts._liveChannel.viewRestriction }}</template>
				<template #caption>{{ i18n.ts._liveChannel.viewRestrictionDescription }}</template>
			</MkSelect>

			<MkInput v-if="visibility === 'password'" :modelValue="viewPassword" manualSave :max="128" :placeholder="i18n.ts._liveChannel.viewPasswordPlaceholder" @update:modelValue="onViewPasswordSave">
				<template #label>{{ i18n.ts._liveChannel.viewPassword }}</template>
				<template #caption>{{ i18n.ts._liveChannel.viewPasswordDescription }}</template>
			</MkInput>

			<div v-if="visibility === 'users'" :class="$style.visibleUsersBox">
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
	</div>
</MkModalWindow>
</template>

<script lang="ts" setup>
import { ref, useTemplateRef, onMounted } from 'vue';
import * as Misskey from 'misskey-js';
import MkModalWindow from '@/components/MkModalWindow.vue';
import MkSelect from '@/components/MkSelect.vue';
import MkInput from '@/components/MkInput.vue';
import MkButton from '@/components/MkButton.vue';
import MkInfo from '@/components/MkInfo.vue';
import MkAcct from '@/components/global/MkAcct.vue';
import { i18n } from '@/i18n.js';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';

// アーカイブ単位の視聴制限個別設定モーダル (bsky-fork 独自)。settings/streaming.vue の
// 視聴制限 FormSection と同型のフォームだが、送信先が twitch/streams/update-archive-settings
// に差し替わっている独立実装 (既存の streaming.vue には一切手を入れない方針)。
type ArchiveSettings = Misskey.Endpoints['twitch/streams/update-archive-settings']['res'];

const props = defineProps<{
	streamId: string;
	archiveViewVisibility: 'public' | 'followers' | 'password' | 'users';
	archiveViewPassword: string | null;
	archiveVisibleUserIds: string[];
}>();

const emit = defineEmits<{
	(ev: 'updated', settings: ArchiveSettings): void;
	(ev: 'closed'): void;
}>();

const dialog = useTemplateRef('dialog');

const visibility = ref(props.archiveViewVisibility);
const viewPassword = ref(props.archiveViewPassword ?? '');
const visibleUsers = ref<Misskey.entities.UserDetailed[]>([]);

const viewRestrictionItems = [
	{ value: 'public' as const, label: i18n.ts._liveChannel.viewRestrictionPublic },
	{ value: 'followers' as const, label: i18n.ts._liveChannel.viewRestrictionFollowers },
	{ value: 'password' as const, label: i18n.ts._liveChannel.viewRestrictionPassword },
	{ value: 'users' as const, label: i18n.ts._liveChannel.viewRestrictionUsers },
];

async function loadVisibleUsers(ids: string[]) {
	if (ids.length === 0) {
		visibleUsers.value = [];
		return;
	}
	const users = await misskeyApi('users/show', { userIds: ids });
	visibleUsers.value = Array.isArray(users) ? users : [users];
}

// 呼び出し元 (archive-history.vue) の一覧項目を再取得無しで最新化できるよう、
// 更新のたびに変更後の値をそのまま emit する (計画書 §10 の「呼び出し元に変更後の値を伝える」に対応)
function applyUpdated(updated: ArchiveSettings) {
	visibility.value = updated.archiveViewVisibility;
	viewPassword.value = updated.archiveViewPassword ?? '';
	emit('updated', updated);
}

async function onVisibilitySave(v: 'public' | 'followers' | 'password' | 'users') {
	visibility.value = v;
	const updated = await os.apiWithDialog('twitch/streams/update-archive-settings', { streamId: props.streamId, visibility: v });
	applyUpdated(updated);
	await loadVisibleUsers(updated.archiveVisibleUserIds);
}

async function onViewPasswordSave(v: string) {
	viewPassword.value = v;
	const updated = await os.apiWithDialog('twitch/streams/update-archive-settings', { streamId: props.streamId, viewPassword: v || null });
	applyUpdated(updated);
}

async function addVisibleUser() {
	const user = await os.selectUser({ includeSelf: false });
	if (visibleUsers.value.some(u => u.id === user.id)) return;
	const nextIds = [...visibleUsers.value.map(u => u.id), user.id];
	const updated = await os.apiWithDialog('twitch/streams/update-archive-settings', { streamId: props.streamId, visibleUserIds: nextIds });
	applyUpdated(updated);
	await loadVisibleUsers(updated.archiveVisibleUserIds);
}

async function removeVisibleUser(id: string) {
	const nextIds = visibleUsers.value.filter(u => u.id !== id).map(u => u.id);
	const updated = await os.apiWithDialog('twitch/streams/update-archive-settings', { streamId: props.streamId, visibleUserIds: nextIds });
	applyUpdated(updated);
	await loadVisibleUsers(updated.archiveVisibleUserIds);
}

onMounted(() => {
	loadVisibleUsers(props.archiveVisibleUserIds);
});
</script>

<style lang="scss" module>
.caption {
	font-size: 0.85em;
	color: color(from var(--MI_THEME-fg) srgb r g b / 0.75);
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
