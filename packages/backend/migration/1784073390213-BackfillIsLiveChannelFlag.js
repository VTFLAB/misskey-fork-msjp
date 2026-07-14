/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class BackfillIsLiveChannelFlag1784073390213 {
    name = 'BackfillIsLiveChannelFlag1784073390213';

    async up(queryRunner) {
        await queryRunner.query(`UPDATE "channel" SET "isLiveChannel" = TRUE WHERE "id" IN (SELECT "channelId" FROM "live_channel" WHERE "channelId" IS NOT NULL)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`UPDATE "channel" SET "isLiveChannel" = FALSE WHERE "id" IN (SELECT "channelId" FROM "live_channel" WHERE "channelId" IS NOT NULL)`);
    }
}
