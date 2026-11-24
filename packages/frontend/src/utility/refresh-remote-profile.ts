/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { onMounted, onUnmounted } from 'vue';
import type { IPaginator } from '@/utility/paginator.js';
import { $i } from '@/i.js';

/** Pick up a slow outbox import without making an empty profile require a reload. */
export function refreshRemoteProfile(host: string | null, paginator: IPaginator): void {
	let timer: number | undefined;
	onMounted(() => {
		if (!host || !$i) return;
		let attempts = 0;
		timer = window.setInterval(() => {
			if (++attempts > 12 || paginator.items.value.length > 0) {
				window.clearInterval(timer);
				return;
			}
			if (!paginator.fetching.value) void paginator.reload().catch(() => {});
		}, 5000);
	});
	onUnmounted(() => window.clearInterval(timer));
}
