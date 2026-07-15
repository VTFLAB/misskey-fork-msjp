/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// live_channel テーブルに自動配信開始ノート機能 (WI-6) の設定 2 カラムを追加。
// offlineImageId と異なり FK/unique constraint を持たないシンプルな追加カラムのみ。

export class AddAutoPostToLiveChannel1784073927723 {
    name = 'AddAutoPostToLiveChannel1784073927723'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "live_channel" ADD "autoPostNoteEnabled" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`COMMENT ON COLUMN "live_channel"."autoPostNoteEnabled" IS 'Whether to automatically post a note to the linked channel when the stream starts.'`);
        await queryRunner.query(`ALTER TABLE "live_channel" ADD "autoPostNoteTemplate" character varying(512)`);
        await queryRunner.query(`COMMENT ON COLUMN "live_channel"."autoPostNoteTemplate" IS 'Template for the auto-posted note. Supports {title}/{url}/{channelName} placeholders. Falls back to a default template when null.'`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "live_channel" DROP COLUMN "autoPostNoteTemplate"`);
        await queryRunner.query(`ALTER TABLE "live_channel" DROP COLUMN "autoPostNoteEnabled"`);
    }
}
