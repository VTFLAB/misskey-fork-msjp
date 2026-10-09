/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class AddCraftSkin1791515142242 {
    name = 'AddCraftSkin1791515142242'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "craft_skin" ("userId" character varying(32) NOT NULL, "fileId" character varying(32) NOT NULL, "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_48535f16f1f348ea85cc554238b" PRIMARY KEY ("userId"))`);
        await queryRunner.query(`CREATE INDEX "IDX_fbed84e4632ece9830f3a275d3" ON "craft_skin" ("fileId") `);
        await queryRunner.query(`ALTER TABLE "craft_skin" ADD CONSTRAINT "FK_48535f16f1f348ea85cc554238b" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "craft_skin" ADD CONSTRAINT "FK_fbed84e4632ece9830f3a275d3d" FOREIGN KEY ("fileId") REFERENCES "drive_file"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "craft_skin" DROP CONSTRAINT "FK_fbed84e4632ece9830f3a275d3d"`);
        await queryRunner.query(`ALTER TABLE "craft_skin" DROP CONSTRAINT "FK_48535f16f1f348ea85cc554238b"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_fbed84e4632ece9830f3a275d3"`);
        await queryRunner.query(`DROP TABLE "craft_skin"`);
    }
}
