/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class TwitchRestream1785505097169 {
	name = 'TwitchRestream1785505097169';

	async up(queryRunner) {
		await queryRunner.query(`ALTER TABLE "live_channel" ADD "twitchRestreamEnabled" boolean NOT NULL DEFAULT false`);
		await queryRunner.query(`COMMENT ON COLUMN "live_channel"."twitchRestreamEnabled" IS 'Whether to relay (simulcast) the OME live stream to the linked Twitch channel. Requires visibility=public.'`);
	}

	async down(queryRunner) {
		await queryRunner.query(`ALTER TABLE "live_channel" DROP COLUMN "twitchRestreamEnabled"`);
	}
}
