/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable, Scope } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { bindThis } from '@/decorators.js';
import type { JsonObject } from '@/misc/json-value.js';
import Channel, { type ChannelRequest } from '../channel.js';

// Twitch 視聴ページ・OBS オーバーレイ用 (bsky-fork 独自)。コメントと配信終了イベントを配信する。
// 配信コメントは OBS 用オーバーレイページ (認証不能なブラウザソース) で公開表示される前提の
// 情報なので、購読自体は匿名を含む誰にでも許可する (投稿系 API は別途認証必須のまま)。
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
