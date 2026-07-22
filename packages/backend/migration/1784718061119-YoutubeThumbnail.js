/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class YoutubeThumbnail1784718061119 {
    name = 'YoutubeThumbnail1784718061119'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "twitch_stream" ADD "youtubeThumbnailUrl" character varying(2048)`);
        await queryRunner.query(`COMMENT ON COLUMN "twitch_stream"."youtubeThumbnailUrl" IS 'YouTube thumbnail URL from the videos.insert response snippet.thumbnails (may be null if not yet available at upload time).'`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`COMMENT ON COLUMN "twitch_stream"."youtubeThumbnailUrl" IS 'YouTube thumbnail URL from the videos.insert response snippet.thumbnails (may be null if not yet available at upload time).'`);
        await queryRunner.query(`ALTER TABLE "twitch_stream" DROP COLUMN "youtubeThumbnailUrl"`);
    }
}
