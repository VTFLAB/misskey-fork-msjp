<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkModal
	ref="modal"
	v-slot="{ type, maxHeight }"
	:zPriority="'middle'"
	:preferType="prefer.s.emojiPickerStyle"
	:hasInteractionWithOtherFocusTrappedEls="true"
	:transparentBg="true"
	:manualShowing="manualShowing"
	:anchorElement="anchorElement"
	@click="modal?.close()"
	@esc="modal?.close()"
	@opening="opening"
	@close="onClose"
	@closed="emit('closed')"
>
	<MkEmojiPicker
		ref="picker"
		class="_popup _shadow"
		:class="{ [$style.drawer]: type === 'drawer' }"
		:showPinned="showPinned"
		:pinnedEmojis="pinnedEmojis"
		:asReactionPicker="asReactionPicker"
		:targetNote="targetNote"
		:asDrawer="type === 'drawer'"
		:max-height="maxHeight"
		@chosen="chosen"
		@esc="modal?.close()"
	/>
</MkModal>
</template>

<script lang="ts" setup>
import * as Misskey from 'misskey-js';
import { ref, useTemplateRef, watch } from 'vue';
import MkModal from '@/components/MkModal.vue';
import MkEmojiPicker from '@/components/MkEmojiPicker.vue';
import { prefer } from '@/preferences.js';
import { useBackToClose } from '@/composables/use-back-to-close.js';

const props = withDefaults(defineProps<{
	manualShowing?: boolean | null;
	anchorElement?: HTMLElement | null;
	showPinned?: boolean;
	pinnedEmojis?: string[],
	asReactionPicker?: boolean;
	targetNote?: Misskey.entities.Note | null;
	choseAndClose?: boolean;
}>(), {
	manualShowing: null,
	showPinned: true,
	pinnedEmojis: undefined,
	asReactionPicker: false,
	choseAndClose: true,
});

const emit = defineEmits<{
	(ev: 'done', v: string): void;
	(ev: 'close'): void;
	(ev: 'closed'): void;
}>();

const modal = useTemplateRef('modal');
const picker = useTemplateRef('picker');

// 閉じ始めたら true (bsky-fork 独自)。Android の戻るボタン (ブラウザの戻る) でも閉じられるようにする。
// 投稿フォームの上に開いているときは、戻る操作でこちらだけを先に閉じる。
// リアクションピッカーは同じダイアログを manualShowing で出し入れするので、表示し直したら戻す
const closing = ref(false);

watch(() => props.manualShowing, (showing) => {
	if (showing === true) closing.value = false;
});

useBackToClose({
	hash: '#emoji-picker',
	isOpen: () => !closing.value && props.manualShowing !== false,
	onBack: () => modal.value?.close(),
});

function onClose() {
	closing.value = true;
	emit('close');
}

function chosen(emoji: string) {
	emit('done', emoji);
	if (props.choseAndClose) {
		modal.value?.close();
	}
}

function opening() {
	picker.value?.reset();
	picker.value?.focus();

	// 何故かちょっと待たないとフォーカスされない
	window.setTimeout(() => {
		picker.value?.focus();
	}, 10);
}
</script>

<style lang="scss" module>
.drawer {
	border-radius: 24px;
	border-bottom-right-radius: 0;
	border-bottom-left-radius: 0;
}
</style>
