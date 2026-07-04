<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.root">
	<div ref="listEl" :class="$style.list" @scroll.passive="onListScroll">
		<button v-if="hasOlder" class="_button" :class="$style.loadOlder" :disabled="loadingOlder" @click="loadOlder">
			{{ i18n.ts.loadMore }}
		</button>
		<template v-if="canParticipate">
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
				<template v-else-if="comment.source === 'remote-guest'">
					<img v-if="comment.remoteGuest?.avatarUrl" :src="comment.remoteGuest.avatarUrl" :class="$style.remoteGuestAvatar" alt=""/>
					<i v-else class="ti ti-user" :class="$style.remoteGuestIcon"></i>
					<div :class="$style.commentBody">
						<div>
							<span :class="$style.commentName">{{ comment.remoteGuest != null ? `${comment.remoteGuest.username}@${comment.remoteGuest.host}` : '?' }}</span>
							<time :class="$style.commentTime" :title="formatTimeFull(comment.createdAt)">{{ formatTime(comment.createdAt) }}</time>
						</div>
						<Mfm v-if="comment.text" :class="$style.commentText" :text="comment.text"/>
					</div>
				</template>
				<template v-else>
					<i class="ti ti-brand-twitch" :class="$style.twitchIcon"></i>
					<div :class="$style.commentBody">
						<div>
							<span :class="$style.commentName">{{ comment.twitchDisplayName ?? comment.twitchUserName ?? '?' }}</span>
							<time :class="$style.commentTime" :title="formatTimeFull(comment.createdAt)">{{ formatTime(comment.createdAt) }}</time>
						</div>
						<span :class="$style.commentText">
							<template v-for="(frag, fi) in twitchFragments(comment)" :key="fi">
								<img v-if="frag.type === 'emote'" :src="twitchEmoteUrl(frag.emoteId, frag.animated)" :alt="frag.text" :title="frag.text" :class="$style.twitchEmote"/>
								<template v-else>{{ frag.text }}</template>
							</template>
						</span>
					</div>
				</template>
			</div>
			<div v-if="comments.length === 0 && !fetching" :class="$style.empty">{{ i18n.ts._twitch.noComments }}</div>
		</template>
	</div>
	<button v-if="canParticipate && newCommentsCount > 0" class="_buttonPrimary" :class="$style.newComments" @click="jumpToLatest">
		<i class="ti ti-arrow-down"></i> {{ i18n.ts._twitch.newComments }}
	</button>
	<XRemoteGuestLogin v-if="!canParticipate && live" :returnTo="returnTo"/>
	<div
		v-else-if="canParticipate && live"
		:class="$style.form"
		@dragover.stop="onDragover"
		@drop.stop="onDrop"
	>
		<div v-if="$i != null && files.length > 0" :class="$style.attaches">
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
			<button v-if="$i != null" class="_button" :class="$style.formButton" :title="i18n.ts.attachFile" :aria-label="i18n.ts.attachFile" @click="chooseFile"><i class="ti ti-photo-plus"></i></button>
			<button class="_button" :class="$style.formButton" :title="i18n.ts.emoji" :aria-label="i18n.ts.emoji" @click="insertEmoji"><i class="ti ti-mood-happy"></i></button>
			<button v-tooltip="i18n.ts._mfmToolbar.show" class="_button" :class="[$style.formButton, { [$style.formButtonActive]: showMfmToolbar }]" :aria-label="i18n.ts._mfmToolbar.show" @click="showMfmToolbar = !showMfmToolbar"><i class="ti ti-wand"></i></button>
			<button class="_button" :class="[$style.formButton, $style.sendButton]" :disabled="sending || !canSend" :title="i18n.ts.send" :aria-label="i18n.ts.send" @click="send">
				<template v-if="!sending"><i class="ti ti-send"></i></template><template v-else><MkLoading :em="true"/></template>
			</button>
		</div>
		<MkMfmToolbar v-if="showMfmToolbar" v-model:show="showMfmToolbar" v-model:text="text" :textareaEl="textareaEl" @changed="onMfmToolbarChanged"/>
	</div>
</div>
</template>

<script lang="ts" setup>
import { ref, computed, watch, useTemplateRef, onMounted, onBeforeUnmount, onUnmounted, nextTick } from 'vue';
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
import MkMfmToolbar from '@/components/MkMfmToolbar.vue';
import XRemoteGuestLogin from '@/pages/live-stream.remote-guest-login.vue';
import { prefer } from '@/preferences.js';
import { remoteGuestSession } from '@/composables/use-remote-guest-session.js';

type Comment = Misskey.Endpoints['twitch/streams/comments']['res'][number];

const MAX_FILES = 16;

