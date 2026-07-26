/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class FixRecordingColumnComments1785062626578 {
    name = 'FixRecordingColumnComments1785062626578'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`COMMENT ON COLUMN "twitch_stream"."recordingFilePath" IS 'Local (remuxed) recording file path; cleared once a durable remote copy exists, or purged after the 7-day retention on failure.'`);
        await queryRunner.query(`COMMENT ON COLUMN "twitch_stream_comment"."source" IS 'Comment origin: misskey | twitch | remote-guest | system (server-generated warning).'`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`COMMENT ON COLUMN "twitch_stream_comment"."source" IS 'Comment origin: misskey | twitch | remote-guest.'`);
        await queryRunner.query(`COMMENT ON COLUMN "twitch_stream"."recordingFilePath" IS 'Local (remuxed) recording file path, cleared once uploaded or on failure.'`);
    }
}