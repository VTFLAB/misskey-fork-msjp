/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class AddCraftPlayerState1791530608982 {
    name = 'AddCraftPlayerState1791530608982'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "craft_player_state" ("worldId" character varying(32) NOT NULL, "userId" character varying(32) NOT NULL, "state" jsonb NOT NULL DEFAULT '{}', "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_f90f2c7eba12cb34d895f1e058c" PRIMARY KEY ("worldId", "userId"))`);
        await queryRunner.query(`CREATE INDEX "IDX_4028f750b54539ab8ad63996e6" ON "craft_player_state" ("userId") `);
        await queryRunner.query(`ALTER TABLE "craft_player_state" ADD CONSTRAINT "FK_097db9c55cd7801062160a90104" FOREIGN KEY ("worldId") REFERENCES "craft_world"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "craft_player_state" ADD CONSTRAINT "FK_4028f750b54539ab8ad63996e69" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "craft_player_state" DROP CONSTRAINT "FK_4028f750b54539ab8ad63996e69"`);
        await queryRunner.query(`ALTER TABLE "craft_player_state" DROP CONSTRAINT "FK_097db9c55cd7801062160a90104"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_4028f750b54539ab8ad63996e6"`);
        await queryRunner.query(`DROP TABLE "craft_player_state"`);
    }
}
