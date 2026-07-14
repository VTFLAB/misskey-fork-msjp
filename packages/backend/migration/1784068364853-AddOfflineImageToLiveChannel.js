/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// live_channel テーブルに、配信切断時にプレイヤーが表示するオフライン画像の DriveFile 参照を追加。
// bannerId/banner と同一パターン (OneToOne, onDelete: 'SET NULL')。

export class AddOfflineImageToLiveChannel1784068364853 {
    name = 'AddOfflineImageToLiveChannel1784068364853'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "live_channel" ADD "offlineImageId" character varying(32)`);
        await queryRunner.query(`COMMENT ON COLUMN "live_channel"."offlineImageId" IS 'The ID of the offline image DriveFile. Shown by the player when the channel is disconnected.'`);
        await queryRunner.query(`ALTER TABLE "live_channel" ADD CONSTRAINT "UQ_2f17ea146f2e0e9e6202977e774" UNIQUE ("offlineImageId")`);
        await queryRunner.query(`ALTER TABLE "live_channel" ADD CONSTRAINT "FK_2f17ea146f2e0e9e6202977e774" FOREIGN KEY ("offlineImageId") REFERENCES "drive_file"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "live_channel" DROP CONSTRAINT "FK_2f17ea146f2e0e9e6202977e774"`);
        await queryRunner.query(`ALTER TABLE "live_channel" DROP CONSTRAINT "UQ_2f17ea146f2e0e9e6202977e774"`);
        await queryRunner.query(`ALTER TABLE "live_channel" DROP COLUMN "offlineImageId"`);
    }
}
