<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader :actions="headerActions" :tabs="headerTabs">
	<div class="_spacer" style="--MI_SPACER-w: 800px;">
		<Transition
			:enterActiveClass="prefer.s.animation ? $style.fadeEnterActive : ''"
			:leaveActiveClass="prefer.s.animation ? $style.fadeLeaveActive : ''"
			:enterFromClass="prefer.s.animation ? $style.fadeEnterFrom : ''"
			:leaveToClass="prefer.s.animation ? $style.fadeLeaveTo : ''"
			mode="out-in"
		>
			<div v-if="updateInfo" :key="updateInfo.id" class="_panel" :class="$style.updateInfo">
				<div :class="$style.header">
					<i class="ti ti-speakerphone" style="margin-right: 0.5em;"></i>
					<Mfm :text="updateInfo.title" class="_selectable"/>
				</div>
				<div :class="$style.content">
					<Mfm :text="updateInfo.text" class="_selectable"/>
					<img v-if="updateInfo.imageUrl" :src="updateInfo.imageUrl"/>
					<div style="margin-top: 8px; opacity: 0.7; font-size: 85%;">
						{{ i18n.ts.createdAt }}: <MkTime :time="updateInfo.createdAt" mode="detail"/>
					</div>
					<div v-if="updateInfo.updatedAt" style="opacity: 0.7; font-size: 85%;">
						{{ i18n.ts.updatedAt }}: <MkTime :time="updateInfo.updatedAt" mode="detail"/>
					</div>
				</div>
			</div>
			<MkError v-else-if="error" @retry="_fetch_()"/>
			<MkLoading v-else/>
		</Transition>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { ref, computed, watch } from 'vue';
import * as Misskey from 'misskey-js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import { prefer } from '@/preferences.js';

const props = defineProps<{
	updateInfoId: string;
}>();

const updateInfo = ref<Misskey.entities.UpdateInfo | null>(null);
const error = ref<any>(null);
const path = computed(() => props.updateInfoId);

function _fetch_() {
	updateInfo.value = null;
	misskeyApi('update-info/show', {
		updateInfoId: props.updateInfoId,
	}).then(async _updateInfo => {
		updateInfo.value = _updateInfo;
	}).catch(err => {
		error.value = err;
	});
}

watch(() => path.value, _fetch_, { immediate: true });

const headerActions = computed(() => []);

const headerTabs = computed(() => []);

definePage(() => ({
	title: updateInfo.value ? updateInfo.value.title : i18n.ts.updateInfo,
	icon: 'ti ti-speakerphone',
}));
</script>

<style lang="scss" module>
.fadeEnterActive,
.fadeLeaveActive {
	transition: opacity 0.125s ease;
}
.fadeEnterFrom,
.fadeLeaveTo {
	opacity: 0;
}

.updateInfo {
	padding: 16px;
}

.header {
	margin-bottom: 16px;
	font-weight: bold;
	font-size: 120%;
}

.content {
	> img {
		display: block;
		max-height: 300px;
		max-width: 100%;
	}
}
</style>
