<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.root">
	<div ref="listEl" :class="$style.list">
		<button v-if="hasOlder" class="_button" :class="$style.loadOlder" :disabled="loadingOlder" @click="loadOlder">
			{{ i18n.ts.loadMore }}
		</button>
		<div v-for="comment in comments" :key="comment.id" :class="$style.comment">
			<template v-if="comment.source === 'misskey' && comment.user != null">
				<MkAvatar :user="comment.user" :class="$style.avatar" link preview/>
				<div :class="$style.commentBody">
					<div>
						<span :class="$style.commentName"><MkUserName :user="comment.user" :nowrap="true"/></span>
						<time :class="$style.commentTime" :title="formatTimeFull(comment.createdAt)">{{ formatTime(comment.createdAt) }}</time>
					</div>
					<Mfm v-if="comment.text" :class="$style.commentText" :text="comment.text" :author="comment.user" :i="$i"/>
					<MkMediaList v-if="comment.files.length > 0" :class="$style.commentFiles" :mediaList="comment.files"/>
				</div>
			</template>
			<template v-else>
				<i class="ti ti-brand-twitch" :class="$style.twitchIcon"></i>
				<div :class="$style.commentBody">
					<div>
						<span :class="$style.commentName">{{ comment.twitchDisplayName ?? comment.twitchUserName ?? '?' }}</span>
						<time :class="$style.commentTime" :title="formatTimeFull(comment.createdAt)">{{ formatTime(comment.createdAt) }}</time>
					</div>
					<span :class="$style.commentText">{{ comment.text }}</span>
				</div>
			</template>
		</div>
		<div v-if="comments.length === 0 && !fetching" :class="$style.empty">{{ i18n.ts._twitch.noComments }}</div>
	</div>
	<div
		v-if="$i != null && live"
		:class="$style.form"
		@dragover.stop="onDragover"
		@drop.stop="onDrop"
	>
		<div v-if="files.length > 0" :class="$style.attaches">
			<button v-for="file in files" :key="file.id" class="_button" :class="$style.attach" :title="i18n.ts.attachCancel" @click="removeFile(file.id)">
				<i class="ti ti-paperclip"></i> {{ file.name }}
			</button>
		</div>
		<div :class="$style.inputRow">
			<textarea
				ref="textareaEl"
				v-model="text"
				:class="$style.textarea"
				:placeholder="i18n.ts._twitch.commentPlaceholder"
				:aria-label="i18n.ts._twitch.commentPlaceholder"
				maxlength="500"
				rows="1"
				:readonly="textareaReadOnly"
				@keydown="onKeydown"
				@paste="onPaste"
			></textarea>
			<button class="_button" :class="$style.formButton" :title="i18n.ts.attachFile" :aria-label="i18n.ts.attachFile" @click="chooseFile"><i class="ti ti-photo-plus"></i></button>
			<button class="_button" :class="$style.formButton" :title="i18n.ts.emoji" :aria-label="i18n.ts.emoji" @click="insertEmoji"><i class="ti ti-mood-happy"></i></button>
			<button class="_button" :class="[$style.formButton, $style.sendButton]" :disabled="sending || !canSend" :title="i18n.ts.send" :aria-label="i18n.ts.send" @click="send">
				<template v-if="!sending"><i class="ti ti-send"></i></template><template v-else><MkLoading :em="true"/></template>
			</button>
		</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import { ref, computed, useTemplateRef, onMounted, onBeforeUnmount, onUnmounted, nextTick } from 'vue';
import * as Misskey from 'misskey-js';
import { versatileLang, dateTimeFormat } from '@@/js/intl-const.js';
import { i18n } from '@/i18n.js';
import { $i } from '@/i.js';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { useStream } from '@/stream.js';
import { selectFile } from '@/utility/drive.js';
import { Autocomplete } from '@/utility/autocomplete.js';
import { emojiPicker } from '@/utility/emoji-picker.js';
import { formatTimeString } from '@/utility/format-time-string.js';
import { checkDragDataType, getDragData } from '@/drag-and-drop.js';
import MkMediaList from '@/components/MkMediaList.vue';

type Comment = Misskey.Endpoints['twitch/streams/comments']['res'][number];

const MAX_FILES = 16;

const props = defineProps<{
	streamId: string;
	live: boolean;
}>();

const emit = defineEmits<{
	(ev: 'streamEnded'): void;
}>();

const comments = ref<Comment[]>([]);
const fetching = ref(true);
const hasOlder = ref(false);
const loadingOlder = ref(false);
const text = ref('');
const files = ref<Misskey.entities.DriveFile[]>([]);
const sending = ref(false);
const textareaReadOnly = ref(false);
const listEl = useTemplateRef('listEl');
const textareaEl = useTemplateRef('textareaEl');
let autocompleteInstance: Autocomplete | null = null;

const canSend = computed(() => text.value.trim().length > 0 || files.value.length > 0);

