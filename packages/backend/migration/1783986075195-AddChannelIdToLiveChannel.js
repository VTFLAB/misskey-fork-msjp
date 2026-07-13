/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// live_channel テーブルに紐づく Misskey channel (community timeline) の ID 列を追加。
// live_channel 作成時に channel 行を自動生成し、live-channel ページの "channel TL" として利用する。

export class AddChannelIdToLiveChannel1783986075195 {
    name = 'AddChannelIdToLiveChannel1783986075195'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE \"live_channel\" ADD \"channelId\" character varying(32)`);
        await queryRunner.query(`COMMENT ON COLUMN \"live_channel\".\"channelId\" IS 'The associated Misskey channel for community timeline (YouTube-like channel posts).'`);
        await queryRunner.query(`CREATE INDEX \"IDX_9fd30d2ecd8f333b9b8f929666\" ON \"live_channel\" (\"channelId\")`);
        await queryRunner.query(`ALTER TABLE \"live_channel\" ADD CONSTRAINT \"FK_9fd30d2ecd8f333b9b8f9296662\" FOREIGN KEY (\"channelId\") REFERENCES \"channel\"(\"id\") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE \"live_channel\" DROP CONSTRAINT \"FK_9fd30d2ecd8f333b9b8f9296662\"`);
        await queryRunner.query(`DROP INDEX \"public\".\"IDX_9fd30d2ecd8f333b9b8f929666\"`);
        await queryRunner.query(`ALTER TABLE \"live_channel\" DROP COLUMN \"channelId\"`);
    }
}
