/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class YoutubeUploadArchive1784605693620 {
    name = 'YoutubeUploadArchive1784605693620'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "live_channel" ADD "youtubeUploadEnabled" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`COMMENT ON COLUMN "live_channel"."youtubeUploadEnabled" IS 'Whether to upload the recording to YouTube after the stream ends.'`);
        await queryRunner.query(`ALTER TABLE "live_channel" ADD "youtubeTitleTemplate" character varying(256)`);
        await queryRunner.query(`COMMENT ON COLUMN "live_channel"."youtubeTitleTemplate" IS 'Template for the YouTube video title. Supports {title}/{date}/{channelName} placeholders. Falls back to a default template when null.'`);
        await queryRunner.query(`ALTER TABLE "live_channel" ADD "youtubeDescriptionTemplate" character varying(2048)`);
        await queryRunner.query(`COMMENT ON COLUMN "live_channel"."youtubeDescriptionTemplate" IS 'Template for the YouTube video description. Supports {title}/{date}/{channelName} placeholders. Falls back to a default template when null.'`);
        await queryRunner.query(`ALTER TABLE "live_channel" ADD "youtubePrivacyStatus" character varying(16) NOT NULL DEFAULT 'unlisted'`);
        await queryRunner.query(`COMMENT ON COLUMN "live_channel"."youtubePrivacyStatus" IS 'YouTube privacy status for uploaded recordings.'`);
        await queryRunner.query(`ALTER TABLE "twitch_stream" ADD "youtubeUploadStatus" character varying(16) NOT NULL DEFAULT 'none'`);
        await queryRunner.query(`ALTER TABLE "twitch_stream" ADD "youtubeVideoId" character varying(32)`);
        await queryRunner.query(`COMMENT ON COLUMN "twitch_stream"."youtubeVideoId" IS 'YouTube video id of the uploaded recording.'`);
        await queryRunner.query(`ALTER TABLE "twitch_stream" ADD "youtubeUploadError" character varying(512)`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "twitch_stream" DROP COLUMN "youtubeUploadError"`);
        await queryRunner.query(`ALTER TABLE "twitch_stream" DROP COLUMN "youtubeVideoId"`);
        await queryRunner.query(`ALTER TABLE "twitch_stream" DROP COLUMN "youtubeUploadStatus"`);
        await queryRunner.query(`ALTER TABLE "live_channel" DROP COLUMN "youtubePrivacyStatus"`);
        await queryRunner.query(`ALTER TABLE "live_channel" DROP COLUMN "youtubeDescriptionTemplate"`);
        await queryRunner.query(`ALTER TABLE "live_channel" DROP COLUMN "youtubeTitleTemplate"`);
        await queryRunner.query(`ALTER TABLE "live_channel" DROP COLUMN "youtubeUploadEnabled"`);
    }
}
