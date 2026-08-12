<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader :actions="headerActions" :tabs="headerTabs">
	<div class="_spacer" style="--MI_SPACER-w: 700px;">
		<div class="_gaps">
			<MkInfo>{{ i18n.ts._feedback.pageDescription }}</MkInfo>

			<div class="_panel" :class="$style.form">
				<div class="_gaps">
					<MkRadios v-model="type" :options="typeOptions">
						<template #label>{{ i18n.ts._feedback.type }}</template>
					</MkRadios>

					<MkInput v-model="title" :placeholder="i18n.ts._feedback.reportTitlePlaceholder">
						<template #label>{{ i18n.ts._feedback.reportTitle }}</template>
					</MkInput>

					<MkTextarea v-model="body" tall>
						<template #label>{{ i18n.ts._feedback.reportBody }}</template>
						<template #caption>{{ i18n.ts._feedback.bodyTemplateNote }}</template>
					</MkTextarea>

					<div>
						<MkButton :disabled="files.length >= 4" inline @click="attachImage($event)">
							<i class="ti ti-photo-plus"></i> {{ i18n.ts._feedback.attachImages }}
						</MkButton>
						<div :class="$style.attachCaption">{{ i18n.ts._feedback.attachImagesDescription }}</div>
						<div v-if="files.length > 0" :class="$style.attachments">
							<div v-for="file in files" :key="file.id" :class="$style.attachment">
								<img :src="file.thumbnailUrl ?? file.url" :alt="file.name" :class="$style.attachmentImage"/>
								<button class="_button" :class="$style.attachmentRemove" :aria-label="i18n.ts.remove" @click="removeImage(file)">
									<i class="ti ti-x"></i>
								</button>
							</div>
						</div>
					</div>

					<MkButton primary rounded :disabled="!canSubmit" @click="submit">
						<i class="ti ti-send"></i> {{ i18n.ts._feedback.submit }}
					</MkButton>
				</div>
			</div>

			<MkFoldableSection>
				<template #header>{{ i18n.ts._feedback.myFeedbacks }}</template>
				<MkPagination :paginator="paginator" class="_gaps">
					<template #default="{items}">
						<section v-for="feedback in items" :key="feedback.id" class="_panel" :class="$style.feedbackItem">
							<div :class="$style.feedbackHeader">
								<i v-if="feedback.type === 'bug'" class="ti ti-bug"></i>
								<i v-else class="ti ti-bulb"></i>
								<span :class="$style.feedbackTitle">{{ feedback.title }}</span>
								<span :class="[$style.statusBadge, $style[`status_${feedback.status}`]]">{{ i18n.ts._feedback._status[feedback.status] }}</span>
							</div>
							<div :class="$style.feedbackBody">{{ feedback.body }}</div>
							<div v-if="feedback.files.length > 0" :class="$style.attachments">
								<a v-for="file in feedback.files" :key="file.id" :href="file.url ?? undefined" target="_blank" rel="noopener" :class="$style.attachment">
									<img :src="file.thumbnailUrl ?? file.url ?? undefined" :alt="file.name" :class="$style.attachmentImage"/>
								</a>
							</div>
							<div v-if="feedback.response != null" :class="$style.response">
								<div :class="$style.responseLabel"><i class="ti ti-message-report"></i> {{ i18n.ts._feedback.responseFromStaff }}</div>
								<div>{{ feedback.response }}</div>
							</div>
							<div :class="$style.feedbackDate">
								{{ i18n.ts.createdAt }}: <MkTime :time="feedback.createdAt" mode="detail"/>
							</div>
						</section>
					</template>
					<template #empty>
						<div :class="$style.empty">{{ i18n.ts._feedback.noFeedbacks }}</div>
					</template>
				</MkPagination>
			</MkFoldableSection>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { ref, computed, watch, markRaw } from 'vue';
import * as Misskey from 'misskey-js';
import MkButton from '@/components/MkButton.vue';
import MkInput from '@/components/MkInput.vue';
import MkTextarea from '@/components/MkTextarea.vue';
import MkRadios from '@/components/MkRadios.vue';
import MkInfo from '@/components/MkInfo.vue';
import MkFoldableSection from '@/components/MkFoldableSection.vue';
import MkPagination from '@/components/MkPagination.vue';
import * as os from '@/os.js';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import { Paginator } from '@/utility/paginator.js';
import { selectFile } from '@/utility/drive.js';

const type = ref<'bug' | 'feature'>('bug');
const typeOptions = [
	{ value: 'bug' as const, label: i18n.ts._feedback.typeBug, icon: 'ti ti-bug' },
	{ value: 'feature' as const, label: i18n.ts._feedback.typeFeature, icon: 'ti ti-bulb' },
];
const title = ref('');

