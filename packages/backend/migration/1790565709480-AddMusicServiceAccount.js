/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// NowPlaying (fork 独自) の scrobble サービス連携テーブル。1 ユーザーにつき service ごとに最大 1 レコード。

export class AddMusicServiceAccount1790565709480 {
    name = 'AddMusicServiceAccount1790565709480'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "music_service_account" ("id" character varying(32) NOT NULL, "userId" character varying(32) NOT NULL, "service" character varying(32) NOT NULL, "serviceUsername" character varying(128), "credential" character varying(512) NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_2e32ffb483daf504e4f16e80341" PRIMARY KEY ("id")); COMMENT ON COLUMN "music_service_account"."userId" IS 'The linked local user.'; COMMENT ON COLUMN "music_service_account"."service" IS 'lastfm or listenbrainz.'; COMMENT ON COLUMN "music_service_account"."serviceUsername" IS 'Username on the linked service (display only).'; COMMENT ON COLUMN "music_service_account"."credential" IS 'Last.fm session key or ListenBrainz user token.'`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_65964890930ae3a372beaf9cec" ON "music_service_account" ("userId", "service") `);
        await queryRunner.query(`ALTER TABLE "music_service_account" ADD CONSTRAINT "FK_474e5e88881cc89f15daeb3b851" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "music_service_account" DROP CONSTRAINT "FK_474e5e88881cc89f15daeb3b851"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_65964890930ae3a372beaf9cec"`);
        await queryRunner.query(`DROP TABLE "music_service_account"`);
    }
}
