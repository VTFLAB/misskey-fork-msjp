/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class CreateRemoteGuestAccount1783113738806 {
    name = 'CreateRemoteGuestAccount1783113738806'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "remote_guest_account" ("id" character varying(32) NOT NULL, "username" character varying(128) NOT NULL, "usernameLower" character varying(128) NOT NULL, "host" character varying(512) NOT NULL, "avatarUrl" character varying(512), "displayName" character varying(128), "lastLoginAt" TIMESTAMP WITH TIME ZONE NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_68935eaa982b69e10711521e3db" PRIMARY KEY ("id")); COMMENT ON COLUMN "remote_guest_account"."username" IS 'The username on the remote instance (display form).'; COMMENT ON COLUMN "remote_guest_account"."usernameLower" IS 'The username (lowercased) on the remote instance. Used for uniqueness.'; COMMENT ON COLUMN "remote_guest_account"."host" IS 'The remote instance host (normalized: lowercased, no trailing dot).'`);
        await queryRunner.query(`CREATE INDEX "IDX_3ad37444d6ccb6c2ea0d5bb05e" ON "remote_guest_account"  ("lastLoginAt") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_7637018e102a02dc6d9202071f" ON "remote_guest_account"  ("usernameLower", "host") `);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "public"."IDX_7637018e102a02dc6d9202071f"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_3ad37444d6ccb6c2ea0d5bb05e"`);
        await queryRunner.query(`DROP TABLE "remote_guest_account"`);
    }
}
