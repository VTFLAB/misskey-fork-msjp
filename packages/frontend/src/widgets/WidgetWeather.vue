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
			<i :class="[icon, $style.icon]"></i>
			<div :class="$style.main">
				<span :class="$style.temperature">{{ Math.round(temperature ?? 0) }}°C</span>
				<span :class="$style.condition">{{ conditionText }}</span>
			</div>
			<div v-if="humidity != null || windSpeed != null" :class="$style.sub">
				<span v-if="humidity != null">{{ i18n.ts._widgetOptions._weather.humidity }}: {{ Math.round(humidity) }}%</span>
				<span v-if="windSpeed != null">{{ i18n.ts._widgetOptions._weather.windSpeed }}: {{ Math.round(windSpeed) }}km/h</span>
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
	1: { icon: 'ti-cloud-sun', textKey: 'mainlyClear' },
	2: { icon: 'ti-cloud-sun', textKey: 'partlyCloudy' },
	3: { icon: 'ti-cloud', textKey: 'cloudy' },
	45: { icon: 'ti-cloud-fog', textKey: 'fog' },
	48: { icon: 'ti-cloud-fog', textKey: 'fog' },
	51: { icon: 'ti-cloud-drizzle', textKey: 'drizzle' },
	53: { icon: 'ti-cloud-drizzle', textKey: 'drizzle' },
	55: { icon: 'ti-cloud-drizzle', textKey: 'drizzle' },
	56: { icon: 'ti-cloud-drizzle', textKey: 'drizzle' },
	57: { icon: 'ti-cloud-drizzle', textKey: 'drizzle' },
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
const weatherCode = ref<number | null>(null);
const isDay = ref(true);

const icon = computed(() => {
	const base = weatherCode.value != null ? WEATHER_CODE_MAP[weatherCode.value]?.icon ?? 'ti-cloud-question' : 'ti-cloud-question';
	return `ti ${!isDay.value && base === 'ti-sun' ? 'ti-moon' : base}`;
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
		weatherCode.value = res.weatherCode;
		isDay.value = res.isDay;
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
	align-items: center;
	gap: 12px;
}

.icon {
	font-size: 2.2em;
	color: var(--MI_THEME-accent);
}

.main {
	display: flex;
	flex-direction: column;
}

.temperature {
	font-size: 1.6em;
	font-weight: bold;
	line-height: 1.2;
}

.condition {
	font-size: 0.85em;
	opacity: 0.75;
}

.sub {
	display: flex;
	gap: 12px;
	margin-top: 8px;
	font-size: 0.8em;
	opacity: 0.75;
}
</style>
