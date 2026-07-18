/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// live_channel テーブルに視聴制限機能 (WI-視聴制限) の設定 3 カラムを追加。
// visibility: public/followers/password/users のモード。viewPassword: password モード用の平文共有シークレット
// (オーナーのみ閲覧可、絶対に他ユーザーへ露出させない)。visibleUserIds: users モード用の許可ユーザーID配列。

export class AddViewRestrictionToLiveChannel1784402963909 {
    name = 'AddViewRestrictionToLiveChannel1784402963909'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "live_channel" ADD "visibility" character varying(32) NOT NULL DEFAULT 'public'`);
        await queryRunner.query(`COMMENT ON COLUMN "live_channel"."visibility" IS 'View restriction mode for playback. One of public / followers / password / users.'`);
        await queryRunner.query(`ALTER TABLE "live_channel" ADD "viewPassword" character varying(128)`);
        await queryRunner.query(`COMMENT ON COLUMN "live_channel"."viewPassword" IS 'Plaintext shared secret for password-mode view restriction, kept so the owner can review/share it. Never expose to non-owners.'`);
        await queryRunner.query(`ALTER TABLE "live_channel" ADD "visibleUserIds" character varying(32) array NOT NULL DEFAULT '{}'::varchar[]`);
        await queryRunner.query(`COMMENT ON COLUMN "live_channel"."visibleUserIds" IS 'Allowed viewer user IDs for users-mode view restriction.'`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "live_channel" DROP COLUMN "visibleUserIds"`);
        await queryRunner.query(`ALTER TABLE "live_channel" DROP COLUMN "viewPassword"`);
        await queryRunner.query(`ALTER TABLE "live_channel" DROP COLUMN "visibility"`);
    }
}
