<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkContainer :showHeader="widgetProps.showHeader" data-cy-mkw-weather class="mkw-weather">
	<template #icon><i :class="icon"></i></template>
	<template #header>{{ widgetProps.locationName || i18n.ts._widgets.weather }}</template>
	<template #func="{ buttonStyleClass }"><button class="_button" :class="buttonStyleClass" @click="configure"><i class="ti ti-settings"></i></button></template>

	<div :class="$style.root">
		<MkLoading v-if="fetching"/>
		<MkResult v-else-if="error" type="error"/>
		<div v-else :class="$style.body">
			<div :class="$style.hero">
				<i :class="[icon, $style.icon, { [$style.night]: !isDay }]"></i>
				<div :class="$style.main">
					<span :class="$style.temperature">{{ Math.round(temperature ?? 0) }}<span :class="$style.deg">°</span></span>
					<span :class="$style.condition">{{ conditionText }}</span>
				</div>
			</div>
			<div v-if="feelsLike != null || humidity != null || windSpeed != null" :class="$style.stats">
				<span v-if="feelsLike != null" :class="$style.stat">
					<i class="ti ti-temperature" :class="$style.statIcon" aria-hidden="true"></i>{{ i18n.ts._widgetOptions._weather.feelsLike }} {{ Math.round(feelsLike) }}°
				</span>
				<span v-if="humidity != null" :class="$style.stat">
					<i class="ti ti-droplet" :class="$style.statIcon" aria-hidden="true"></i><span :class="$style.srOnly">{{ i18n.ts._widgetOptions._weather.humidity }}</span> {{ Math.round(humidity) }}%
				</span>
				<span v-if="windSpeed != null" :class="$style.stat">
					<i class="ti ti-wind" :class="$style.statIcon" aria-hidden="true"></i><span :class="$style.srOnly">{{ i18n.ts._widgetOptions._weather.windSpeed }}</span> {{ Math.round(windSpeed) }}km/h
				</span>
			</div>
			<div v-if="tempMax != null || tempMin != null || precipitationProbability != null" :class="$style.today">
				<span v-if="tempMax != null" :class="$style.todayItem" :title="i18n.ts._widgetOptions._weather.todayHigh">
					<i class="ti ti-arrow-up" :class="$style.todayIcon" aria-hidden="true"></i><span :class="$style.srOnly">{{ i18n.ts._widgetOptions._weather.todayHigh }}</span> {{ Math.round(tempMax) }}°
				</span>
				<span v-if="tempMin != null" :class="$style.todayItem" :title="i18n.ts._widgetOptions._weather.todayLow">
					<i class="ti ti-arrow-down" :class="$style.todayIcon" aria-hidden="true"></i><span :class="$style.srOnly">{{ i18n.ts._widgetOptions._weather.todayLow }}</span> {{ Math.round(tempMin) }}°
				</span>
				<span v-if="precipitationProbability != null" :class="$style.todayItem" :title="i18n.ts._widgetOptions._weather.precipitationProbability">
					<i class="ti ti-umbrella" :class="$style.todayIcon" aria-hidden="true"></i><span :class="$style.srOnly">{{ i18n.ts._widgetOptions._weather.precipitationProbability }}</span> {{ Math.round(precipitationProbability) }}%
				</span>
			</div>
		</div>
	</div>
</MkContainer>
</template>

<script lang="ts" setup>
import { ref, computed, watch } from 'vue';
import { useInterval } from '@@/js/use-interval.js';
import { useWidgetPropsManager } from './widget.js';
import type { WidgetComponentEmits, WidgetComponentExpose, WidgetComponentProps } from './widget.js';
import type { FormWithDefault, GetFormResultType } from '@/utility/form.js';
import { i18n } from '@/i18n.js';
import { misskeyApiGet } from '@/utility/misskey-api.js';
import MkContainer from '@/components/MkContainer.vue';

const name = 'weather';