const props = defineProps<{
	streamId: string;
	live: boolean;
	returnTo: string;
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
// ノートエディタ (MkPostForm) と表示状態を共有する
const showMfmToolbar = ref(prefer.s.showMfmToolbar);
watch(showMfmToolbar, () => prefer.commit('showMfmToolbar', showMfmToolbar.value));
const listEl = useTemplateRef('listEl');
const textareaEl = useTemplateRef('textareaEl');
let autocompleteInstance: Autocomplete | null = null;

const canSend = computed(() => text.value.trim().length > 0 || files.value.length > 0);

// ローカルログイン中、またはリモートゲストログイン中のみ視聴+コメントに参加できる。
// どちらでもない場合はコメント履歴を取得できないため、ログイン導線のみ表示する
const guestToken = computed(() => remoteGuestSession.value?.token ?? null);
const canParticipate = computed(() => $i != null || guestToken.value != null);

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

type TwitchFragment = NonNullable<Comment['fragments']>[number];

// fragments が取得できていない (旧データ・パース失敗等) 場合は全文を text 扱いにフォールバックする
function twitchFragments(comment: Comment): TwitchFragment[] {
	return comment.fragments ?? [{ type: 'text', text: comment.text }];
}

// Twitch の絵文字画像 CDN (公開・認証不要)。animated (GIF、無限ループで提供される) は
// EventSub の emote.format に 'animated' が含まれる場合のみ選べる (静止画は全絵文字が必ず持つ)。
// カスタム絵文字と同様、アニメーション画像を無効化する設定が有効な間は静止画にフォールバックする
function twitchEmoteUrl(emoteId: string | undefined, animated: boolean | undefined): string {
	if (emoteId == null) return '';
	const format = animated && !prefer.s.disableShowingAnimatedImages ? 'animated' : 'static';
	return `https://static-cdn.jtvnw.net/emoticons/v2/${encodeURIComponent(emoteId)}/${format}/dark/2.0`;
}

// Twitch/YouTube 等のライブチャットと同じ挙動: 最下部付近にいる間だけ新着で
// 追従スクロールする。任意の位置まで上にスクロールしている間は自動スクロールを
// 止め、代わりに「新着コメント」ボタンを表示する (最下部へ戻ると自動的に解除)
const autoScroll = ref(true);
const newCommentsCount = ref(0);

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

function onListScroll() {
	const nearBottom = isNearBottom();
	autoScroll.value = nearBottom;
	if (nearBottom) newCommentsCount.value = 0;
}

function jumpToLatest() {
	autoScroll.value = true;
	newCommentsCount.value = 0;
	scrollToBottom();
}

async function fetchComments(untilId?: string): Promise<Comment[]> {
	if ($i != null) {
		return await misskeyApi('twitch/streams/comments', {
			streamId: props.streamId,
			limit: 30,
			untilId,
		});
	}
	// canParticipate.value が true の時点で guestToken.value は非null
	return await misskeyApi('remote-guest/twitch-comments', {
		guestToken: guestToken.value!,
		streamId: props.streamId,
		limit: 30,
		untilId,
	});
}

async function fetchInitial() {
	if (!canParticipate.value) {
		fetching.value = false;
		return;
	}
	try {
		const res = await fetchComments();
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
		const res = await fetchComments(comments.value[0].id);
		comments.value = [...res.reverse(), ...comments.value];
		hasOlder.value = res.length >= 30;
	} finally {
		loadingOlder.value = false;
	}
}

function onComment(comment: Comment) {
	if (comments.value.some(c => c.id === comment.id)) return;
	comments.value.push(comment);
	// メモリ節約: 表示は直近 300 件に制限 (履歴はさかのぼり読み込みで参照可能)
	if (comments.value.length > 300) {
		comments.value = comments.value.slice(-300);
		hasOlder.value = true;
	}
	if (autoScroll.value) {
		scrollToBottom();
	} else {
		// 過去コメントを閲覧中に新着が来てもスクロール位置は動かさない。
		// 件数だけ増やして「新着コメント」ボタンに反映する
		newCommentsCount.value++;
	}
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

function onMfmToolbarChanged() {
	nextTick(() => {
		textareaEl.value?.focus();
	});
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
		if ($i != null) {
			await misskeyApi('twitch/streams/comments/create', {
				streamId: props.streamId,
				text: t.length > 0 ? t : undefined,
				fileIds: files.value.length > 0 ? files.value.map(f => f.id) : undefined,
			});
		} else {
			// canParticipate.value が true の時点で guestToken.value は非null。添付ファイルは非対応
			await misskeyApi('remote-guest/twitch-comments/create', {
				guestToken: guestToken.value!,
				streamId: props.streamId,
				text: t,
			});
		}
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
	if (canParticipate.value) {
		connection = stream.useChannel('twitchLiveStream', { streamId: props.streamId, guestToken: guestToken.value ?? undefined });
		connection.on('comment', onComment);
		connection.on('streamEnded', () => emit('streamEnded'));
	}
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

.remoteGuestIcon {
	flex-shrink: 0;
	width: 24px;
	text-align: center;
	color: var(--MI_THEME-accent);
}

.remoteGuestAvatar {
	flex-shrink: 0;
	width: 24px;
	height: 24px;
	border-radius: 100%;
	object-fit: cover;
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

.twitchEmote {
	height: 1.6em;
	vertical-align: middle;
	margin: -2px 3px;
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

.newComments {
	flex-shrink: 0;
	align-self: center;
	margin: 6px 0;
	padding: 6px 14px;
	border-radius: 999px;
	font-size: 0.85em;
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

.formButtonActive {
	color: var(--MI_THEME-accent);
}

.sendButton {
	color: var(--MI_THEME-accent);
}
</style>