const stream = useStream();
let connection: Misskey.IChannelConnection<Misskey.Channels['twitchLiveStream']> | null = null;

// ライブチャット向けの HH:mm 表記 (ツールチップにフル日時)
let _timeFormat: Intl.DateTimeFormat;
try {
	_timeFormat = new Intl.DateTimeFormat(versatileLang, { hour: '2-digit', minute: '2-digit' });
} catch {
	_timeFormat = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit' });
}

function formatTime(time: string): string {
	return _timeFormat.format(new Date(time));
}

function formatTimeFull(time: string): string {
	return dateTimeFormat.format(new Date(time));
}

function scrollToBottom() {
	nextTick(() => {
		if (listEl.value != null) {
			listEl.value.scrollTop = listEl.value.scrollHeight;
		}
	});
}

function isNearBottom(): boolean {
	if (listEl.value == null) return true;
	return listEl.value.scrollHeight - listEl.value.scrollTop - listEl.value.clientHeight < 120;
}

async function fetchInitial() {
	try {
		const res = await misskeyApi('twitch/streams/comments', {
			streamId: props.streamId,
			limit: 30,
		});
		// API は新しい順で返すので表示用に反転する
		comments.value = res.reverse();
		hasOlder.value = res.length >= 30;
		scrollToBottom();
	} finally {
		fetching.value = false;
	}
}

async function loadOlder() {
	if (comments.value.length === 0) return;
	loadingOlder.value = true;
	try {
		const res = await misskeyApi('twitch/streams/comments', {
			streamId: props.streamId,
			limit: 30,
			untilId: comments.value[0].id,
		});
		comments.value = [...res.reverse(), ...comments.value];
		hasOlder.value = res.length >= 30;
	} finally {
		loadingOlder.value = false;
	}
}

function onComment(comment: Comment) {
	if (comments.value.some(c => c.id === comment.id)) return;
	const shouldScroll = isNearBottom();
	comments.value.push(comment);
	// メモリ節約: 表示は直近 300 件に制限 (履歴はさかのぼり読み込みで参照可能)
	if (comments.value.length > 300) {
		comments.value = comments.value.slice(-300);
		hasOlder.value = true;
	}
	if (shouldScroll) scrollToBottom();
}

function onKeydown(ev: KeyboardEvent) {
	// IME 変換確定の Enter で送信しないようにガードする (MkInput.vue と同一パターン)
	if (ev.isComposing || ev.key === 'Process' || ev.keyCode === 229) return;
	if (ev.key !== 'Enter') return;
	// Shift+Enter は改行
	if (ev.shiftKey) return;
	ev.preventDefault();
	send();
}

function addFiles(added: Misskey.entities.DriveFile[]) {
	files.value = [...files.value, ...added].slice(0, MAX_FILES);
}

function removeFile(fileId: string) {
	files.value = files.value.filter(f => f.id !== fileId);
}

function chooseFile(ev: MouseEvent) {
	selectFile({
		anchorElement: (ev.currentTarget ?? ev.target) as HTMLElement | null,
		multiple: true,
		label: i18n.ts.attachFile,
	}).then(selected => {
		addFiles(selected);
	});
}

function onPaste(ev: ClipboardEvent) {
	if (!ev.clipboardData) return;

	const pastedFiles = [...ev.clipboardData.items]
		.filter(item => item.kind === 'file')
		.map(item => item.getAsFile())
		.filter(file => file != null);
	if (pastedFiles.length === 0) return;

	// クリップボード由来のファイル名は "image.png" 等で衝突するため日時ベースに揃える (chat と同一パターン)
	const renamed = pastedFiles.map((file, i) => {
		const lio = file.name.lastIndexOf('.');
		const ext = lio >= 0 ? file.name.slice(lio) : '';
		const name = formatTimeString(new Date(file.lastModified), 'yyyy-MM-dd HH-mm-ss [{{number}}]').replace(/{{number}}/g, `${i + 1}`) + ext;
		return new File([file], name, { type: file.type });
	});
	os.launchUploader(renamed, { multiple: true }).then(driveFiles => {
		addFiles(driveFiles);
	});
}

function onDragover(ev: DragEvent) {
	if (!ev.dataTransfer) return;

	const isFile = ev.dataTransfer.items[0]?.kind === 'file';
	if (isFile || checkDragDataType(ev, ['driveFiles'])) {
		ev.preventDefault();
		ev.dataTransfer.dropEffect = 'copy';
	}
}

function onDrop(ev: DragEvent) {
	if (!ev.dataTransfer) return;

	if (ev.dataTransfer.files.length > 0) {
		ev.preventDefault();
		os.launchUploader(Array.from(ev.dataTransfer.files), { multiple: true }).then(driveFiles => {
			addFiles(driveFiles);
		});
		return;
	}

	const droppedData = getDragData(ev, 'driveFiles');
	if (droppedData != null) {
		ev.preventDefault();
		addFiles(droppedData);
	}
}

