/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { BLOCK, BLOCK_DEFS, ITEM, ITEM_DEFS } from './constants.js';
import type { ItemDef } from './constants.js';
import { enchantLevel } from './items.js';
import type { ItemStack } from './types.js';

export function heldTool(stack: ItemStack): ItemDef['tool'] | undefined {
	if (stack == null) return undefined;
	return ITEM_DEFS[stack.id]?.tool;
}

/** 剣はブロックの採掘にもドロップ条件にも数えない */
function blockTool(stack: ItemStack): ItemDef['tool'] | undefined {
	const tool = heldTool(stack);
	return tool != null && tool.kind !== 'sword' ? tool : undefined;
}

export function canHarvest(blockId: number, stack: ItemStack): boolean {
	const def = BLOCK_DEFS[blockId];
	if (def == null) return false;
	if (def.minTier <= 0) return true;
	const tool = blockTool(stack);
	return tool != null && tool.kind === def.tool && tool.tier >= def.minTier;
}

export type BreakContext = {
	inWater: boolean;
	onGround: boolean;
	/** 採掘速度上昇 (Haste) のレベル。0 なら無し */
	haste: number;
	/** 水中採掘 (Aqua Affinity) を持つ */
	aquaAffinity: boolean;
};

const DEFAULT_CTX: BreakContext = { inWater: false, onGround: true, haste: 0, aquaAffinity: false };

/** 壊すのにかかる秒数 (Minecraft の式。1 tick = 0.05 秒に切り上げる) */
export function breakTime(blockId: number, stack: ItemStack, ctx: BreakContext = DEFAULT_CTX): number {
	const def = BLOCK_DEFS[blockId];
	if (def == null || !Number.isFinite(def.hardness)) return Infinity;
	if (def.hardness <= 0) return 0.05;
	const tool = blockTool(stack);
	let speed = 1;
	if (tool != null && def.tool !== 'none' && tool.kind === def.tool) {
		speed = tool.speed;
		const eff = enchantLevel(stack, 'efficiency');
		if (eff > 0) speed += eff * eff + 1;
	}
	if (ctx.haste > 0) speed *= 1 + 0.2 * ctx.haste;
	if (ctx.inWater && !ctx.aquaAffinity) speed /= 5;
	if (!ctx.onGround) speed /= 5;
	const perTick = speed / def.hardness / (canHarvest(blockId, stack) ? 30 : 100);
	if (perTick >= 1) return 0.05;
	return Math.max(1, Math.ceil(1 / perTick - 1e-6)) / 20;
}

/** 幸運による個数の倍率 (1 以上)。Minecraft: random(level + 2) - 1、負なら 0、倍率は 1 + それ */
function fortuneMultiplier(level: number, random: () => number): number {
	if (level <= 0) return 1;
	const bonus = Math.floor(random() * (level + 2)) - 1;
	return 1 + Math.max(0, bonus);
}

/** 壊したときに手に入る物。ツールが合わなければ空 */
export function dropsFor(blockId: number, stack: ItemStack, random: () => number = Math.random): NonNullable<ItemStack>[] {
	const def = BLOCK_DEFS[blockId];
	if (def == null || !canHarvest(blockId, stack)) return [];
	if (def.silk === true && enchantLevel(stack, 'silkTouch') > 0) {
		return [{ id: blockId, count: 1 }];
	}
	const fortune = enchantLevel(stack, 'fortune');
	if (blockId === BLOCK.leaves) {
		const out: NonNullable<ItemStack>[] = [];
		const sapling = [0.05, 0.0625, 0.0833, 0.1][Math.min(3, fortune)];
		if (random() < sapling) out.push({ id: BLOCK.sapling, count: 1 });
		if (random() < (fortune > 0 ? 0.005 * (1 + fortune * 0.2) : 0.005)) out.push({ id: ITEM.apple, count: 1 });
		return out;
	}
	if (def.drops == null) return [];
	if (def.drops.chance != null && random() >= def.drops.chance) return [];
	let count = def.drops.count ?? 1;
	if (def.fortune === true) count *= fortuneMultiplier(fortune, random);
	const out: NonNullable<ItemStack>[] = [{ id: def.drops.id, count }];
	// 実った小麦は種も落とす
	if (blockId === BLOCK.wheat3) out.push({ id: ITEM.wheatSeeds, count: 1 + Math.floor(random() * 3) + (fortune > 0 ? Math.floor(random() * (fortune + 1)) : 0) });
	return out;
}

