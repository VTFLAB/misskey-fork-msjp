/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// 配信ページ単位のブロックテーブル (fork 独自) + twitch_stream_comment への chatter_user_id 追加。
// 配信者が自分の配信チャットから Misskey ユーザー / リモートゲスト / Twitch チャッターを
// 締め出すためのもので、Misskey 本体の blocking とは独立している。
// 注: migration:generate が出力した atDid / isBot partial index の DROP と
// 無関係なカラム COMMENT 差分は既知のノイズのため手で除去してある。

export class AddTwitchStreamBlock1783147503738 {
    name = 'AddTwitchStreamBlock1783147503738'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "twitch_stream_block" ("id" character varying(32) NOT NULL, "userId" character varying(32) NOT NULL, "targetType" character varying(16) NOT NULL, "targetUserId" character varying(32), "targetRemoteGuestUsername" character varying(128), "targetRemoteGuestHost" character varying(512), "targetTwitchUserId" character varying(64), "targetTwitchUserName" character varying(128), "targetTwitchDisplayName" character varying(128), CONSTRAINT "PK_4eb80b3972d9941a3db75d0cf6d" PRIMARY KEY ("id")); COMMENT ON COLUMN "twitch_stream_block"."userId" IS 'The broadcaster (local user) who owns this block.'; COMMENT ON COLUMN "twitch_stream_block"."targetType" IS 'Block target kind: misskey | remote-guest | twitch.'`);
        await queryRunner.query(`CREATE INDEX "IDX_3a9710ed1227d349fef49ca496" ON "twitch_stream_block"  ("userId") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_bfd3c04341faa77fcac1a5c6f3" ON "twitch_stream_block"  ("userId", "targetTwitchUserName") WHERE "targetTwitchUserName" IS NOT NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_e2dd5e050edaf007d9a936c201" ON "twitch_stream_block"  ("userId", "targetRemoteGuestUsername", "targetRemoteGuestHost") WHERE "targetRemoteGuestUsername" IS NOT NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_c095159b4c9be72533ccd1ca26" ON "twitch_stream_block"  ("userId", "targetUserId") WHERE "targetUserId" IS NOT NULL`);
        await queryRunner.query(`ALTER TABLE "twitch_stream_comment" ADD "twitchChatterUserId" character varying(64)`);
        await queryRunner.query(`ALTER TABLE "twitch_stream_block" ADD CONSTRAINT "FK_3a9710ed1227d349fef49ca496a" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "twitch_stream_block" ADD CONSTRAINT "FK_cc3114722b25f4ab5c80fa6c0b6" FOREIGN KEY ("targetUserId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "twitch_stream_block" DROP CONSTRAINT "FK_cc3114722b25f4ab5c80fa6c0b6"`);
        await queryRunner.query(`ALTER TABLE "twitch_stream_block" DROP CONSTRAINT "FK_3a9710ed1227d349fef49ca496a"`);
        await queryRunner.query(`ALTER TABLE "twitch_stream_comment" DROP COLUMN "twitchChatterUserId"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_c095159b4c9be72533ccd1ca26"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_e2dd5e050edaf007d9a936c201"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_bfd3c04341faa77fcac1a5c6f3"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_3a9710ed1227d349fef49ca496"`);
        await queryRunner.query(`DROP TABLE "twitch_stream_block"`);
    }
}
