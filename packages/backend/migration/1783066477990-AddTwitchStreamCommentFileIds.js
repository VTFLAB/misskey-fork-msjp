/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class AddTwitchStreamCommentFileIds1783066477990 {
	name = 'AddTwitchStreamCommentFileIds1783066477990'

	async up(queryRunner) {
		await queryRunner.query(`ALTER TABLE "twitch_stream_comment" ADD "fileIds" character varying(32) array NOT NULL DEFAULT '{}'`);
		await queryRunner.query(`COMMENT ON COLUMN "twitch_stream_comment"."fileIds" IS 'Attached drive files (source=misskey only, not relayed to Twitch).'`);
	}

	async down(queryRunner) {
		await queryRunner.query(`ALTER TABLE "twitch_stream_comment" DROP COLUMN "fileIds"`);
	}
}
