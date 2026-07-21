/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class YoutubeIndependentTokens1784612267481 {
    name = 'YoutubeIndependentTokens1784612267481'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "google_account" ADD "youtubeRefreshToken" character varying(512)`);
        await queryRunner.query(`ALTER TABLE "google_account" ADD "youtubeAccessToken" character varying(512)`);
        await queryRunner.query(`ALTER TABLE "google_account" ADD "youtubeExpiresAt" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`COMMENT ON COLUMN "google_account"."youtubeExpiresAt" IS 'Expiry of youtubeAccessToken. null = YouTube not linked.'`);
        await queryRunner.query(`ALTER TABLE "google_account" ADD "youtubeScopes" character varying(128) array NOT NULL DEFAULT '{}'`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "google_account" DROP COLUMN "youtubeScopes"`);
        await queryRunner.query(`ALTER TABLE "google_account" DROP COLUMN "youtubeExpiresAt"`);
        await queryRunner.query(`ALTER TABLE "google_account" DROP COLUMN "youtubeAccessToken"`);
        await queryRunner.query(`ALTER TABLE "google_account" DROP COLUMN "youtubeRefreshToken"`);
    }
}
