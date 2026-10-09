/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { EnchantId, MobType } from './constants.js';

export type Vec3 = { x: number; y: number; z: number };

/**
 * インベントリの 1 枠。null は空。
 * dmg は消費した耐久値 (0 = 新品)、ench はエンチャント (id と level)。ench を持つ枠は重ならない。
 */
export type ItemStack = {
	id: number;
	count: number;
	dmg?: number;
	ench?: [EnchantId, number][];
} | null;

/** 保存形式: [id, count] または [id, count, dmg, ench] */
export type SerializedStack = [number, number] | [number, number, number, [string, number][]] | null;

export type PlayerStats = {
	/** 0..20 (半分刻み) */
	health: number;
	/** 0..20 */
	hunger: number;
	/** 隠し満腹度 0..hunger */
	saturation: number;
	/** 残りの息 (秒)。0..PLAYER.maxAir */
	air: number;
	/** 防具による防御点 (0..20)。表示用。防具の変更時に計算し直す */
	armor: number;
	/** 現在のレベル */
	level: number;
	/** 次のレベルまでの進捗 (0..1) */
	xpProgress: number;
	/** 累計で得た経験値 (表示・デバッグ用) */
	totalXp: number;
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
	/**
	 * 直近の攻撃の時刻 (performance.now ではなく Date.now、配信用)。
	 * クリーパーは導火線に火がついた時刻、スケルトンは矢を放った時刻を入れる
	 */
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
	/** 設置 / 使用を押し続けている (弓を引く・食べ続ける) */
	use: boolean;
	/** ホットバーの移動量 (ホイール)。消費側で 0 に戻す */
	hotbarDelta: number;
	/** 数字キーなどで直接選んだ枠。消費側で null に戻す */
	hotbarSelect: number | null;
	/** インベントリを開閉する (エッジ) */
	togglePressed: boolean;
	/** 全画面を切り替える (エッジ) */
	fullscreenPressed: boolean;
	/** 手に持っている物を捨てる (エッジ)。Q */
	dropPressed: boolean;
};

export function emptyInput(): InputState {
	return {
		forward: false, back: false, left: false, right: false,
		jump: false, sneak: false, sprint: false,
		lookDX: 0, lookDY: 0,
		attack: false, usePressed: false, use: false,
		hotbarDelta: 0, hotbarSelect: null,
		togglePressed: false,
		fullscreenPressed: false,
		dropPressed: false,
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

/** 効果音の種類。audio.ts が合成する */
export type SoundId =
	| 'step' | 'break' | 'place' | 'hit' | 'fall'
	| 'hurt' | 'death' | 'eat' | 'burp' | 'drink'
	| 'attackWeak' | 'attackStrong' | 'attackCrit' | 'attackKnockback' | 'attackSweep' | 'attackNoDamage'
	| 'bowDraw' | 'bowShoot' | 'arrowHit'
	| 'levelUp' | 'xp' | 'pickup' | 'enchant' | 'gachaRoll' | 'gachaWin' | 'click'
	| 'craft' | 'furnace' | 'equip'
	| 'splash' | 'swim' | 'ladder'
	| 'mobHurt' | 'mobDeath' | 'mobAmbient' | 'creeperFuse' | 'explosion'
	| 'thunder' | 'rain';

/** ブロックの足音・破壊音の素材 */
export type SoundMaterial = 'stone' | 'wood' | 'gravel' | 'grass' | 'sand' | 'snow' | 'glass' | 'wool' | 'metal' | 'crop' | 'water' | 'none';

/** 粒子 (パーティクル) の種類 */
export type ParticleKind = 'block' | 'crit' | 'smoke' | 'flame' | 'splash' | 'bubble' | 'heart' | 'enchant' | 'explosion' | 'xp';

/** 状態効果 (ポーション無しでも、金のリンゴや環境で付く) */
export type EffectId = 'regeneration' | 'speed' | 'haste' | 'strength' | 'resistance' | 'slowness' | 'hunger' | 'absorption' | 'nightVision' | 'waterBreathing';

export type ActiveEffect = { id: EffectId; level: number; until: number };
