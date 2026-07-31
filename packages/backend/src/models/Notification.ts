/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { userExportableEntities } from '@/types.js';
import { MiUser } from './User.js';
import { MiNote } from './Note.js';
import { MiAccessToken } from './AccessToken.js';
import { MiRole } from './Role.js';
import { MiDriveFile } from './DriveFile.js';
import { MiNoteDraft } from './NoteDraft.js';
import { MiUpdateInfo } from './UpdateInfo.js';
import { MiTwitchStream } from './TwitchStream.js';

// misskey-js の notificationTypes と同期すべし
export type MiNotification = {
	type: 'note';
	id: string;
	createdAt: string;
	notifierId: MiUser['id'];
	noteId: MiNote['id'];
} | {
	type: 'follow';
	id: string;
	createdAt: string;
	notifierId: MiUser['id'];
} | {
	type: 'mention';
	id: string;
	createdAt: string;
	notifierId: MiUser['id'];
	noteId: MiNote['id'];
} | {
	type: 'reply';
	id: string;
	createdAt: string;
	notifierId: MiUser['id'];
	noteId: MiNote['id'];
} | {
	type: 'renote';
	id: string;
	createdAt: string;
	notifierId: MiUser['id'];
	noteId: MiNote['id'];
	targetNoteId: MiNote['id'];
} | {
	type: 'quote';
	id: string;
	createdAt: string;
	notifierId: MiUser['id'];
	noteId: MiNote['id'];
} | {
	type: 'reaction';
	id: string;
	createdAt: string;
	notifierId: MiUser['id'];
	noteId: MiNote['id'];
	reaction: string;
} | {
	type: 'pollEnded';
	id: string;
	createdAt: string;
	notifierId: MiUser['id'];
	noteId: MiNote['id'];
} | {
	type: 'scheduledNotePosted';
	id: string;
	createdAt: string;
	noteId: MiNote['id'];
} | {
	type: 'scheduledNotePostFailed';
	id: string;
	createdAt: string;
	noteDraftId: MiNoteDraft['id'];
} | {
	type: 'receiveFollowRequest';
	id: string;
	createdAt: string;
	notifierId: MiUser['id'];
} | {
	type: 'followRequestAccepted';
	id: string;
	createdAt: string;
	notifierId: MiUser['id'];
	message: string | null;
} | {
	type: 'roleAssigned';
	id: string;
	createdAt: string;
	roleId: MiRole['id'];
} | {
	type: 'chatRoomInvitationReceived';
	id: string;
	createdAt: string;
	notifierId: MiUser['id'];
	invitationId: string;
} | {
	type: 'achievementEarned';
	id: string;
	createdAt: string;
	achievement: string;
} | {
	type: 'exportCompleted';
	id: string;
	createdAt: string;
	exportedEntity: typeof userExportableEntities[number];
	fileId: MiDriveFile['id'];
} | {
	type: 'login';
	id: string;
	createdAt: string;
} | {
	type: 'createToken';
	id: string;
	createdAt: string;
} | {
	type: 'app';
	id: string;
	createdAt: string;

	/**
	 * アプリ通知のbody
	 */
	customBody: string;

	/**
	 * アプリ通知のheader
	 * (省略時はアプリ名で表示されることを期待)
	 */
	customHeader: string | null;

	/**
	 * アプリ通知のicon(URL)
	 * (省略時はアプリアイコンで表示されることを期待)
	 */
	customIcon: string | null;

	/**
	 * アプリ通知のアプリ(のトークン)
	 */
	appAccessTokenId: MiAccessToken['id'] | null;
} | {
	type: 'test';
	id: string;
	createdAt: string;
} | {
	type: 'updateInfo';
	id: string;
	createdAt: string;
	updateInfoId: MiUpdateInfo['id'];
} | {
	// 緊急地震速報 (JMA EEW, bsky-fork 独自)。DB永続化はせず、EarthquakeAlertService の
	// in-memory history から得られる値をそのまま埋め込む (app 型と同じ埋め込みパターン)。
	type: 'earthquakeAlert';
	id: string;
	createdAt: string;
	eventId: string;
	serial: number;
	title: string;
	hypocenter: string;
	magnitude: number;
	maxIntensity: string;
	isWarn: boolean;
	isFinal: boolean;
	isCancel: boolean;
} | {
	// フォロー中ユーザーの Twitch 配信開始通知 (bsky-fork 独自)
	type: 'twitchLiveStreamStarted';
	id: string;
	createdAt: string;
	notifierId: MiUser['id'];
	streamId: MiTwitchStream['id'];
	title: string;
} | {
	// Google 連携 (Drive/YouTube) の refresh token が Google に拒否され、再連携が必要になった (bsky-fork 独自)
	type: 'googleAuthExpired';
	id: string;
	createdAt: string;
	target: 'drive' | 'youtube';
};

export type MiGroupedNotification = MiNotification | {
	type: 'reaction:grouped';
	id: string;
	createdAt: string;
	noteId: MiNote['id'];
	reactions: {
		userId: string;
		reaction: string;
	}[];
} | {
	type: 'renote:grouped';
	id: string;
	createdAt: string;
	noteId: MiNote['id'];
	userIds: string[];
};
