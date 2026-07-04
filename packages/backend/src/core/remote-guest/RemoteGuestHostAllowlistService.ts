/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable, Inject } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import { bindThis } from '@/decorators.js';

// リモートゲストログインを許可するホストの照合 (事前精査済み固定リスト運用)。
// SSRF / スパムアカウント量産対策の最初の関門。ここを通過したホスト文字列からしか
// 実際の HTTP リクエストは組み立てない。
@Injectable()
export class RemoteGuestHostAllowlistService {
	constructor(
		@Inject(DI.config)
		private config: Config,
	) {}

	@bindThis
	public normalize(host: string): string {
		return host.trim().toLowerCase().replace(/\.$/, '');
	}

	@bindThis
	public isAllowed(host: string): boolean {
		const allowedHosts = this.config.remoteGuestLogin?.allowedHosts;
		if (allowedHosts == null || allowedHosts.length === 0) return false;
		return allowedHosts.includes(this.normalize(host));
	}
}
