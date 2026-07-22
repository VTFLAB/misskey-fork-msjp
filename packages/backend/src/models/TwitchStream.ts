/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Entity, Column, Index, PrimaryColumn, ManyToOne, JoinColumn } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';

// Twitch の配信セッション。stream.online 〜 stream.offline を 1 レコードで表す。
// 過去セッションも履歴として残す (視聴ページのコメント履歴が streamId で紐づくため)。
@Entity('twitch_stream')
// 配信者 1 人につきプレビュー行 (isPreview = true) は最大 1 件 (bsky-fork 独自)
@Index(['userId'], { unique: true, where: '"isPreview" = true' })
export class MiTwitchStream {
	@PrimaryColumn(id())
	public id: string;

	@Index()
	@Column({
		...id(),
		comment: 'The local user who owns the linked Twitch account.',
	})
	public userId: MiUser['id'];

	@ManyToOne(type => MiUser, {
		onDelete: 'CASCADE',
	})
	@JoinColumn()
	public user: MiUser | null;

	@Index()
	@Column('varchar', {
		length: 64, nullable: true,
		comment: 'Twitch user id of the broadcaster. null for source=ome sessions.',
	})
	public twitchUserId: string | null;

	@Index({ unique: true })
	@Column('varchar', {
		length: 64, nullable: true,
		comment: 'Twitch stream (session) id. null for source=ome sessions.',
	})
	public twitchStreamId: string | null;

	@Column('varchar', {
		length: 128, nullable: true,
		comment: '[Denormalized] Twitch login name (for embed player / chat relay). null for source=ome sessions.',
	})
	public twitchLogin: string | null;

	@Index()
	@Column('varchar', {
		length: 16, default: 'twitch',
		comment: 'Which system produced this session: twitch or ome.',
	})
	public source: 'twitch' | 'ome';

	@Index()
	@Column('boolean', {
		default: false,
	})
	public isLive: boolean;

	// 配信者が配信開始前にチャット動作確認を行うためのプレビュー行 (bsky-fork 独自)。
	// isLive は常に false のまま保つ (getLiveStreamByUserId 等の live 判定クエリから自動除外するため)。
	// 配信者 1 人につき最大 1 行 (partial unique index、migration 1783396235871 側で定義)
	@Column('boolean', {
		default: false,
	})
	public isPreview: boolean;

	@Column('varchar', {
		length: 512, default: '',
	})
	public title: string;

	@Column('varchar', {
		length: 256, nullable: true,
	})
	public gameName: string | null;

	@Column('varchar', {
		length: 1024, nullable: true,
		comment: 'Thumbnail URL template ({width}/{height} placeholders as returned by Helix).',
	})
	public thumbnailUrl: string | null;

	@Column('integer', {
		default: 0,
	})
	public viewerCount: number;

	@Column('timestamp with time zone')
	public startedAt: Date;

	@Column('timestamp with time zone', {
		nullable: true,
	})
	public endedAt: Date | null;

	// 配信アーカイブ (Google Drive) の処理状態。none: 対象外/未処理。
	// pending: ファイル特定待ち → remuxing: mp4化中 → uploading: Drive アップロード中 →
	// processing: サムネイル生成待ち → ready: 再生可能 / failed: 失敗
	@Column('varchar', {
		length: 16, default: 'none',
	})
	public recordingStatus: 'none' | 'pending' | 'remuxing' | 'uploading' | 'processing' | 'ready' | 'failed';

	@Column('varchar', {
		length: 1024, nullable: true,
		comment: 'Local (remuxed) recording file path, cleared once uploaded or on failure.',
	})
	public recordingFilePath: string | null;

	@Column('bigint', {
		nullable: true,
	})
	public recordingFileSize: string | null;

	@Column('varchar', {
		length: 256, nullable: true,
		comment: 'Google Drive file id of the uploaded recording.',
	})
	public recordingGoogleDriveFileId: string | null;

	@Column('varchar', {
		length: 2048, nullable: true,
	})
	public recordingGoogleDriveThumbnailLink: string | null;

	@Column('varchar', {
		length: 512, nullable: true,
	})
	public recordingError: string | null;

	// YouTube アップロードの処理状態。none: 対象外/未処理。pending: アップロード待ち →
	// uploading: YouTube アップロード中 → ready: 公開済み / failed: 失敗。
	// queued: クォータ超過により Drive へ一時退避済み、1時間ごとの自動リトライキュー待ち →
	// cancelled: ユーザーがキュー (queued 状態) を明示的にキャンセルした。
	@Column('varchar', {
		length: 16, default: 'none',
	})
	public youtubeUploadStatus: 'none' | 'pending' | 'uploading' | 'ready' | 'failed' | 'queued' | 'cancelled';

	@Column('varchar', {
		length: 32, nullable: true,
		comment: 'YouTube video id of the uploaded recording.',
	})
	public youtubeVideoId: string | null;

	@Column('varchar', {
		length: 512, nullable: true,
	})
	public youtubeUploadError: string | null;

	@Column('varchar', {
		length: 2048, nullable: true,
		comment: 'YouTube thumbnail URL from the videos.insert response snippet.thumbnails (may be null if not yet available at upload time).',
	})
	public youtubeThumbnailUrl: string | null;

	// アーカイブ視聴制限 (bsky-fork 独自)。配信終了時点の live_channel 側同名カラムのスナップショット
	// (アーカイブ設定画面から個別上書き可)。migration 1784670503199 で追加。
	@Column('varchar', {
		length: 32, default: 'public',
		comment: 'View restriction mode snapshot for the archive, captured from live_channel.visibility when the stream ended. One of public / followers / password / users.',
	})
	public archiveViewVisibility: 'public' | 'followers' | 'password' | 'users';

	@Column('varchar', {
		length: 128, nullable: true,
		comment: 'Plaintext shared secret snapshot/override for password-mode archive view restriction, kept so the owner can review/share it. Never expose to non-owners.',
	})
	public archiveViewPassword: string | null;

	@Column('varchar', {
		length: 32, array: true, default: '{}',
		comment: 'Allowed viewer user IDs snapshot/override for users-mode archive view restriction.',
	})
	public archiveVisibleUserIds: string[];

	@Column('timestamp with time zone', {
		nullable: true,
		comment: 'Non-null once the owner has unpublished this archive from the MSJP listing. The underlying Google Drive/YouTube file is not deleted.',
	})
	public archiveUnpublishedAt: Date | null;

	constructor(data: Partial<MiTwitchStream>) {
		if (data == null) return;

		for (const [k, v] of Object.entries(data)) {
			(this as any)[k] = v;
		}
	}
}
