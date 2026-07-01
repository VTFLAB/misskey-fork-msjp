<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkContainer :showHeader="widgetProps.showHeader" data-cy-mkw-earthquakeHistory class="mkw-earthquakeHistory">
	<template #icon><i class="ti ti-analyze"></i></template>
	<template #header>{{ i18n.ts._widgets.earthquakeHistory }}</template>

	<div :class="$style.root">
		<MkLoading v-if="fetching"/>
		<MkResult v-else-if="alerts.length === 0" type="empty"/>
		<div v-else :class="$style.list">
			<div v-for="alert in alerts" :key="`${alert.EventID}-${alert.Serial}`" :class="$style.item">
				<div :class="$style.badges">
					<span :class="[$style.badge, alert.isWarn ? $style.badgeWarn : $style.badgeForecast]">{{ alert.isWarn ? i18n.ts._widgetOptions._earthquakeHistory.warn : i18n.ts._widgetOptions._earthquakeHistory.forecast }}</span>
					<span v-if="alert.isCancel" :class="[$style.badge, $style.badgeCancel]">{{ i18n.ts._widgetOptions._earthquakeHistory.cancel }}</span>
					<span v-if="alert.isFinal" :class="[$style.badge, $style.badgeFinal]">{{ i18n.ts._widgetOptions._earthquakeHistory.final }}</span>
				</div>
				<div :class="$style.main">{{ alert.Hypocenter }} M{{ alert.Magunitude }}</div>
				<div :class="$style.sub">{{ i18n.ts._widgetOptions._earthquakeHistory.maxIntensity }} {{ alert.MaxIntensity }} ・ {{ alert.OriginTime }}</div>
			</div>
		</div>
	</div>
</MkContainer>
</template>

<script lang="ts" setup>
import { ref } from 'vue';
import { useInterval } from '@@/js/use-interval.js';
import { useWidgetPropsManager } from './widget.js';
import type { WidgetComponentEmits, WidgetComponentExpose, WidgetComponentProps } from './widget.js';
import type { FormWithDefault, GetFormResultType } from '@/utility/form.js';
import { i18n } from '@/i18n.js';
import { misskeyApiGet } from '@/utility/misskey-api.js';
import MkContainer from '@/components/MkContainer.vue';

const name = 'earthquakeHistory';

const widgetPropsDef = {
	showHeader: {
		type: 'boolean',
		label: i18n.ts._widgetOptions.showHeader,
		default: true,
	},
} satisfies FormWithDefault;

type WidgetProps = GetFormResultType<typeof widgetPropsDef>;

const props = defineProps<WidgetComponentProps<WidgetProps>>();
const emit = defineEmits<WidgetComponentEmits<WidgetProps>>();

const { widgetProps, configure } = useWidgetPropsManager(name,
	widgetPropsDef,
	props,
	emit,
);

const fetching = ref(true);
const alerts = ref<Awaited<ReturnType<typeof fetchHistory>>>([]);

function fetchHistory() {
	return misskeyApiGet('earthquake/history', {}).then(res => res.alerts);
}

const tick = () => {
	fetchHistory().then(res => {
		alerts.value = res;
		fetching.value = false;
	}).catch(() => {
		fetching.value = false;
	});
};

useInterval(tick, 60000, {
	immediate: true,
	afterMounted: true,
});

defineExpose<WidgetComponentExpose>({
	name,
	configure,
	id: props.widget ? props.widget.id : null,
});
</script>

<style lang="scss" module>
.root {
	padding: 8px 0;
}

.list {
	display: flex;
	flex-direction: column;
}

.item {
	padding: 8px 16px;

	&:nth-child(even) {
		background: rgba(#000, 0.05);
	}
}

.badges {
	display: flex;
	gap: 4px;
	margin-bottom: 2px;
}

.badge {
	display: inline-block;
	padding: 1px 6px;
	border-radius: var(--MI-radius-sm, 4px);
	font-size: 0.75em;
	font-weight: bold;
}

.badgeWarn {
	background: var(--MI_THEME-error);
	color: var(--MI_THEME-fgOnAccent);
}

.badgeForecast {
	background: var(--MI_THEME-buttonBg);
	color: var(--MI_THEME-fg);
}

.badgeCancel {
	background: var(--MI_THEME-buttonBg);
	color: var(--MI_THEME-fg);
	opacity: 0.7;
}

.badgeFinal {
	background: var(--MI_THEME-accent);
	color: var(--MI_THEME-fgOnAccent);
}

.main {
	font-weight: bold;
}

.sub {
	font-size: 0.85em;
	opacity: 0.75;
}
</style>
