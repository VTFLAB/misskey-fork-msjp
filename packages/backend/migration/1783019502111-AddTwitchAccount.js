/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Twitch アカウント連携テーブル (fork 独自)。
// isBot=true はインスタンス共通中継 bot の単一レコード (partial unique index で単一性を担保)。
// 注: migration:generate が出力した atDid 関連の DDL (IDX_user_atDid の DROP / COMMENT) は
// bsky 統合の partial index を壊すため手で除去してある。

export class AddTwitchAccount1783019502111 {
    name = 'AddTwitchAccount1783019502111'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "twitch_account" ("id" character varying(32) NOT NULL, "userId" character varying(32), "twitchUserId" character varying(64) NOT NULL, "twitchLogin" character varying(128) NOT NULL, "twitchDisplayName" character varying(128) NOT NULL, "isBot" boolean NOT NULL DEFAULT false, "accessToken" character varying(512) NOT NULL, "refreshToken" character varying(512), "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "scopes" character varying(64) array NOT NULL DEFAULT '{}', CONSTRAINT "PK_47348a1e4f1a9682eea36fc73d2" PRIMARY KEY ("id")); COMMENT ON COLUMN "twitch_account"."userId" IS 'The linked local user. Null for the instance-wide relay bot account.'; COMMENT ON COLUMN "twitch_account"."twitchUserId" IS 'Twitch user id.'; COMMENT ON COLUMN "twitch_account"."twitchLogin" IS 'Twitch login name (used for chat / embed player URLs).'; COMMENT ON COLUMN "twitch_account"."isBot" IS 'Whether this row is the instance-wide relay bot account.'; COMMENT ON COLUMN "twitch_account"."expiresAt" IS 'Expiry of accessToken.'`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_290ee8d18743797e876f049211" ON "twitch_account"  ("userId") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_a86e1ce56dd9847809f229a6b1" ON "twitch_account"  ("twitchUserId") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_twitch_account_isBot" ON "twitch_account" ("isBot") WHERE "isBot" = TRUE`);
        await queryRunner.query(`ALTER TABLE "twitch_account" ADD CONSTRAINT "FK_290ee8d18743797e876f049211e" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "twitch_account" DROP CONSTRAINT "FK_290ee8d18743797e876f049211e"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_twitch_account_isBot"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_a86e1ce56dd9847809f229a6b1"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_290ee8d18743797e876f049211"`);
        await queryRunner.query(`DROP TABLE "twitch_account"`);
    }
}
