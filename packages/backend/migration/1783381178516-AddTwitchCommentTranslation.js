/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Twitch 配信コメント翻訳機能 (bsky-fork 独自) 向けのカラム追加。
// twitch_account.translationEnabled: 配信者単位の恒久設定 (配信を跨いで維持、デフォルト無効)。
// twitch_stream_comment.translatedText / translatedLang: 翻訳結果の永続化 (nullable、未翻訳/失敗時は null)。

export class AddTwitchCommentTranslation1783381178516 {
    name = 'AddTwitchCommentTranslation1783381178516'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "twitch_account" ADD "translationEnabled" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "twitch_stream_comment" ADD "translatedText" character varying(1024)`);
        await queryRunner.query(`ALTER TABLE "twitch_stream_comment" ADD "translatedLang" character varying(8)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "twitch_stream_comment" DROP COLUMN "translatedLang"`);
        await queryRunner.query(`ALTER TABLE "twitch_stream_comment" DROP COLUMN "translatedText"`);
        await queryRunner.query(`ALTER TABLE "twitch_account" DROP COLUMN "translationEnabled"`);
    }
}
