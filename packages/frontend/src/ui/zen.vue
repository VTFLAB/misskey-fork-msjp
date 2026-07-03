<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div>
	<div :class="$style.contents">
		<!--
			デッキUIが設定されている場合はデッキUIに戻れるようにする (ただし?zenが明示された場合は表示しない)
			See https://github.com/misskey-dev/misskey/issues/10905
		-->
		<button v-if="showDeckNav" class="_buttonPrimary" :class="$style.deckNav" @click="goToDeck">{{ i18n.ts.goToDeck }}</button>

		<div style="flex: 1; min-height: 0;">
			<RouterView/>
		</div>
	</div>

	<XCommon/>
</div>
</template>

<script lang="ts" setup>
import { computed, provide, ref } from 'vue';
import { instanceName, ui } from '@@/js/config.js';
import XCommon from './_common_/common.vue';
import type { PageMetadata } from '@/page.js';
import { provideMetadataReceiver, provideReactiveMetadata } from '@/page.js';
import { i18n } from '@/i18n.js';
import { mainRouter } from '@/router.js';
import { DI } from '@/di.js';

const isRoot = computed(() => mainRouter.currentRoute.value.name === 'index');

const pageMetadata = ref<null | PageMetadata>(null);

// 現在のページが hideDeckNav を宣言している場合は非表示にする (bsky-fork 独自)。
// definePage 経由でリアクティブに更新されるため、クエリパラメータと違い
// SPA 内遷移でも正しく反映される
const showDeckNav = computed(() =>
	!(new URLSearchParams(window.location.search)).has('zen')
	&& ui === 'deck'
	&& !pageMetadata.value?.hideDeckNav,
);

// zen UI には universal.vue / deck.vue のようなモバイルフッターメニューが無いため、
// --MI-minBottomSpacing は :root のモバイル既定値のまま残ってしまう。
// フルスクリーン表示を前提にするページ (配信視聴ページ等) の高さ計算がずれるので
// ここで明示的に 0 にリセットする (bsky-fork 独自)
window.document.body.style.setProperty('--MI-minBottomSpacing', '0px');

provide(DI.router, mainRouter);
provideMetadataReceiver((metadataGetter) => {
	const info = metadataGetter();
	pageMetadata.value = info;
	if (pageMetadata.value) {
		if (isRoot.value && pageMetadata.value.title === instanceName) {
			window.document.title = pageMetadata.value.title;
		} else {
			window.document.title = `${pageMetadata.value.title} | ${instanceName}`;
		}
	}
});
provideReactiveMetadata(pageMetadata);

function goToDeck() {
	window.location.href = '/';
}
</script>

<style lang="scss" module>
.contents {
	display: flex;
	flex-direction: column;
	height: 100dvh;
}

.deckNav {
	padding: 4px;
}

.button {
	padding: 0;
	aspect-ratio: 1;
	width: 100%;
	max-width: 60px;
	margin: auto;
	border-radius: 100%;
	background: var(--MI_THEME-panel);
	color: var(--MI_THEME-fg);
	right: var(--MI-margin);
	bottom: calc(var(--MI-margin) + env(safe-area-inset-bottom, 0px));
}
</style>