async function insertEmoji(ev: MouseEvent) {
	textareaReadOnly.value = true;
	const target = ev.currentTarget ?? ev.target;
	if (target == null) return;

	// emojiPicker はダイアログが閉じずに textarea とやりとりするので、
	// focustrap 下では insertTextAtCursor が効かずテキストへ直接注入する (chat/room.form.vue と同一パターン)
	let pos = textareaEl.value?.selectionStart ?? 0;
	let posEnd = textareaEl.value?.selectionEnd ?? text.value.length;
	emojiPicker.show(
		target as HTMLElement,
		emoji => {
			const textBefore = text.value.substring(0, pos);
			const textAfter = text.value.substring(posEnd);
			text.value = textBefore + emoji + textAfter;
			pos += emoji.length;
			posEnd += emoji.length;
		},
		() => {
			textareaReadOnly.value = false;
			nextTick(() => textareaEl.value?.focus());
		},
	);
}

async function send() {
	if (!canSend.value || sending.value) return;
	const t = text.value.trim();
	sending.value = true;
	try {
		await misskeyApi('twitch/streams/comments/create', {
			streamId: props.streamId,
			text: t.length > 0 ? t : undefined,
			fileIds: files.value.length > 0 ? files.value.map(f => f.id) : undefined,
		});
		text.value = '';
		files.value = [];
	} catch (err) {
		os.alert({ type: 'error', text: err instanceof Error ? err.message : String(err) });
	} finally {
		sending.value = false;
	}
}

onMounted(() => {
	fetchInitial();
	if (textareaEl.value != null) {
		autocompleteInstance = new Autocomplete(textareaEl.value, text);
	}
	connection = stream.useChannel('twitchLiveStream', { streamId: props.streamId });
	connection.on('comment', onComment);
	connection.on('streamEnded', () => emit('streamEnded'));
});

onBeforeUnmount(() => {
	if (autocompleteInstance != null) {
		autocompleteInstance.detach();
		autocompleteInstance = null;
	}
});

onUnmounted(() => {
	if (connection != null) connection.dispose();
});
</script>

<style lang="scss" module>
.root {
	display: flex;
	flex-direction: column;
	height: 100%;
	min-height: 0;
	background: var(--MI_THEME-panel);
	border-radius: var(--MI-radius);
	overflow: clip;
}

.list {
	flex: 1;
	min-height: 0;
	overflow-y: auto;
	padding: 12px;
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.loadOlder {
	padding: 6px;
	text-align: center;
	color: var(--MI_THEME-accent);
}

.comment {
	display: flex;
	gap: 8px;
	align-items: flex-start;
	font-size: 0.92em;
}

.avatar {
	flex-shrink: 0;
	width: 24px;
	height: 24px;
}

.twitchIcon {
	flex-shrink: 0;
	width: 24px;
	text-align: center;
	color: #9146ff; // Twitch ブランドカラー
}

.commentBody {
	min-width: 0;
	overflow-wrap: anywhere;
}

.commentName {
	font-weight: bold;
	margin-right: 6px;
	opacity: 0.9;
}

.commentTime {
	font-size: 0.85em;
	opacity: 0.6;
}

.commentText {
	white-space: pre-wrap;
}

.commentFiles {
	margin-top: 4px;
	max-width: 260px;
}

.empty {
	opacity: 0.6;
	text-align: center;
	padding: 24px 0;
}

.form {
	padding: 10px;
	border-top: solid 0.5px var(--MI_THEME-divider);
}

.attaches {
	display: flex;
	flex-wrap: wrap;
	gap: 4px;
	margin-bottom: 6px;
}

.attach {
	max-width: 100%;
	padding: 4px 8px;
	font-size: 0.85em;
	border: solid 1px var(--MI_THEME-divider);
	border-radius: var(--MI-radius);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;

	&:hover {
		color: var(--MI_THEME-accent);
	}
}

.inputRow {
	display: flex;
	gap: 4px;
	align-items: flex-end;
}

.textarea {
	flex: 1;
	min-width: 0;
	padding: 8px 12px;
	margin: 0;
	resize: none;
	font-size: 1em;
	font-family: inherit;
	field-sizing: content;
	max-height: 6em;
	border: solid 1px var(--MI_THEME-divider);
	border-radius: var(--MI-radius);
	background: var(--MI_THEME-bg);
	color: var(--MI_THEME-fg);
	outline: none;
	box-sizing: border-box;

	&:focus {
		border-color: var(--MI_THEME-accent);
	}
}

.formButton {
	flex-shrink: 0;
	width: 36px;
	height: 36px;

	&:hover {
		color: var(--MI_THEME-accent);
	}

	&:disabled {
		opacity: 0.5;
	}
}

.sendButton {
	color: var(--MI_THEME-accent);
}
</style>
