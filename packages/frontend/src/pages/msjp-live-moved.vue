<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!-- bsky-fork: every old streaming route lands here and is sent on to MSJP Live (2026-10-02). -->
<template>
<div class="_spacer" style="--MI_SPACER-w: 600px;">
	<div class="_gaps" :class="$style.root">
		<p>{{ i18n.ts._liveChannel.movedToMsjpLive }}</p>
		<a :href="target" rel="noopener" :class="$style.link">{{ i18n.ts._liveChannel.openMsjpLive }}</a>
	</div>
</div>
</template>

<script lang="ts" setup>
import { onMounted } from 'vue';
import { host } from '@@/js/config.js';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import { msjpLiveUrl } from '@/utility/msjp-live-url.js';
import { useRouter } from '@/router.js';

// The router's path, not window.location: on in-app navigation the address bar may not be updated yet.
const router = useRouter();
const target = msjpLiveUrl(router.getCurrentFullPath(), host);

onMounted(() => {
	window.location.replace(target);
});

definePage(() => ({
	title: i18n.ts._liveChannel.liveChannels,
	icon: 'ti ti-broadcast',
}));
</script>

<style lang="scss" module>
.root {
	text-align: center;
	padding: 32px 0;
}

.link {
	color: var(--MI_THEME-link);
}
</style>
