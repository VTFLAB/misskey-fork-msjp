/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// AT Protocol DID を MiUser に追加。
// host='bsky.social' の pseudo-remote user 専用、それ以外は NULL。
// PostgreSQL の partial unique index で「null は重複可、DID は globally unique」を表現。

export class AddAtDidToUser1779174024562 {
	name = 'AddAtDidToUser1779174024562'

	async up(queryRunner) {
		await queryRunner.query(`ALTER TABLE "user" ADD "atDid" varchar(256)`);
		await queryRunner.query(`CREATE UNIQUE INDEX "IDX_user_atDid" ON "user" ("atDid") WHERE "atDid" IS NOT NULL`);
	}

	async down(queryRunner) {
		await queryRunner.query(`DROP INDEX "public"."IDX_user_atDid"`);
		await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "atDid"`);
	}
}
