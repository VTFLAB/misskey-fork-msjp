/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Entity, Column, Index, PrimaryColumn, ManyToOne, OneToOne, JoinColumn } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';
import { MiChannel } from './Channel.js';
import { MiDriveFile } from './DriveFile.js';

// ライブチャンネル (self-streaming, OME連携) の設定行。1 Misskey ユーザーにつき最大 1 レコード。
// 行の存在 + enabled=true が「配信機能を利用する」トグル ON を意味する。
@Entity('live_channel')
export class MiLiveChannel {
	@PrimaryColumn(id())
	public id: string;

	@Index({ unique: true })
	@Column({
		...id(),
		comment: 'The owner user. One live_channel per user.',
	})
	public userId: MiUser['id'];

	@ManyToOne(type => MiUser, {
		onDelete: 'CASCADE',
	})
	@JoinColumn()
	public user: MiUser | null;

	@Column('boolean', {
		default: false,
		comment: 'Whether the streaming feature is enabled for this user.',
	})
	public enabled: boolean;

	@Column('varchar', {
		length: 128, nullable: true,
		comment: 'Channel display name. Falls back to user.name / username when null.',
	})
	public name: string | null;

	@Column('varchar', {
		length: 2048, nullable: true,
		comment: 'Channel description. No fallback: hidden when null.',
	})
	public description: string | null;

	@Column({
		...id(),
		nullable: true,
		comment: 'The ID of channel banner DriveFile. Falls back to user.banner when null.',
	})
	public bannerId: MiDriveFile['id'] | null;

	@OneToOne(() => MiDriveFile, {
		onDelete: 'SET NULL',
	})
	@JoinColumn()
	public banner: MiDriveFile | null;

	@Column({
		...id(),
		nullable: true,
		comment: 'The ID of the offline image DriveFile. Shown by the player when the channel is disconnected.',
	})
	public offlineImageId: MiDriveFile['id'] | null;

	@OneToOne(() => MiDriveFile, {
		onDelete: 'SET NULL',
	})
	@JoinColumn()
	public offlineImage: MiDriveFile | null;

	@Index()
	@Column({
		...id(),
		nullable: true,
		comment: 'The associated Misskey channel for community timeline (YouTube-like channel posts).',
	})
	public channelId: MiChannel['id'] | null;

	@ManyToOne(() => MiChannel, {
		onDelete: 'SET NULL',
	})
	@JoinColumn()
	public channel: MiChannel | null;

	@Index({ unique: true })
	@Column('varchar', {
		length: 64,
		comment: 'Ingest stream key. Used as the OME stream name.',
	})
	public streamKey: string;

	@Column('timestamp with time zone', {
		comment: 'Timestamp of the last streamKey regeneration.',
	})
	public streamKeyRegeneratedAt: Date;

	@Column('varchar', {
		length: 256, nullable: true,
		comment: 'Reason for the last forced disconnect (bitrate monitor etc). Set by Phase 2.',
	})
	public lastCutReason: string | null;

	@Column('timestamp with time zone', {
		comment: 'The creation date of the live_channel row.',
	})
	public createdAt: Date;

	@Column('boolean', {
		default: false,
		comment: 'Whether to automatically post a note to the linked channel when the stream starts.',
	})
	public autoPostNoteEnabled: boolean;

	@Column('varchar', {
		length: 512, nullable: true,
		comment: 'Template for the auto-posted note. Supports {title}/{url}/{channelName} placeholders. Falls back to a default template when null.',
	})
	public autoPostNoteTemplate: string | null;

	@Column('boolean', {
		default: false,
		comment: 'Whether to upload the recording to YouTube after the stream ends.',
	})
	public youtubeUploadEnabled: boolean;

	@Column('varchar', {
		length: 256, nullable: true,
		comment: 'Template for the YouTube video title. Supports {title}/{date}/{channelName} placeholders. Falls back to a default template when null.',
	})
	public youtubeTitleTemplate: string | null;

	@Column('varchar', {
		length: 2048, nullable: true,
		comment: 'Template for the YouTube video description. Supports {title}/{date}/{channelName} placeholders. Falls back to a default template when null.',
	})
	public youtubeDescriptionTemplate: string | null;

	@Column('varchar', {
		length: 16, default: 'unlisted',
		comment: 'YouTube privacy status for uploaded recordings.',
	})
	public youtubePrivacyStatus: 'public' | 'unlisted' | 'private';

	@Column('varchar', {
		length: 32, default: 'public',
		comment: 'View restriction mode for playback. One of public / followers / password / users.',
	})
	public visibility: 'public' | 'followers' | 'password' | 'users';

	@Column('varchar', {
		length: 128, nullable: true,
		comment: 'Plaintext shared secret for password-mode view restriction, kept so the owner can review/share it. Never expose to non-owners.',
	})
	public viewPassword: string | null;

	@Column('varchar', {
		length: 32, array: true, default: '{}',
		comment: 'Allowed viewer user IDs for users-mode view restriction.',
	})
	public visibleUserIds: string[];

	constructor(data: Partial<MiLiveChannel>) {
		if (data == null) return;

		for (const [k, v] of Object.entries(data)) {
			(this as any)[k] = v;
		}
	}
}
