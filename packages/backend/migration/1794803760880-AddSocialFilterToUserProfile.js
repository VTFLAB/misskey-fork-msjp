/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// bsky-fork 独自: 社会性フィルターをユーザーが有効にしたか
export class AddSocialFilterToUserProfile1794803760880 {
	name = 'AddSocialFilterToUserProfile1794803760880';

	async up(queryRunner) {
		await queryRunner.query('ALTER TABLE "user_profile" ADD "socialFilter" boolean NOT NULL DEFAULT false');
	}

	async down(queryRunner) {
		await queryRunner.query('ALTER TABLE "user_profile" DROP COLUMN "socialFilter"');
	}
}