/** 壊したときの経験値。シルクタッチなら 0 */
export function blockXp(blockId: number, stack: ItemStack, random: () => number = Math.random): number {
	const def = BLOCK_DEFS[blockId];
	if (def?.xp == null || !canHarvest(blockId, stack)) return 0;
	if (def.silk === true && enchantLevel(stack, 'silkTouch') > 0) return 0;
	const [lo, hi] = def.xp;
	return lo + Math.floor(random() * (hi - lo + 1));
}

/** 素手 (道具でない物を持っているときも同じ) の攻撃速度 (回/秒) */
const FIST_ATTACK_SPEED = 4;

export function attackCooldownSeconds(stack: ItemStack): number {
	return 1 / (heldTool(stack)?.attackSpeed ?? FIST_ATTACK_SPEED);
}

/** 前回の攻撃から secondsSince 経ったときの充填率 (0..1) */
export function attackCharge(stack: ItemStack, secondsSince: number): number {
	return Math.max(0, Math.min(1, secondsSince / attackCooldownSeconds(stack)));
}

/** 落下中 (地上でない・水中でない・走っていない) に充填が十分なら会心 */
export function isCriticalHit(ctx: { falling: boolean; onGround: boolean; inWater: boolean; sprinting: boolean; onLadder?: boolean; charge: number }): boolean {
	return ctx.falling && !ctx.onGround && !ctx.inWater && !ctx.sprinting && ctx.onLadder !== true && ctx.charge > 0.9;
}

/**
 * 攻撃のダメージ。charge は 0..1 の充填率、critical は会心 (1.5 倍)。
 * strength は Strength 効果のレベル (1 レベルにつき +3)
 */
export function attackDamage(stack: ItemStack, charge = 1, critical = false, strength = 0): number {
	const base = (heldTool(stack)?.attack ?? 1) + strength * 3;
	const sharp = enchantLevel(stack, 'sharpness');
	const bonus = sharp > 0 ? 0.5 * sharp + 0.5 : 0;
	const c = Math.max(0, Math.min(1, charge));
	// 鋭さの加算は充填率に比例し、会心の倍率は掛からない
	const dmg = base * (0.2 + 0.8 * c * c) * (critical ? 1.5 : 1) + bonus * c;
	return dmg;
}

/** ノックバックの強さ (Knockback のレベル + 走っているなら 1) */
export function knockbackStrength(stack: ItemStack, sprinting: boolean): number {
	return enchantLevel(stack, 'knockback') + (sprinting ? 1 : 0);
}

/** ブロックを 1 つ壊したときに減る耐久。柔らかさ 0 のブロックでは減らない */
export function durabilityCostPerBlock(stack: ItemStack, blockId?: number): number {
	const def = ITEM_DEFS[stack?.id ?? -1];
	if (stack == null || def?.tool == null || def.durability == null) return 0;
	if (blockId != null && (BLOCK_DEFS[blockId]?.hardness ?? 1) <= 0) return 0;
	return def.tool.kind === 'sword' ? 2 : 1;
}

/** 1 回殴ったときに減る耐久 (剣 1、その他の道具 2) */
export function durabilityCostPerAttack(stack: ItemStack): number {
	const def = ITEM_DEFS[stack?.id ?? -1];
	if (stack == null || def?.tool == null || def.durability == null) return 0;
	return def.tool.kind === 'sword' ? 1 : 2;
}
