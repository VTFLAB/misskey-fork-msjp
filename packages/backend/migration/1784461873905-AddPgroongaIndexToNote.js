/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// PGroongaによるノート全文検索を有効化する (note.textへのpgroongaインデックス)。
// トークナイザはTokenBigram (MeCab辞書の継続メンテナンス不要)、正規化子は
// NormalizerNFKC150でかな/ローマ字/長音記号の表記ゆれを吸収する。
// 適用にはPostgres側にpgroonga拡張が導入済みであることが前提 (postgres:16-alpine
// では未導入のため、事前にpgroonga同梱イメージへの差し替えが必要)。

export class AddPgroongaIndexToNote1784461873905 {
    name = 'AddPgroongaIndexToNote1784461873905'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pgroonga`);
        await queryRunner.query(`CREATE INDEX "IDX_note_text_pgroonga" ON "note" USING pgroonga ("text")
            WITH (tokenizer='TokenBigram', normalizers='NormalizerNFKC150("unify_kana", true, "unify_to_romaji", true, "unify_hyphen_and_prolonged_sound_mark", true)')`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "IDX_note_text_pgroonga"`);
        await queryRunner.query(`DROP EXTENSION IF EXISTS pgroonga`);
    }
}