// 東京 (皇居) を初期値とする
const widgetPropsDef = {
	locationName: {
		type: 'string',
		label: i18n.ts._widgetOptions._weather.locationName,
		default: '東京',
		manualSave: true,
	},
	latitude: {
		type: 'number',
		label: i18n.ts._widgetOptions._weather.latitude,
		default: 35.6895,
		manualSave: true,
	},
	longitude: {
		type: 'number',
		label: i18n.ts._widgetOptions._weather.longitude,
		default: 139.6917,
		manualSave: true,
	},
	refreshIntervalSec: {
		type: 'number',
		label: i18n.ts._widgetOptions._weather.refreshIntervalSec,
		default: 600,
	},
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

// WMO Weather interpretation codes (https://open-meteo.com/en/docs) を大まかな区分にまとめる
const WEATHER_CODE_MAP: Partial<Record<number, { icon: string; textKey: keyof typeof i18n.ts._widgetOptions._weather._conditions }>> = {
	0: { icon: 'ti-sun', textKey: 'clear' },
	1: { icon: 'ti-sun-high', textKey: 'mainlyClear' },
	2: { icon: 'ti-sun-high', textKey: 'partlyCloudy' },
	3: { icon: 'ti-cloud', textKey: 'cloudy' },
	45: { icon: 'ti-cloud-fog', textKey: 'fog' },
	48: { icon: 'ti-cloud-fog', textKey: 'fog' },
	51: { icon: 'ti-cloud-rain', textKey: 'drizzle' },
	53: { icon: 'ti-cloud-rain', textKey: 'drizzle' },
	55: { icon: 'ti-cloud-rain', textKey: 'drizzle' },
	56: { icon: 'ti-cloud-rain', textKey: 'drizzle' },
	57: { icon: 'ti-cloud-rain', textKey: 'drizzle' },
	61: { icon: 'ti-cloud-rain', textKey: 'rain' },
	63: { icon: 'ti-cloud-rain', textKey: 'rain' },
	65: { icon: 'ti-cloud-rain', textKey: 'rain' },
	66: { icon: 'ti-cloud-rain', textKey: 'rain' },
	67: { icon: 'ti-cloud-rain', textKey: 'rain' },
	71: { icon: 'ti-snowflake', textKey: 'snow' },
	73: { icon: 'ti-snowflake', textKey: 'snow' },
	75: { icon: 'ti-snowflake', textKey: 'snow' },
	77: { icon: 'ti-snowflake', textKey: 'snow' },
	80: { icon: 'ti-cloud-rain', textKey: 'rainShowers' },
	81: { icon: 'ti-cloud-rain', textKey: 'rainShowers' },
	82: { icon: 'ti-cloud-rain', textKey: 'rainShowers' },
	85: { icon: 'ti-snowflake', textKey: 'snowShowers' },
	86: { icon: 'ti-snowflake', textKey: 'snowShowers' },
	95: { icon: 'ti-cloud-storm', textKey: 'thunderstorm' },
	96: { icon: 'ti-cloud-storm', textKey: 'thunderstorm' },
	99: { icon: 'ti-cloud-storm', textKey: 'thunderstorm' },
};

const fetching = ref(true);
const error = ref(false);
const temperature = ref<number | null>(null);
const humidity = ref<number | null>(null);
const windSpeed = ref<number | null>(null);
const feelsLike = ref<number | null>(null);
const weatherCode = ref<number | null>(null);
const isDay = ref(true);
const tempMax = ref<number | null>(null);
const tempMin = ref<number | null>(null);
const precipitationProbability = ref<number | null>(null);

const icon = computed(() => {
	const base = weatherCode.value != null ? WEATHER_CODE_MAP[weatherCode.value]?.icon ?? 'ti-cloud-question' : 'ti-cloud-question';
	const isSunLike = base === 'ti-sun' || base === 'ti-sun-high';
	return `ti ${!isDay.value && isSunLike ? 'ti-moon' : base}`;
});

const conditionText = computed(() => {
	if (weatherCode.value == null) return i18n.ts._widgetOptions._weather._conditions.unknown;
	const entry = WEATHER_CODE_MAP[weatherCode.value];
	return entry ? i18n.ts._widgetOptions._weather._conditions[entry.textKey] : i18n.ts._widgetOptions._weather._conditions.unknown;
});

const tick = () => {
	if (window.document.visibilityState === 'hidden' && temperature.value != null) return;

	fetching.value = temperature.value == null;
	misskeyApiGet('get-weather', {
		latitude: widgetProps.latitude,
		longitude: widgetProps.longitude,
	}).then(res => {
		temperature.value = res.temperature;
		humidity.value = res.humidity ?? null;
		windSpeed.value = res.windSpeed ?? null;
		feelsLike.value = res.feelsLike ?? null;
		weatherCode.value = res.weatherCode;
		isDay.value = res.isDay;
		tempMax.value = res.tempMax ?? null;
		tempMin.value = res.tempMin ?? null;
		precipitationProbability.value = res.precipitationProbability ?? null;
		error.value = false;
		fetching.value = false;
	}).catch(() => {
		error.value = true;
		fetching.value = false;
	});
};

watch(() => [widgetProps.latitude, widgetProps.longitude], tick);

const intervalClear = ref<(() => void) | undefined>();

watch(() => widgetProps.refreshIntervalSec, () => {
	if (intervalClear.value) {
		intervalClear.value();
	}
	intervalClear.value = useInterval(tick, Math.max(60000, widgetProps.refreshIntervalSec * 1000), {
		immediate: true,
		afterMounted: true,
	});
}, { immediate: true });

defineExpose<WidgetComponentExpose>({
	name,
	configure,
	id: props.widget ? props.widget.id : null,
});
</script>

<style lang="scss" module>
.root {
	padding: 12px 16px;
}

.body {
	display: flex;
	flex-direction: column;
	gap: 10px;
}

.srOnly {
	position: absolute;
	width: 1px;
	height: 1px;
	padding: 0;
	margin: -1px;
	overflow: hidden;
	clip: rect(0, 0, 0, 0);
	white-space: nowrap;
	border: 0;
}

.hero {
	display: flex;
	align-items: center;
	gap: 12px;
}

.icon {
	font-size: 2.8em;
	color: var(--MI_THEME-accent);

	&.night {
		opacity: 0.8;
	}
}

.main {
	display: flex;
	flex-direction: column;
	min-width: 0;
}

.temperature {
	font-size: 2em;
	font-weight: bold;
	line-height: 1.2;
}

.deg {
	font-size: 0.6em;
	font-weight: 500;
	opacity: 0.75;
}

.condition {
	font-size: 0.9em;
	opacity: 0.75;
}

.stats {
	display: flex;
	flex-wrap: wrap;
	gap: 4px 14px;
	font-size: 0.85em;
	opacity: 0.8;
	border-top: solid 0.5px var(--MI_THEME-divider);
	padding-top: 8px;
}

.stat {
	display: flex;
	align-items: center;
	gap: 4px;
}

.statIcon {
	color: var(--MI_THEME-accent);
}

.today {
	display: flex;
	gap: 14px;
	font-size: 0.85em;
	opacity: 0.8;
}

.todayItem {
	display: flex;
	align-items: center;
	gap: 4px;
}

.todayIcon {
	color: var(--MI_THEME-accent);
}
</style>
