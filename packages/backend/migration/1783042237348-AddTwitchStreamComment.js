/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// 配信視聴ページ専用のコメントテーブル (fork 独自)。ノートとは独立し、連合しない。
// Misskey ユーザー投稿 (source=misskey) と Twitch チャット由来 (source=twitch) を保持する。
// 注: migration:generate が出力した atDid / isBot partial index 関連の DDL は
// 既存の partial index を壊すため手で除去してある。

export class AddTwitchStreamComment1783042237348 {
    name = 'AddTwitchStreamComment1783042237348'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "twitch_stream_comment" ("id" character varying(32) NOT NULL, "streamId" character varying(32) NOT NULL, "source" character varying(16) NOT NULL, "userId" character varying(32), "twitchUserName" character varying(128), "twitchDisplayName" character varying(128), "twitchMessageId" character varying(64), "text" character varying(1024) NOT NULL, CONSTRAINT "PK_b682b3590173092ed8c81baf0bc" PRIMARY KEY ("id")); COMMENT ON COLUMN "twitch_stream_comment"."streamId" IS 'The stream (session) this comment belongs to.'; COMMENT ON COLUMN "twitch_stream_comment"."source" IS 'Comment origin: misskey | twitch.'`);
        await queryRunner.query(`CREATE INDEX "IDX_2365bfdda47032ee1b29778eaa" ON "twitch_stream_comment"  ("streamId") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_c88fd0c84d1aa6181ffa83d313" ON "twitch_stream_comment"  ("twitchMessageId") `);
        await queryRunner.query(`ALTER TABLE "twitch_stream_comment" ADD CONSTRAINT "FK_2365bfdda47032ee1b29778eaa2" FOREIGN KEY ("streamId") REFERENCES "twitch_stream"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "twitch_stream_comment" ADD CONSTRAINT "FK_6b8478e9595b9f2b72ad542a5d5" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "twitch_stream_comment" DROP CONSTRAINT "FK_6b8478e9595b9f2b72ad542a5d5"`);
        await queryRunner.query(`ALTER TABLE "twitch_stream_comment" DROP CONSTRAINT "FK_2365bfdda47032ee1b29778eaa2"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_c88fd0c84d1aa6181ffa83d313"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_2365bfdda47032ee1b29778eaa"`);
        await queryRunner.query(`DROP TABLE "twitch_stream_comment"`);
    }
}
