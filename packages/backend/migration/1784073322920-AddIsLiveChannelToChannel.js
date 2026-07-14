/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class AddIsLiveChannelToChannel1784073322920 {
    name = 'AddIsLiveChannelToChannel1784073322920';

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "channel" ADD "isLiveChannel" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`COMMENT ON COLUMN "channel"."isLiveChannel" IS 'Whether this channel is a live-channel (self-streaming) backing channel, excluded from native channel discovery (bsky-fork独自).'`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "channel" DROP COLUMN "isLiveChannel"`);
    }
}
