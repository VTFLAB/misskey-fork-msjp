/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class AddUpdateInfo1782904521481 {
    name = 'AddUpdateInfo1782904521481'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "update_info" ("id" character varying(32) NOT NULL, "updatedAt" TIMESTAMP WITH TIME ZONE, "title" character varying(256) NOT NULL, "text" character varying(8192) NOT NULL, "imageUrl" character varying(1024), CONSTRAINT "PK_1ac040fcc57ae2e5765c06012c1" PRIMARY KEY ("id")); COMMENT ON COLUMN "update_info"."updatedAt" IS 'The updated date of the UpdateInfo.'`);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP TABLE "update_info"`);
    }
}
