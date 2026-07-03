/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable, Scope } from '@nestjs/common';
import { bindThis } from '@/decorators.js';
import type { JsonObject } from '@/misc/json-value.js';
import Channel, { type ChannelRequest } from '../channel.js';
import { REQUEST } from '@nestjs/core';

// Twitch 視聴ページ用 (bsky-fork 独自)。コメントと配信終了イベントを配信する。
@Injectable({ scope: Scope.TRANSIENT })
export class TwitchLiveStreamChannel extends Channel {
	public readonly chName = 'twitchLiveStream';
	public static shouldShare = false;
	public static requireCredential = true as const;
	public static kind = 'read:account';
	private streamId: string | null = null;

	constructor(
		@Inject(REQUEST)
		request: ChannelRequest,
	) {
		super(request);
	}

	@bindThis
	public async init(params: JsonObject) {
		if (typeof params.streamId !== 'string') return;
		this.streamId = params.streamId;

		this.subscriber.on(`twitchLiveStream:${this.streamId}`, this.send);
	}

	@bindThis
	public dispose() {
		this.subscriber.off(`twitchLiveStream:${this.streamId}`, this.send);
	}
}
