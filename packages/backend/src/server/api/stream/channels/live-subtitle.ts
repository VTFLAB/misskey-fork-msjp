/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable, Scope } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { bindThis } from '@/decorators.js';
import type { JsonObject } from '@/misc/json-value.js';
import Channel, { type ChannelRequest } from '../channel.js';

// ライブ字幕 (bsky-fork 独自): OBS 用字幕表示ページ用。翻訳・音声認識はクライアントサイドで
// 行われ、サーバーはテキストを中継するのみ (このチャンネルは transport only)。
// OBS ブラウザソース (認証不能) が購読する前提のため匿名購読を許可する
// (投稿系 API `twitch/subtitle/publish` は別途認証必須)。
@Injectable({ scope: Scope.TRANSIENT })
export class LiveSubtitleChannel extends Channel {
	public readonly chName = 'liveSubtitle';
	public static shouldShare = false;
	public static requireCredential = false as const;
	public static kind = null;
	private userId: string | null = null;

	constructor(
		@Inject(REQUEST)
		request: ChannelRequest,
	) {
		super(request);
	}

	@bindThis
	public async init(params: JsonObject) {
		if (typeof params.userId !== 'string') return;

		this.userId = params.userId;

		this.subscriber.on(`liveSubtitleStream:${this.userId}`, this.send);
	}

	@bindThis
	public dispose() {
		this.subscriber.off(`liveSubtitleStream:${this.userId}`, this.send);
	}
}
