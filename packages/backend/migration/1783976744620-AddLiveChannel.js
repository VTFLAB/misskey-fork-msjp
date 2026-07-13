/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// ライブチャンネル (self-streaming, OME連携) 設定テーブル (fork 独自)。
// 1ユーザー1チャンネル (userId unique index)。streamKey は OME ingest 側の stream 名として使う (unique index)。
// 制約名は `pnpm --filter backend check-migrations` の実行結果 (TypeORM が生成する実際のハッシュ名) で検証済み。

export class AddLiveChannel1783976744620 {
    name = 'AddLiveChannel1783976744620'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "live_channel" ("id" character varying(32) NOT NULL, "userId" character varying(32) NOT NULL, "enabled" boolean NOT NULL DEFAULT false, "name" character varying(128), "description" character varying(2048), "bannerId" character varying(32), "streamKey" character varying(64) NOT NULL, "streamKeyRegeneratedAt" TIMESTAMP WITH TIME ZONE NOT NULL, "lastCutReason" character varying(256), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "REL_6a932b9d6770af04ee8c4c0db7" UNIQUE ("bannerId"), CONSTRAINT "PK_43a1eee100c501a88c0faa3d4c5" PRIMARY KEY ("id")); COMMENT ON COLUMN "live_channel"."userId" IS 'The owner user. One live_channel per user.'; COMMENT ON COLUMN "live_channel"."enabled" IS 'Whether the streaming feature is enabled for this user.'; COMMENT ON COLUMN "live_channel"."name" IS 'Channel display name. Falls back to user.name / username when null.'; COMMENT ON COLUMN "live_channel"."description" IS 'Channel description. No fallback: hidden when null.'; COMMENT ON COLUMN "live_channel"."bannerId" IS 'The ID of channel banner DriveFile. Falls back to user.banner when null.'; COMMENT ON COLUMN "live_channel"."streamKey" IS 'Ingest stream key. Used as the OME stream name.'; COMMENT ON COLUMN "live_channel"."streamKeyRegeneratedAt" IS 'Timestamp of the last streamKey regeneration.'; COMMENT ON COLUMN "live_channel"."lastCutReason" IS 'Reason for the last forced disconnect (bitrate monitor etc). Set by Phase 2.'; COMMENT ON COLUMN "live_channel"."createdAt" IS 'The creation date of the live_channel row.'`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_95dc2e2294e13b07f81490302a" ON "live_channel" ("userId")`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_4072f7e3cf4af1ac9755fe7558" ON "live_channel" ("streamKey")`);
        await queryRunner.query(`ALTER TABLE "live_channel" ADD CONSTRAINT "FK_95dc2e2294e13b07f81490302a9" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "live_channel" ADD CONSTRAINT "FK_6a932b9d6770af04ee8c4c0db79" FOREIGN KEY ("bannerId") REFERENCES "drive_file"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "live_channel" DROP CONSTRAINT "FK_6a932b9d6770af04ee8c4c0db79"`);
        await queryRunner.query(`ALTER TABLE "live_channel" DROP CONSTRAINT "FK_95dc2e2294e13b07f81490302a9"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_4072f7e3cf4af1ac9755fe7558"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_95dc2e2294e13b07f81490302a"`);
        await queryRunner.query(`DROP TABLE "live_channel"`);
    }
}
