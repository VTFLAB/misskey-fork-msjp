/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// twitch_stream (配信アーカイブ) に視聴制限スナップショット (WI-アーカイブ視聴制限) の設定 4 カラムを追加。
// archiveViewVisibility/archiveViewPassword/archiveVisibleUserIds は配信終了時点の live_channel 側
// 同名カラムのスナップショット (アーカイブ設定画面から個別上書き可)。archiveUnpublishedAt は非NULLで
// 「アーカイブ公開取り消し済み」を表す。実ファイルは削除しない、既存の endedAt と同じ
// 「nullable timestamp で状態変化を表す」流儀。

export class AddArchiveViewRestrictionToTwitchStream1784670503199 {
    name = 'AddArchiveViewRestrictionToTwitchStream1784670503199'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "twitch_stream" ADD "archiveViewVisibility" character varying(32) NOT NULL DEFAULT 'public'`);
        await queryRunner.query(`COMMENT ON COLUMN "twitch_stream"."archiveViewVisibility" IS 'View restriction mode snapshot for the archive, captured from live_channel.visibility when the stream ended. One of public / followers / password / users.'`);
        await queryRunner.query(`ALTER TABLE "twitch_stream" ADD "archiveViewPassword" character varying(128)`);
        await queryRunner.query(`COMMENT ON COLUMN "twitch_stream"."archiveViewPassword" IS 'Plaintext shared secret snapshot/override for password-mode archive view restriction, kept so the owner can review/share it. Never expose to non-owners.'`);
        await queryRunner.query(`ALTER TABLE "twitch_stream" ADD "archiveVisibleUserIds" character varying(32) array NOT NULL DEFAULT '{}'::varchar[]`);
        await queryRunner.query(`COMMENT ON COLUMN "twitch_stream"."archiveVisibleUserIds" IS 'Allowed viewer user IDs snapshot/override for users-mode archive view restriction.'`);
        await queryRunner.query(`ALTER TABLE "twitch_stream" ADD "archiveUnpublishedAt" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`COMMENT ON COLUMN "twitch_stream"."archiveUnpublishedAt" IS 'Non-null once the owner has unpublished this archive from the MSJP listing. The underlying Google Drive/YouTube file is not deleted.'`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "twitch_stream" DROP COLUMN "archiveUnpublishedAt"`);
        await queryRunner.query(`ALTER TABLE "twitch_stream" DROP COLUMN "archiveVisibleUserIds"`);
        await queryRunner.query(`ALTER TABLE "twitch_stream" DROP COLUMN "archiveViewPassword"`);
        await queryRunner.query(`ALTER TABLE "twitch_stream" DROP COLUMN "archiveViewVisibility"`);
    }
}
