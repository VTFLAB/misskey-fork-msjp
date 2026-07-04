/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable, Scope } from '@nestjs/common';
import { bindThis } from '@/decorators.js';
import type { JsonObject } from '@/misc/json-value.js';
import { RemoteGuestSessionService } from '@/core/remote-guest/RemoteGuestSessionService.js';
import Channel, { type ChannelRequest } from '../channel.js';
import { REQUEST } from '@nestjs/core';

// Twitch 視聴ページ用 (bsky-fork 独自)。コメントと配信終了イベントを配信する。
// ローカルユーザーだけでなく、有効な remoteGuestToken を持つリモートゲストの購読も許可する。
@Injectable({ scope: Scope.TRANSIENT })
export class TwitchLiveStreamChannel extends Channel {
	public readonly chName = 'twitchLiveStream';
	public static shouldShare = false;
	public static requireCredential = false as const;
	public static kind = null;
	private streamId: string | null = null;

	constructor(
		@Inject(REQUEST)
		request: ChannelRequest,

		private remoteGuestSessionService: RemoteGuestSessionService,
	) {
		super(request);
	}

	@bindThis
	public async init(params: JsonObject) {
		if (typeof params.streamId !== 'string') return;

		if (this.user == null) {
			const guestToken = typeof params.guestToken === 'string' ? params.guestToken : null;
			const guest = guestToken != null ? await this.remoteGuestSessionService.validate(guestToken) : null;
			if (guest == null) return; // 未認証: 何も購読しない
		}

		this.streamId = params.streamId;

		this.subscriber.on(`twitchLiveStream:${this.streamId}`, this.send);
	}

	@bindThis
	public dispose() {
		this.subscriber.off(`twitchLiveStream:${this.streamId}`, this.send);
	}
}
