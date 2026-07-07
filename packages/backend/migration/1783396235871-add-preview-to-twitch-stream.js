/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class AddPreviewToTwitchStream1783396235871 {
    name = 'AddPreviewToTwitchStream1783396235871';

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "twitch_stream" ADD "isPreview" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_14089d701f9199c223d3dab522" ON "twitch_stream" ("userId") WHERE "isPreview" = true`);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "IDX_14089d701f9199c223d3dab522"`);
        await queryRunner.query(`ALTER TABLE "twitch_stream" DROP COLUMN "isPreview"`);
    }
}
