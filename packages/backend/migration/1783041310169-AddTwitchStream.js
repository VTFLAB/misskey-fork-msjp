/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Twitch 配信セッションテーブル (fork 独自)。stream.online〜offline を 1 レコードで表し、
// 過去セッションも履歴として残す (コメント履歴が streamId で紐づくため)。

export class AddTwitchStream1783041310169 {
    name = 'AddTwitchStream1783041310169'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "twitch_stream" ("id" character varying(32) NOT NULL, "userId" character varying(32) NOT NULL, "twitchUserId" character varying(64) NOT NULL, "twitchStreamId" character varying(64) NOT NULL, "twitchLogin" character varying(128) NOT NULL DEFAULT '', "isLive" boolean NOT NULL DEFAULT false, "title" character varying(512) NOT NULL DEFAULT '', "gameName" character varying(256), "thumbnailUrl" character varying(1024), "viewerCount" integer NOT NULL DEFAULT '0', "startedAt" TIMESTAMP WITH TIME ZONE NOT NULL, "endedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_a321ee015883fd2e7dd1ce46525" PRIMARY KEY ("id")); COMMENT ON COLUMN "twitch_stream"."userId" IS 'The local user who owns the linked Twitch account.'; COMMENT ON COLUMN "twitch_stream"."twitchUserId" IS 'Twitch user id of the broadcaster.'; COMMENT ON COLUMN "twitch_stream"."twitchStreamId" IS 'Twitch stream (session) id.'; COMMENT ON COLUMN "twitch_stream"."twitchLogin" IS '[Denormalized] Twitch login name (for embed player / chat relay).'; COMMENT ON COLUMN "twitch_stream"."thumbnailUrl" IS 'Thumbnail URL template ({width}/{height} placeholders as returned by Helix).'`);
        await queryRunner.query(`CREATE INDEX "IDX_fb90117ceec2480495a5e222f1" ON "twitch_stream"  ("userId") `);
        await queryRunner.query(`CREATE INDEX "IDX_e237d33b46ac9018b990c030b8" ON "twitch_stream"  ("twitchUserId") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_670503ba9c6f20b754c0b293bd" ON "twitch_stream"  ("twitchStreamId") `);
        await queryRunner.query(`CREATE INDEX "IDX_74dc3bac205da0a9ef116723ef" ON "twitch_stream"  ("isLive") `);
        await queryRunner.query(`ALTER TABLE "twitch_stream" ADD CONSTRAINT "FK_fb90117ceec2480495a5e222f17" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "twitch_stream" DROP CONSTRAINT "FK_fb90117ceec2480495a5e222f17"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_74dc3bac205da0a9ef116723ef"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_670503ba9c6f20b754c0b293bd"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_e237d33b46ac9018b990c030b8"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_fb90117ceec2480495a5e222f1"`);
        await queryRunner.query(`DROP TABLE "twitch_stream"`);
    }
}
