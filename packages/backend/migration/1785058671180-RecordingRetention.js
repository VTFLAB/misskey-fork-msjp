/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class RecordingRetention1785058671180 {
    name = 'RecordingRetention1785058671180'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "twitch_stream" ADD "recordingRetentionExpiresAt" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`COMMENT ON COLUMN "twitch_stream"."recordingRetentionExpiresAt" IS 'When the locally-retained mp4 is purged after a failed archive; null when not under retention.'`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`COMMENT ON COLUMN "twitch_stream"."recordingRetentionExpiresAt" IS 'When the locally-retained mp4 is purged after a failed archive; null when not under retention.'`);
        await queryRunner.query(`ALTER TABLE "twitch_stream" DROP COLUMN "recordingRetentionExpiresAt"`);
    }
}
