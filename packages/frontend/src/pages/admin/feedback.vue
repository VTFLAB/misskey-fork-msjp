<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader :actions="headerActions" :tabs="headerTabs">
	<div class="_spacer" style="--MI_SPACER-w: 900px;">
		<div class="_gaps">
			<MkInfo>{{ i18n.ts._feedback.adminDescription }}</MkInfo>

			<MkSelect v-model="statusFilter" :items="statusFilterItems">
				<template #label>{{ i18n.ts.state }}</template>
			</MkSelect>

			<MkPagination :paginator="paginator" class="_gaps">
				<template #default="{items}">
					<MkFolder v-for="feedback in items" :key="feedback.id" :defaultOpen="feedback.status === 'open'">
						<template #icon><i :class="feedback.type === 'bug' ? 'ti ti-bug' : 'ti ti-bulb'"></i></template>
						<template #label>{{ feedback.title }}</template>
						<template #suffix>{{ i18n.ts._feedback._status[feedback.status] }}</template>
						<template #caption>
							<MkTime :time="feedback.createdAt"/>
							<template v-if="feedback.user"> | @{{ feedback.user.username }}</template>
						</template>

						<div class="_gaps">
							<div :class="$style.meta">
								<span>{{ feedback.type === 'bug' ? i18n.ts._feedback.typeBug : i18n.ts._feedback.typeFeature }}</span>
								<template v-if="feedback.user">
									<span> | </span>
									<MkA :to="`/admin/user/${feedback.user.id}`" class="_link">@{{ feedback.user.username }}</MkA>
								</template>
								<span> | </span>
								<MkTime :time="feedback.createdAt" mode="detail"/>
							</div>

							<div :class="$style.body">{{ feedback.body }}</div>

							<div v-if="feedback.files.length > 0" :class="$style.attachments">
								<a v-for="file in feedback.files" :key="file.id" :href="file.url ?? undefined" target="_blank" rel="noopener" :class="$style.attachment">
									<img :src="file.thumbnailUrl ?? file.url ?? undefined" :alt="file.name" :class="$style.attachmentImage"/>
								</a>
							</div>

							<MkSelect v-model="getDraft(feedback).status" :items="statusEditItems">
								<template #label>{{ i18n.ts.state }}</template>
							</MkSelect>

							<MkTextarea v-model="getDraft(feedback).response" :placeholder="i18n.ts._feedback.replyPlaceholder">
								<template #label>{{ i18n.ts._feedback.responseFromStaff }}</template>
							</MkTextarea>

							<div class="_buttons">
								<MkButton rounded primary @click="save(feedback)"><i class="ti ti-device-floppy"></i> {{ i18n.ts.save }}</MkButton>
							</div>
						</div>
					</MkFolder>
				</template>
				<template #empty>
					<div :class="$style.empty">{{ i18n.ts._feedback.adminNoFeedbacks }}</div>
				</template>
			</MkPagination>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { ref, computed, reactive, watch, markRaw } from 'vue';
import * as Misskey from 'misskey-js';
import MkButton from '@/components/MkButton.vue';
import MkSelect from '@/components/MkSelect.vue';
import MkTextarea from '@/components/MkTextarea.vue';
import MkInfo from '@/components/MkInfo.vue';
import MkFolder from '@/components/MkFolder.vue';
import MkPagination from '@/components/MkPagination.vue';
import * as os from '@/os.js';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import { Paginator } from '@/utility/paginator.js';

type FeedbackStatus = 'open' | 'inProgress' | 'resolved' | 'rejected';
type AdminFeedback = Misskey.entities.AdminFeedbackListResponse[number];

const statusFilter = ref<FeedbackStatus | 'all'>('all');

const statusEditItems = [
	{ label: i18n.ts._feedback._status.open, value: 'open' as const },
	{ label: i18n.ts._feedback._status.inProgress, value: 'inProgress' as const },
	{ label: i18n.ts._feedback._status.resolved, value: 'resolved' as const },
	{ label: i18n.ts._feedback._status.rejected, value: 'rejected' as const },
];

const statusFilterItems = [
	{ label: i18n.ts.all, value: 'all' as const },
	...statusEditItems,
];

const paginator = markRaw(new Paginator('admin/feedback/list', {
	limit: 10,
	computedParams: computed(() => ({
		status: statusFilter.value === 'all' ? undefined : statusFilter.value,
	})),
}));

// 一覧アイテムは Paginator 管理のため直接書き換えず、編集値はローカル draft に持つ。
// レンダリング中に reactive Map へ書き込む副作用を避けるため、items の watch で先に seed する
// (getDraft 内の生成はタイミングエッジへの防御で、通常は seeding 済みの読み取りだけになる)。
const drafts = reactive(new Map<string, { status: FeedbackStatus; response: string }>());

watch(paginator.items, (items) => {
	for (const feedback of items) {
		if (!drafts.has(feedback.id)) {
			drafts.set(feedback.id, reactive({ status: feedback.status, response: feedback.response ?? '' }));
		}
	}
}, { immediate: true });

function getDraft(feedback: AdminFeedback): { status: FeedbackStatus; response: string } {
	let draft = drafts.get(feedback.id);
	if (draft == null) {
		draft = reactive({ status: feedback.status, response: feedback.response ?? '' });
		drafts.set(feedback.id, draft);
	}
	return draft;
}

async function save(feedback: AdminFeedback) {
	const draft = getDraft(feedback);
	await os.apiWithDialog('admin/feedback/update', {
		feedbackId: feedback.id,
		status: draft.status,
		response: draft.response.trim() === '' ? null : draft.response,
	});
	// 保存後はサーバー側の最新値から seed し直す (stale な編集値の残留を防ぐ)
	drafts.delete(feedback.id);
	paginator.reload();
}

const headerActions = computed(() => []);

const headerTabs = computed(() => []);

definePage(() => ({
	title: i18n.ts._feedback.feedback,
	icon: 'ti ti-message-report',
}));
</script>

<style lang="scss" module>
.meta {
	font-size: 0.9em;
	opacity: 0.8;
}

.body {
	white-space: pre-wrap;
	word-break: break-word;
}

.attachments {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
}

.attachment {
	width: 96px;
	height: 96px;
	border-radius: 6px;
	overflow: hidden;
	background: var(--MI_THEME-bg);
}

.attachmentImage {
	width: 100%;
	height: 100%;
	object-fit: cover;
}

.empty {
	text-align: center;
	opacity: 0.7;
	padding: 16px;
}
</style>
