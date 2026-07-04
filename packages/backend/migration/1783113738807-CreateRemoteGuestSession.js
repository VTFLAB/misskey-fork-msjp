/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class CreateRemoteGuestSession1783113738807 {
    name = 'CreateRemoteGuestSession1783113738807'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "remote_guest_session" ("id" character varying(32) NOT NULL, "token" character varying(128) NOT NULL, "remoteGuestAccountId" character varying(32) NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL, "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "lastActiveAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_dbd62e0dd9675ae86b674451c5d" PRIMARY KEY ("id")); COMMENT ON COLUMN "remote_guest_session"."token" IS 'Opaque bearer token held by the frontend (localStorage).'; COMMENT ON COLUMN "remote_guest_session"."expiresAt" IS 'Sliding expiry, extended on each validated use.'`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_dd66d47dff98742b99e3e50b2e" ON "remote_guest_session"  ("token") `);
        await queryRunner.query(`CREATE INDEX "IDX_f966722dcefac6e237e91cedc6" ON "remote_guest_session"  ("remoteGuestAccountId") `);
        await queryRunner.query(`CREATE INDEX "IDX_e945a8b9a0a91000cb1a74d00a" ON "remote_guest_session"  ("expiresAt") `);
        await queryRunner.query(`ALTER TABLE "remote_guest_session" ADD CONSTRAINT "FK_f966722dcefac6e237e91cedc6a" FOREIGN KEY ("remoteGuestAccountId") REFERENCES "remote_guest_account"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "remote_guest_session" DROP CONSTRAINT "FK_f966722dcefac6e237e91cedc6a"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_e945a8b9a0a91000cb1a74d00a"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_f966722dcefac6e237e91cedc6"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_dd66d47dff98742b99e3e50b2e"`);
        await queryRunner.query(`DROP TABLE "remote_guest_session"`);
    }
}
