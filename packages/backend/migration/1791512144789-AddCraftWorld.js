/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class AddCraftWorld1791512144789 {
    name = 'AddCraftWorld1791512144789'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "craft_world" ("id" character varying(32) NOT NULL, "userId" character varying(32) NOT NULL, "name" character varying(128) NOT NULL, "seed" integer NOT NULL, "isPublic" boolean NOT NULL DEFAULT true, "blockCount" integer NOT NULL DEFAULT 0, CONSTRAINT "PK_08ecaf6cb5d62fa2cf586011120" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_45ebf4f237e904fa859a634b1b" ON "craft_world" ("userId") `);
        await queryRunner.query(`CREATE INDEX "IDX_4c5279546b3b4881b02baedf8c" ON "craft_world" ("isPublic") `);
        await queryRunner.query(`CREATE TABLE "craft_block" ("worldId" character varying(32) NOT NULL, "x" integer NOT NULL, "y" integer NOT NULL, "z" integer NOT NULL, "type" smallint NOT NULL, "userId" character varying(32), CONSTRAINT "PK_ed65817a6ab1ef7d7592e98586e" PRIMARY KEY ("worldId", "x", "y", "z"))`);
        await queryRunner.query(`CREATE INDEX "IDX_e18fafbfaf7df901226e6f261e" ON "craft_block" ("worldId") `);
        await queryRunner.query(`CREATE INDEX "IDX_4b223f1cffb724565858e951de" ON "craft_block" ("userId") `);
        await queryRunner.query(`ALTER TABLE "craft_world" ADD CONSTRAINT "FK_45ebf4f237e904fa859a634b1b7" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "craft_block" ADD CONSTRAINT "FK_e18fafbfaf7df901226e6f261e5" FOREIGN KEY ("worldId") REFERENCES "craft_world"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "craft_block" ADD CONSTRAINT "FK_4b223f1cffb724565858e951de1" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "craft_block" DROP CONSTRAINT "FK_4b223f1cffb724565858e951de1"`);
        await queryRunner.query(`ALTER TABLE "craft_block" DROP CONSTRAINT "FK_e18fafbfaf7df901226e6f261e5"`);
        await queryRunner.query(`ALTER TABLE "craft_world" DROP CONSTRAINT "FK_45ebf4f237e904fa859a634b1b7"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_4b223f1cffb724565858e951de"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_e18fafbfaf7df901226e6f261e"`);
        await queryRunner.query(`DROP TABLE "craft_block"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_4c5279546b3b4881b02baedf8c"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_45ebf4f237e904fa859a634b1b"`);
        await queryRunner.query(`DROP TABLE "craft_world"`);
    }
}
