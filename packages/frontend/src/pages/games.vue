<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader>
	<div class="_spacer" style="--MI_SPACER-w: 800px;">
		<div class="_gaps">
			<div class="_panel" :class="$style.link">
				<MkA to="/bubble-game">
					<img src="/client-assets/drop-and-fusion/logo.png" style="display: block; max-width: 100%; max-height: 200px; margin: auto;"/>
				</MkA>
			</div>
			<div class="_panel" :class="$style.link">
				<MkA to="/reversi">
					<img src="/client-assets/reversi/logo.png" style="display: block; max-width: 100%; max-height: 200px; margin: auto;"/>
				</MkA>
			</div>
			<div class="_panel" :class="$style.link">
				<MkA to="/craft" :class="$style.craft">
					<i class="ti ti-cube" :class="$style.craftIcon"></i>
					<div :class="$style.craftTitle">{{ i18n.ts._craft.craft }}</div>
					<div :class="$style.craftDescription">{{ i18n.ts._craft.description }}</div>
				</MkA>
			</div>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';

definePage(() => ({
	title: 'Misskey Games',
	icon: 'ti ti-device-gamepad',
}));
</script>

<style module>
.link:focus-within {
	outline: 2px solid var(--MI_THEME-focus);
	outline-offset: -2px;
}

.craft {
	display: block;
	padding: 32px 24px;
	text-align: center;
	text-decoration: none;
	/* 草ブロックと水の色 (テーマに依存しないブランド色) */
	background: linear-gradient(160deg, #6cae3e 0%, #3b6fd8 100%);
	color: #fff;
}

.craftIcon {
	font-size: 48px;
}

.craftTitle {
	margin-top: 8px;
	font-size: 1.4em;
	font-weight: bold;
}

.craftDescription {
	margin-top: 4px;
	font-size: 0.9em;
	opacity: 0.9;
}
</style>
