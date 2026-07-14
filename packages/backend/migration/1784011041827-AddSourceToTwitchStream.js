/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// twitch_stream を Twitch/OME 共用の汎用配信セッションテーブルにする (決定書 §3)。
// source で判別し、OME セッション行は twitchUserId/twitchStreamId/twitchLogin を null のまま使う。
// unique index (twitchStreamId) は Postgres の NULL 複数許容仕様によりそのまま有効。

export class AddSourceToTwitchStream1784011041827 {
    name = 'AddSourceToTwitchStream1784011041827'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "twitch_stream" ADD "source" character varying(16) NOT NULL DEFAULT 'twitch'`);
        await queryRunner.query(`COMMENT ON COLUMN "twitch_stream"."source" IS 'Which system produced this session: twitch or ome.'`);
        await queryRunner.query(`ALTER TABLE "twitch_stream" ALTER COLUMN "twitchUserId" DROP NOT NULL`);
        await queryRunner.query(`COMMENT ON COLUMN "twitch_stream"."twitchUserId" IS 'Twitch user id of the broadcaster. null for source=ome sessions.'`);
        await queryRunner.query(`ALTER TABLE "twitch_stream" ALTER COLUMN "twitchStreamId" DROP NOT NULL`);
        await queryRunner.query(`COMMENT ON COLUMN "twitch_stream"."twitchStreamId" IS 'Twitch stream (session) id. null for source=ome sessions.'`);
        await queryRunner.query(`ALTER TABLE "twitch_stream" ALTER COLUMN "twitchLogin" DROP NOT NULL`);
        await queryRunner.query(`COMMENT ON COLUMN "twitch_stream"."twitchLogin" IS '[Denormalized] Twitch login name (for embed player / chat relay). null for source=ome sessions.'`);
        await queryRunner.query(`ALTER TABLE "twitch_stream" ALTER COLUMN "twitchLogin" DROP DEFAULT`);
        await queryRunner.query(`CREATE INDEX "IDX_53ee49c8ded0fc914e73a4ddb3" ON "twitch_stream" ("source")`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        // down 実行時に source='ome' の行 (twitchUserId 等が null) が既に存在すると
        // NOT NULL 復元が失敗する。本番運用でこの migration を down する場合は事前に
        // source='ome' の行を手動削除するか、暫定値で埋めてから down すること。
        await queryRunner.query(`DROP INDEX "public"."IDX_53ee49c8ded0fc914e73a4ddb3"`);
        await queryRunner.query(`ALTER TABLE "twitch_stream" ALTER COLUMN "twitchLogin" SET DEFAULT ''`);
        await queryRunner.query(`ALTER TABLE "twitch_stream" ALTER COLUMN "twitchLogin" SET NOT NULL`);
        await queryRunner.query(`COMMENT ON COLUMN "twitch_stream"."twitchLogin" IS '[Denormalized] Twitch login name (for embed player / chat relay).'`);
        await queryRunner.query(`ALTER TABLE "twitch_stream" ALTER COLUMN "twitchStreamId" SET NOT NULL`);
        await queryRunner.query(`COMMENT ON COLUMN "twitch_stream"."twitchStreamId" IS 'Twitch stream (session) id.'`);
        await queryRunner.query(`ALTER TABLE "twitch_stream" ALTER COLUMN "twitchUserId" SET NOT NULL`);
        await queryRunner.query(`COMMENT ON COLUMN "twitch_stream"."twitchUserId" IS 'Twitch user id of the broadcaster.'`);
        await queryRunner.query(`ALTER TABLE "twitch_stream" DROP COLUMN "source"`);
    }
}