// 本文は空欄だと何を書けばよいか分かりにくいため、種別ごとの記入テンプレートを
// 初期値として入れておく。ユーザーが編集済みの場合は種別を切り替えても上書きしない。
const bodyTemplates = {
	bug: i18n.ts._feedback.bugTemplate,
	feature: i18n.ts._feedback.featureTemplate,
} as const;
const body = ref<string>(bodyTemplates[type.value]);

watch(type, (newType, oldType) => {
	if (body.value.trim() === '' || body.value === bodyTemplates[oldType]) {
		body.value = bodyTemplates[newType];
	}
});
const files = ref<Misskey.entities.DriveFile[]>([]);
const submitting = ref(false);

// MkInput/MkTextarea に maxlength 相当の prop が無いため、長さ制限 (backend の
// paramDef と同値) はここで検証する。超過中は送信ボタンを無効化する。
const TITLE_MAX = 256;
const BODY_MAX = 8192;
// 本文はテンプレートのまま (未記入) では送信不可にする
const canSubmit = computed(() => !submitting.value
	&& title.value.trim() !== '' && title.value.length <= TITLE_MAX
	&& body.value.trim() !== '' && body.value.length <= BODY_MAX
	&& body.value !== bodyTemplates[type.value]);

const paginator = markRaw(new Paginator('feedback/list', {
	limit: 10,
}));

async function attachImage(ev: MouseEvent) {
	const selected = await selectFile({
		anchorElement: ev.currentTarget ?? ev.target,
		multiple: true,
	});
	let skipped = false;
	for (const file of selected) {
		if (files.value.length >= 4) {
			skipped = true;
			break;
		}
		// backend 側 (feedback/create) と同じ制限: 画像のみ・SVG 除外
		if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') {
			skipped = true;
			continue;
		}
		if (files.value.some(x => x.id === file.id)) continue;
		files.value.push(file);
	}
	if (skipped) os.toast(i18n.ts._feedback.attachmentSkipped);
}

function removeImage(file: Misskey.entities.DriveFile) {
	files.value = files.value.filter(x => x.id !== file.id);
}

async function submit() {
	submitting.value = true;
	try {
		await os.apiWithDialog('feedback/create', {
			type: type.value,
			title: title.value.trim(),
			body: body.value.trim(),
			fileIds: files.value.map(x => x.id),
		});
		title.value = '';
		body.value = bodyTemplates[type.value];
		files.value = [];
		paginator.reload();
	} finally {
		submitting.value = false;
	}
}

const headerActions = computed(() => []);

const headerTabs = computed(() => []);

definePage(() => ({
	title: i18n.ts._feedback.feedback,
	icon: 'ti ti-message-report',
}));
</script>

<style lang="scss" module>
.form {
	padding: 24px;
}

.attachCaption {
	margin-top: 6px;
	font-size: 0.85em;
	opacity: 0.7;
}

.attachments {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
	margin-top: 8px;
}

.attachment {
	position: relative;
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

.attachmentRemove {
	position: absolute;
	top: 2px;
	right: 2px;
	width: 24px;
	height: 24px;
	border-radius: 50%;
	color: var(--MI_THEME-fgOnAccent);
	background: color-mix(in srgb, var(--MI_THEME-fg) 60%, transparent);
}

.feedbackItem {
	padding: 16px;
}

.feedbackHeader {
	display: flex;
	align-items: center;
	gap: 6px;
	font-weight: bold;
	margin-bottom: 8px;
}

.feedbackTitle {
	flex: 1;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.statusBadge {
	flex-shrink: 0;
	font-size: 0.8em;
	font-weight: normal;
	padding: 2px 10px;
	border-radius: 99rem;
	background: var(--MI_THEME-buttonBg);
}

.status_open {
	background: var(--MI_THEME-infoBg);
	color: var(--MI_THEME-infoFg);
}

.status_inProgress {
	background: var(--MI_THEME-accentedBg);
	color: var(--MI_THEME-accent);
}

.status_resolved {
	background: var(--MI_THEME-infoBg);
	color: var(--MI_THEME-infoFg);
}

.status_rejected {
	background: var(--MI_THEME-infoWarnBg);
	color: var(--MI_THEME-infoWarnFg);
}

.feedbackBody {
	white-space: pre-wrap;
	word-break: break-word;
	margin-bottom: 8px;
}

.response {
	margin: 8px 0;
	padding: 12px;
	border-radius: var(--MI-radius);
	background: var(--MI_THEME-accentedBg);
	white-space: pre-wrap;
	word-break: break-word;
}

.responseLabel {
	font-weight: bold;
	margin-bottom: 4px;
	color: var(--MI_THEME-accent);
}

.feedbackDate {
	opacity: 0.7;
	font-size: 85%;
}

.empty {
	text-align: center;
	opacity: 0.7;
	padding: 16px;
}
</style>
