<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkModal
	ref="modal"
	:preferType="'dialog'"
	@click="onBgClick()"
	@closed="onModalClosed()"
	@esc="onEsc"
>
	<MkPostForm
		ref="form"
		:class="$style.form"
		class="_popup"
		v-bind="props"
		autofocus
		freezeAfterPosted
		@posted="onPosted"
		@cancel="_close()"
		@esc="_close()"
	/>
</MkModal>
</template>

<script lang="ts" setup>
import { ref, useTemplateRef } from 'vue';
import type { PostFormProps } from '@/types/post-form.js';
import MkModal from '@/components/MkModal.vue';
import MkPostForm from '@/components/MkPostForm.vue';
import { useBackToClose } from '@/composables/use-back-to-close.js';

const props = withDefaults(defineProps<PostFormProps & {
	instant?: boolean;
	fixed?: boolean;
	autofocus?: boolean;
}>(), {
	initialLocalOnly: undefined,
});

const emit = defineEmits<{
	(ev: 'closed'): void;
}>();

const modal = useTemplateRef('modal');
const form = useTemplateRef('form');

// 閉じ始めたら true (bsky-fork 独自)。Android の戻るボタン (ブラウザの戻る) でも閉じられるようにする
const closing = ref(false);

useBackToClose({
	hash: '#post-form',
	isOpen: () => !closing.value,
	onBack: () => _close(),
});

function onPosted() {
	closing.value = true;
	modal.value?.close({
		useSendAnimation: true,
	});
}

async function _close() {
	const canClose = await form.value?.canClose();
	if (!canClose) return;
	form.value?.abortUploader();
	closing.value = true;
	modal.value?.close();
}

function onEsc() {
	_close();
}

function onBgClick() {
	_close();
}

function onModalClosed() {
	emit('closed');
}
</script>

<style lang="scss" module>
.form {
	width: 100%;
	max-width: 520px;
	margin: 0 auto auto auto;
}
</style>
