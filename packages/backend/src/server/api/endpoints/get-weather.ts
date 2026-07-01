/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { HttpRequestService } from '@/core/HttpRequestService.js';

type OpenMeteoResponse = {
	current?: {
		time: string;
		temperature_2m: number;
		relative_humidity_2m?: number;
		apparent_temperature?: number;
		weather_code: number;
		wind_speed_10m?: number;
		is_day: number;
	};
	daily?: {
		temperature_2m_max?: number[];
		temperature_2m_min?: number[];
		precipitation_probability_max?: number[];
	};
};

export const meta = {
	tags: ['meta'],

	requireCredential: false,
	allowGet: true,
	cacheSec: 60 * 10,

	errors: {
		weatherApiError: {
			message: 'Failed to fetch weather data.',
			code: 'WEATHER_API_ERROR',
			id: 'd50dee95-eed4-4b86-9344-b6f9806268f1',
		},
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			time: {
				type: 'string',
				optional: false, nullable: false,
			},
			temperature: {
				type: 'number',
				optional: false, nullable: false,
			},
			humidity: {
				type: 'number',
				optional: true, nullable: true,
			},
			windSpeed: {
				type: 'number',
				optional: true, nullable: true,
			},
			feelsLike: {
				type: 'number',
				optional: true, nullable: true,
			},
			weatherCode: {
				type: 'number',
				optional: false, nullable: false,
			},
			isDay: {
				type: 'boolean',
				optional: false, nullable: false,
			},
			tempMax: {
				type: 'number',
				optional: true, nullable: true,
			},
			tempMin: {
				type: 'number',
				optional: true, nullable: true,
			},
			precipitationProbability: {
				type: 'number',
				optional: true, nullable: true,
			},
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		latitude: { type: 'number', minimum: -90, maximum: 90 },
		longitude: { type: 'number', minimum: -180, maximum: 180 },
	},
	required: ['latitude', 'longitude'],
} as const;

// Open-Meteo (https://open-meteo.com/) - 無料・APIキー不要の天気予報API。ドメイン固定なのでSSRF検証は不要だが、
// 外部fetchは慣例に倣い HttpRequestService 経由で行う (private IP接続禁止等のガードを共有するため)。
@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private httpRequestService: HttpRequestService,
	) {
		super(meta, paramDef, async (ps) => {
			const url = new URL('https://api.open-meteo.com/v1/forecast');
			url.searchParams.set('latitude', ps.latitude.toString());
			url.searchParams.set('longitude', ps.longitude.toString());
			url.searchParams.set('current', 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,is_day');
			url.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min,precipitation_probability_max');
			url.searchParams.set('forecast_days', '1');
			url.searchParams.set('timezone', 'auto');

			let json: OpenMeteoResponse;
			try {
				const res = await this.httpRequestService.send(url.toString(), {
					method: 'GET',
					headers: {
						Accept: 'application/json',
					},
					timeout: 5000,
				});
				json = await res.json() as OpenMeteoResponse;
			} catch {
				throw new ApiError(meta.errors.weatherApiError);
			}

			if (json.current == null) {
				throw new ApiError(meta.errors.weatherApiError);
			}

			return {
				time: json.current.time,
				temperature: json.current.temperature_2m,
				humidity: json.current.relative_humidity_2m ?? null,
				windSpeed: json.current.wind_speed_10m ?? null,
				feelsLike: json.current.apparent_temperature ?? null,
				weatherCode: json.current.weather_code,
				isDay: json.current.is_day === 1,
				tempMax: json.daily?.temperature_2m_max?.[0] ?? null,
				tempMin: json.daily?.temperature_2m_min?.[0] ?? null,
				precipitationProbability: json.daily?.precipitation_probability_max?.[0] ?? null,
			};
		});
	}
}
