/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class AddCraftWorldTimeOffset1791542370158 {
    name = 'AddCraftWorldTimeOffset1791542370158'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "craft_world" ADD "timeOffset" bigint NOT NULL DEFAULT 0`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "craft_world" DROP COLUMN "timeOffset"`);
    }
}
