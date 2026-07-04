/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class AddRemoteGuestToTwitchStreamComment1783113738808 {
    name = 'AddRemoteGuestToTwitchStreamComment1783113738808'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "twitch_stream_comment" ADD "remoteGuestAccountId" character varying(32)`);
        await queryRunner.query(`ALTER TABLE "twitch_stream_comment" ADD "remoteGuestUsername" character varying(128)`);
        await queryRunner.query(`ALTER TABLE "twitch_stream_comment" ADD "remoteGuestHost" character varying(512)`);
        await queryRunner.query(`COMMENT ON COLUMN "twitch_stream_comment"."source" IS 'Comment origin: misskey | twitch | remote-guest.'`);
        await queryRunner.query(`ALTER TABLE "twitch_stream_comment" ADD CONSTRAINT "FK_cf764edd56e68388e5cd3dedb45" FOREIGN KEY ("remoteGuestAccountId") REFERENCES "remote_guest_account"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "twitch_stream_comment" DROP CONSTRAINT "FK_cf764edd56e68388e5cd3dedb45"`);
        await queryRunner.query(`COMMENT ON COLUMN "twitch_stream_comment"."source" IS 'Comment origin: misskey | twitch.'`);
        await queryRunner.query(`ALTER TABLE "twitch_stream_comment" DROP COLUMN "remoteGuestHost"`);
        await queryRunner.query(`ALTER TABLE "twitch_stream_comment" DROP COLUMN "remoteGuestUsername"`);
        await queryRunner.query(`ALTER TABLE "twitch_stream_comment" DROP COLUMN "remoteGuestAccountId"`);
    }
}
