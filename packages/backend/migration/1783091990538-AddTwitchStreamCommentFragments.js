/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class AddTwitchStreamCommentFragments1783091990538 {
	name = 'AddTwitchStreamCommentFragments1783091990538'

	async up(queryRunner) {
		await queryRunner.query(`ALTER TABLE "twitch_stream_comment" ADD "fragments" jsonb`);
		await queryRunner.query(`COMMENT ON COLUMN "twitch_stream_comment"."fragments" IS 'Twitch EventSub message fragments (source=twitch only). Used to render Twitch emotes inline; null for plain-text-only messages.'`);
	}

	async down(queryRunner) {
		await queryRunner.query(`ALTER TABLE "twitch_stream_comment" DROP COLUMN "fragments"`);
	}
}
