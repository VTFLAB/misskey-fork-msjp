/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { MobType } from './constants.js';

export type Vec3 = { x: number; y: number; z: number };

/** インベントリの 1 枠。null は空 */
export type ItemStack = { id: number; count: number } | null;

export type PlayerStats = {
	/** 0..20 (半分刻み) */
	health: number;
	/** 0..20 */
	hunger: number;
	/** 残りの息 (秒)。0..PLAYER.maxAir */
	air: number;
};

/** ホストが配信する MOB の状態 */
export type MobState = {
	id: string;
	type: MobType;
	x: number;
	y: number;
	z: number;
	yaw: number;
	hp: number;
	/** 追っているプレイヤーの userId */
	target: string | null;
	/** 直近の攻撃の時刻 (performance.now ではなく Date.now、配信用) */
	attackAt: number;
};

/** ストリームで配信する MOB のスナップショット */
export type MobSnapshot = {
	hostId: string;
	/** Date.now() */
	t: number;
	mobs: MobState[];
};

/** ストリームで送る MOB への攻撃 */
export type MobHit = {
	id: string;
	damage: number;
	/** ノックバックの方向 (水平、正規化済み) */
	kx: number;
	kz: number;
};

/** 他プレイヤーの表示に必要な情報 */
export type RemotePlayerInfo = {
	userId: string;
	username: string;
	name: string | null;
	avatarUrl: string | null;
	skinUrl: string | null;
};

/**
 * 1 フレーム分の入力。キーボード・マウス・タッチのどれからでも同じ形に正規化する。
 * look* と *Delta は毎フレーム消費 (0 に戻す) する蓄積値。
 */
export type InputState = {
	forward: boolean;
	back: boolean;
	left: boolean;
	right: boolean;
	jump: boolean;
	sneak: boolean;
	sprint: boolean;
	/** 視点の回転 (ラジアン)。消費側で 0 に戻す */
	lookDX: number;
	lookDY: number;
	/** 攻撃 / 採掘ボタンを押し続けている */
	attack: boolean;
	/** 設置 / 使用が押された (エッジ、消費側で false に戻す) */
	usePressed: boolean;
	/** ホットバーの移動量 (ホイール)。消費側で 0 に戻す */
	hotbarDelta: number;
	/** 数字キーなどで直接選んだ枠。消費側で null に戻す */
	hotbarSelect: number | null;
	/** インベントリを開閉する (エッジ) */
	togglePressed: boolean;
};

export function emptyInput(): InputState {
	return {
		forward: false, back: false, left: false, right: false,
		jump: false, sneak: false, sprint: false,
		lookDX: 0, lookDY: 0,
		attack: false, usePressed: false,
		hotbarDelta: 0, hotbarSelect: null,
		togglePressed: false,
	};
}

export type BlockHit = {
	x: number;
	y: number;
	z: number;
	/** 当たった面の法線 */
	nx: number;
	ny: number;
	nz: number;
	/** 視点からの距離 */
	dist: number;
};
