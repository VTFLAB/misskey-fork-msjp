<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader :actions="headerActions" :tabs="headerTabs">
	<div class="_spacer" style="--MI_SPACER-w: 800px;">
		<div class="_gaps">
			<MkPagination v-slot="{items}" :paginator="paginator" class="_gaps">
				<section v-for="updateInfo in items" :key="updateInfo.id" class="_panel" :class="$style.updateInfo">
					<div :class="$style.header">
						<i class="ti ti-speakerphone" style="margin-right: 0.5em;"></i>
						<MkA :to="`/updates/${updateInfo.id}`"><span>{{ updateInfo.title }}</span></MkA>
					</div>
					<div :class="$style.content">
						<Mfm :text="updateInfo.text" class="_selectable"/>
						<img v-if="updateInfo.imageUrl" :src="updateInfo.imageUrl"/>
						<MkA :to="`/updates/${updateInfo.id}`">
							<div style="margin-top: 8px; opacity: 0.7; font-size: 85%;">
								{{ i18n.ts.createdAt }}: <MkTime :time="updateInfo.createdAt" mode="detail"/>
							</div>
							<div v-if="updateInfo.updatedAt" style="opacity: 0.7; font-size: 85%;">
								{{ i18n.ts.updatedAt }}: <MkTime :time="updateInfo.updatedAt" mode="detail"/>
							</div>
						</MkA>
					</div>
				</section>
			</MkPagination>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, markRaw } from 'vue';
import MkPagination from '@/components/MkPagination.vue';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import { Paginator } from '@/utility/paginator.js';

const paginator = markRaw(new Paginator('update-infos', {
	limit: 10,
}));

const headerActions = computed(() => []);

const headerTabs = computed(() => []);

definePage(() => ({
	title: i18n.ts.updateInfo,
	icon: 'ti ti-speakerphone',
}));
</script>

<style lang="scss" module>
.updateInfo {
	padding: 16px;
}

.header {
	margin-bottom: 16px;
	font-weight: bold;
}

.content {
	> img {
		display: block;
		max-height: 300px;
		max-width: 100%;
	}
}
</style>
