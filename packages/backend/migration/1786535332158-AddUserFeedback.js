/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class AddUserFeedback1786535332158 {
    name = 'AddUserFeedback1786535332158'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "user_feedback" ("id" character varying(32) NOT NULL, "userId" character varying(32) NOT NULL, "type" character varying(16) NOT NULL, "title" character varying(256) NOT NULL, "body" character varying(8192) NOT NULL, "fileIds" character varying(32) array NOT NULL DEFAULT '{}', "status" character varying(16) NOT NULL DEFAULT 'open', "response" character varying(8192), "updatedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_94fb2b9415a96bde222d5e40598" PRIMARY KEY ("id")); COMMENT ON COLUMN "user_feedback"."userId" IS 'The ID of reporter.'; COMMENT ON COLUMN "user_feedback"."type" IS 'bug | feature'; COMMENT ON COLUMN "user_feedback"."status" IS 'open | inProgress | resolved | rejected'; COMMENT ON COLUMN "user_feedback"."response" IS 'Staff response shown to the reporter.'`);
        await queryRunner.query(`CREATE INDEX "IDX_e4cc25c220dea064df29485e39" ON "user_feedback"  ("userId") `);
        await queryRunner.query(`ALTER TABLE "user_feedback" ADD CONSTRAINT "FK_e4cc25c220dea064df29485e39a" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "user_feedback" DROP CONSTRAINT "FK_e4cc25c220dea064df29485e39a"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_e4cc25c220dea064df29485e39"`);
        await queryRunner.query(`DROP TABLE "user_feedback"`);
    }
}
