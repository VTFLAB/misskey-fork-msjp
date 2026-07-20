/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class GoogleDriveArchive1784554189066 {
    name = 'GoogleDriveArchive1784554189066'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "google_account" ("id" character varying(32) NOT NULL, "userId" character varying(32) NOT NULL, "googleEmail" character varying(256) NOT NULL, "refreshToken" character varying(512), "accessToken" character varying(512), "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "scopes" character varying(128) array NOT NULL DEFAULT '{}', "folderId" character varying(128), CONSTRAINT "PK_835317e153f37fff1e896fb1d8c" PRIMARY KEY ("id")); COMMENT ON COLUMN "google_account"."userId" IS 'The linked local user.'; COMMENT ON COLUMN "google_account"."googleEmail" IS 'Google account email.'; COMMENT ON COLUMN "google_account"."expiresAt" IS 'Expiry of accessToken.'; COMMENT ON COLUMN "google_account"."folderId" IS 'Google Drive folder id to upload recordings into. null = upload to root.'`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_a69adff25d915f62a55562360f" ON "google_account"  ("userId") `);
        await queryRunner.query(`ALTER TABLE "twitch_stream" ADD "recordingStatus" character varying(16) NOT NULL DEFAULT 'none'`);
        await queryRunner.query(`ALTER TABLE "twitch_stream" ADD "recordingFilePath" character varying(1024)`);
        await queryRunner.query(`COMMENT ON COLUMN "twitch_stream"."recordingFilePath" IS 'Local (remuxed) recording file path, cleared once uploaded or on failure.'`);
        await queryRunner.query(`ALTER TABLE "twitch_stream" ADD "recordingFileSize" bigint`);
        await queryRunner.query(`ALTER TABLE "twitch_stream" ADD "recordingGoogleDriveFileId" character varying(256)`);
        await queryRunner.query(`COMMENT ON COLUMN "twitch_stream"."recordingGoogleDriveFileId" IS 'Google Drive file id of the uploaded recording.'`);
        await queryRunner.query(`ALTER TABLE "twitch_stream" ADD "recordingGoogleDriveThumbnailLink" character varying(2048)`);
        await queryRunner.query(`ALTER TABLE "twitch_stream" ADD "recordingError" character varying(512)`);
        await queryRunner.query(`ALTER TABLE "google_account" ADD CONSTRAINT "FK_a69adff25d915f62a55562360fe" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "google_account" DROP CONSTRAINT "FK_a69adff25d915f62a55562360fe"`);
        await queryRunner.query(`ALTER TABLE "twitch_stream" DROP COLUMN "recordingError"`);
        await queryRunner.query(`ALTER TABLE "twitch_stream" DROP COLUMN "recordingGoogleDriveThumbnailLink"`);
        await queryRunner.query(`COMMENT ON COLUMN "twitch_stream"."recordingGoogleDriveFileId" IS 'Google Drive file id of the uploaded recording.'`);
        await queryRunner.query(`ALTER TABLE "twitch_stream" DROP COLUMN "recordingGoogleDriveFileId"`);
        await queryRunner.query(`ALTER TABLE "twitch_stream" DROP COLUMN "recordingFileSize"`);
        await queryRunner.query(`COMMENT ON COLUMN "twitch_stream"."recordingFilePath" IS 'Local (remuxed) recording file path, cleared once uploaded or on failure.'`);
        await queryRunner.query(`ALTER TABLE "twitch_stream" DROP COLUMN "recordingFilePath"`);
        await queryRunner.query(`ALTER TABLE "twitch_stream" DROP COLUMN "recordingStatus"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_a69adff25d915f62a55562360f"`);
        await queryRunner.query(`DROP TABLE "google_account"`);
    }
}
