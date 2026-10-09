/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { BLOCK_DEFS, EXHAUSTION, ITEM, ITEM_DEFS, PLAYER, xpToNextLevel } from './constants.js';
import { Inventory } from './inventory.js';
import { enchantLevel, repairItem } from './items.js';
import { lookDir } from './math.js';
import { GRAVITY, MAX_FALL_SPEED, blockBelow, collides, isHeadInWater, isInWater, isOnIce, isOnLadder, moveEntity, overlapsBlock, raycastBlocks } from './physics.js';
import type { ActiveEffect, BlockHit, EffectId, InputState, ItemStack, PlayerStats, Vec3 } from './types.js';
import type { CraftWorld } from './world.js';

export type DamageKind = 'mob' | 'arrow' | 'fall' | 'drown' | 'starve' | 'cactus' | 'void' | 'explosion' | 'thorns' | 'fire';

export type DamageSource = {
	kind: DamageKind;
	/** ノックバックの方向 (水平、正規化済み) */
	kx?: number;
	kz?: number;
	/** 攻撃側のノックバック強化 (Knockback / Punch のレベル) */
	knockback?: number;
	bypassArmor?: boolean;
};

export type PlayerEvents = {
	died: boolean;
	/** 前回の update からこのフレームまでに受けた実ダメージの合計 */
	damaged: number;
	landed: { distance: number; blockId: number } | null;
	/** このフレームに足音を鳴らすなら、足元のブロック id */
	stepped: number | null;
	jumped: boolean;
	swimmingStroke: boolean;
	climbing: boolean;
	ateFinished: { id: number } | null;
	drowningTick: boolean;
	levelUp: boolean;
	xpGained: number;
	/** 壊れた防具・道具の item id */
	itemBroke: number | null;
};

export type Pose = 'standing' | 'sneaking' | 'swimming';

const MAX_DT = 0.05;
const HURT_MS = 500;
const INVULN_MS = 500;
const AIR_CONTROL = 0.6;
const KNOCKBACK_LOCK_MS = 400;
const SWIM_SPRINT_SPEED = 3.92;
const WATER_WALK_FACTOR = 0.454;
const EXHAUST_ON_HIT: DamageKind[] = ['mob', 'arrow', 'explosion', 'thorns', 'cactus', 'fire'];
const EAT_SECONDS = 1.6;
const BOW_FULL_SECONDS = 1.0;
const SPRINT_FOV = 1.15;
const SPRINT_FOV_RATE = (SPRINT_FOV - 1) / 0.2;
const EYE_RATE = 8;
const STEP_DISTANCE = 1 / 0.6;
const STROKE_DISTANCE = 1.5;

const POSE_HEIGHT: Record<Pose, number> = { standing: PLAYER.height, sneaking: PLAYER.sneakHeight, swimming: PLAYER.swimHeight };
const POSE_EYE: Record<Pose, number> = { standing: PLAYER.eyeHeight, sneaking: PLAYER.sneakEyeHeight, swimming: PLAYER.swimEyeHeight };

const ARMOR_DAMAGING: DamageKind[] = ['mob', 'arrow', 'explosion', 'cactus', 'fire'];
const ARMOR_BYPASS: DamageKind[] = ['fall', 'drown', 'starve', 'void'];

function newEvents(): PlayerEvents {
	return { died: false, damaged: 0, landed: null, stepped: null, jumped: false, swimmingStroke: false, climbing: false, ateFinished: null, drowningTick: false, levelUp: false, xpGained: 0, itemBroke: null };
}

export class Player {
	public readonly pos: Vec3 = { x: 0, y: 0, z: 0 };
	public readonly vel: Vec3 = { x: 0, y: 0, z: 0 };
	public yaw = 0;
	public pitch = 0;
	public onGround = false;
	public readonly stats: PlayerStats = { health: PLAYER.maxHealth, hunger: PLAYER.maxHunger, saturation: 5, air: PLAYER.maxAir, armor: 0, level: 0, xpProgress: 0, totalXp: 0 };
	public readonly inventory = new Inventory();
	public hotbarIndex = 0;
	/** この時刻 (now の単位) まで被弾の赤み・無敵が続く */
	public hurtUntil = 0;
	public isDead = false;
	public effects: ActiveEffect[] = [];
	/** 吸収ハート (Absorption) の残り。health に足される緩衝 */
	public absorption = 0;

	public pose: Pose = 'standing';
	public isSprinting = false;
	public onLadder = false;
	/** 1..1.15。走っているときの視野の広がり */
	public fovScale = 1;
	/** 目の高さ (足元から)。姿勢の変化に追従して滑らかに動く */
	public eyeHeight: number = PLAYER.eyeHeight;
	/** 地上を歩いた距離の累計 (ボブ・足音用) */
	public walkDistance = 0;
	/** 食べる・弓を引く進み具合 0..1 */
	public useProgress = 0;
	public using = false;

	private xpInLevel = 0;
	private fallTopY = 0;
	private exhaustion = 0;
	private regenTimer = 0;
	private fastRegenTimer = 0;
	private starveTimer = 0;
	private effectRegenTimer = 0;
	private airSeconds: number = PLAYER.maxAir;
	private drownTimer = 0;
	private cactusTimer = 0;
	private voidTimer = 0;
	private invulnUntil = 0;
	private lastDamage = 0;
	private hurtStart = -1e9;
	private hurtDir = 1;
	private lastNow = 0;
	private knockUntil = 0;
	private hitWall = false;
	private stepAcc = 0;
	private strokeAcc = 0;
	private usingSlot = -1;
	private usingId = -1;
	private usingTime = 0;

	private pendDamaged = 0;
	private pendLevelUp = false;
	private pendXp = 0;
	private pendBroke: number | null = null;
	private pendDied = false;

	constructor(private world: CraftWorld) {
	}

	// ----- 状態 -----

	public get heightNow(): number {
		return POSE_HEIGHT[this.pose];
	}

	public get isSneaking(): boolean {
		return this.pose === 'sneaking';
	}

	public get isSwimming(): boolean {
		return this.pose === 'swimming';
	}

	public get eyeY(): number {
		return this.pos.y + this.eyeHeight;
	}

	public get selectedStack(): ItemStack {
		return this.inventory.slots[this.hotbarIndex] ?? null;
	}

	public get levelsAvailable(): number {
		return this.stats.level;
	}

	public get totalXp(): number {
		return this.stats.totalXp;
	}

	public effectLevel(id: EffectId): number {
		let lvl = 0;
		for (const e of this.effects) if (e.id === id && e.level > lvl) lvl = e.level;
		return lvl;
	}

	/** 採掘速度上昇 (Haste) のレベル。mining.breakTime の ctx.haste に渡す */
	public get hasteLevel(): number {
		return this.effectLevel('haste');
	}

	public get strengthLevel(): number {
		return this.effectLevel('strength');
	}

	public get aquaAffinity(): boolean {
		return this.inventory.armorEnchantLevel('aquaAffinity') > 0;
	}

	public get inWater(): boolean {
		return isInWater(this.world, this.pos, this.heightNow);
	}

	/** inWater の別名 (engine 用) */
	public get isInWater(): boolean {
		return this.inWater;
	}

	/** 水平の速さ (ブロック/秒) */
	public get horizontalSpeed(): number {
		return Math.hypot(this.vel.x, this.vel.z);
	}

	public get headInWater(): boolean {
		return isHeadInWater(this.world, this.pos, this.eyeHeight);
	}

	/** 息の最大 (秒)。Respiration 1 レベルごとに基本の 1 倍ずつ増える */
	private get maxAirSeconds(): number {
		return PLAYER.maxAir * (1 + this.inventory.armorEnchantLevel('respiration'));
	}

	public addEffect(id: EffectId, level: number, seconds: number): void {
		const until = this.lastNow + seconds * 1000;
		const cur = this.effects.find(e => e.id === id);
		if (cur != null) {
			// より強い、または同じ強さで長い効果で置き換える
			if (level > cur.level || (level === cur.level && until > cur.until)) {
				cur.level = level;
				cur.until = until;
			}
		} else {
			this.effects.push({ id, level, until });
		}
		if (id === 'absorption') this.absorption = Math.max(this.absorption, 4 * level);
	}

	public addExhaustion(n: number): void {
		if (n > 0 && !this.isDead) this.exhaustion += n;
	}

	// ----- 出現・復活 -----

	public spawn(x: number, z: number): void {
		this.pos.x = x;
		this.pos.z = z;
		this.pos.y = this.world.surfaceY(Math.floor(x), Math.floor(z));
		this.vel.x = 0;
		this.vel.y = 0;
		this.vel.z = 0;
		this.onGround = false;
		this.fallTopY = this.pos.y;
		this.pose = 'standing';
		this.eyeHeight = PLAYER.eyeHeight;
	}

	public respawn(x: number, z: number): void {
		this.spawn(x, z);
		this.stats.health = PLAYER.maxHealth;
		this.stats.hunger = PLAYER.maxHunger;
		this.stats.saturation = 5;
		this.airSeconds = this.maxAirSeconds;
		this.stats.air = PLAYER.maxAir;
		this.isDead = false;
		this.effects = [];
		this.absorption = 0;
		this.exhaustion = 0;
		this.regenTimer = 0;
		this.fastRegenTimer = 0;
		this.starveTimer = 0;
		this.effectRegenTimer = 0;
		this.drownTimer = 0;
		this.cactusTimer = 0;
		this.voidTimer = 0;
		this.invulnUntil = 0;
		this.lastDamage = 0;
		this.hurtUntil = 0;
		this.hurtStart = -1e9;
		this.isSprinting = false;
		this.fovScale = 1;
		this.stopUsing();
		this.pendDied = false;
		this.syncStats();
	}

	// ----- ダメージ -----

	/**
	 * ダメージを与える。防具・エンチャント・効果で軽減した後の実ダメージを返す。
	 * 被弾後 0.5 秒は無敵で、その間は前回より大きい攻撃の差分だけが通る。
	 */
	public damage(amount: number, source: DamageSource, now: number): number {
		if (this.isDead || amount <= 0) return 0;
		let incoming = amount;
		if (now < this.invulnUntil) {
			if (amount <= this.lastDamage) return 0;
			incoming = amount - this.lastDamage;
			this.lastDamage = amount;
		} else {
			this.invulnUntil = now + INVULN_MS;
			this.lastDamage = amount;
		}
		let dmg = incoming;
		const kind = source.kind;
		const bypass = source.bypassArmor ?? ARMOR_BYPASS.includes(kind);
		if (!bypass) {
			const armor = this.inventory.armorPoints();
			const toughness = this.inventory.armorToughness();
			const defense = Math.max(0, Math.min(20, Math.max(armor / 5, armor - 4 * dmg / (toughness + 8))));
			dmg *= 1 - defense / 25;
		}
		if (kind !== 'starve' && kind !== 'void') {
			let epf = this.inventory.armorEnchantLevel('protection');
			if (kind === 'fall') epf += 3 * this.inventory.armorEnchantLevel('featherFalling');
			epf = Math.min(20, epf);
			dmg *= 1 - epf / 25;
		}
		const resistance = this.effectLevel('resistance');
		if (resistance > 0 && kind !== 'void') dmg *= Math.max(0, 1 - 0.2 * resistance);
		if (this.absorption > 0) {
			const take = Math.min(this.absorption, dmg);
			this.absorption -= take;
			dmg -= take;
		}
		this.stats.health = Math.max(0, this.stats.health - dmg);
		this.pendDamaged += dmg;
		this.hurtStart = now;
		this.hurtUntil = now + HURT_MS;
		this.hurtDir = Math.random() < 0.5 ? -1 : 1;
		if (EXHAUST_ON_HIT.includes(kind)) this.addExhaustion(EXHAUSTION.damaged);

		if (ARMOR_DAMAGING.includes(kind) && !bypass) {
			const broke = this.inventory.damageArmor(Math.max(1, Math.floor(incoming / 4)));
			if (broke.length > 0) this.pendBroke = broke[0];
		}
		if ((source.kx != null || source.kz != null) && (source.kx !== 0 || source.kz !== 0)) {
			const units = source.knockback ?? 0;
			const k = units > 0 ? 4 + 4 * units : 6;
			this.vel.x = this.vel.x * 0.5 + (source.kx ?? 0) * k;
			this.vel.z = this.vel.z * 0.5 + (source.kz ?? 0) * k;
			if (this.onGround) {
				this.vel.y = Math.max(this.vel.y, 6);
				this.onGround = false;
			}
			this.knockUntil = now + KNOCKBACK_LOCK_MS;
		}
		if (this.stats.health <= 0) {
			this.isDead = true;
			this.pendDied = true;
			this.stopUsing();
		}
		return dmg;
	}

	/** 被弾時の画面の傾き (ラジアン)。0.5 秒かけて元に戻る */
	public hurtTilt(now: number): number {
		const t = (now - this.hurtStart) / HURT_MS;
		if (t < 0 || t >= 1) return 0;
		return 0.14 * this.hurtDir * (1 - t);
	}

	// ----- 経験値 -----

	/** 経験値を足す。レベルが上がったら levelUp イベントが立つ。Mending 付きの装備があれば修理に使う */
	public addXp(amount: number): void {
		if (amount <= 0 || this.isDead) return;
		let n = amount;
		const mendable: NonNullable<ItemStack>[] = [];
		const held = this.selectedStack;
		if (held != null && enchantLevel(held, 'mending') > 0 && (held.dmg ?? 0) > 0) mendable.push(held);
		for (let i = 0; i < PLAYER.armorSlots; i++) {
			const a = this.inventory.slots[PLAYER.armorSlotStart + i];
			if (a != null && enchantLevel(a, 'mending') > 0 && (a.dmg ?? 0) > 0) mendable.push(a);
		}
		if (mendable.length > 0) {
			const target = mendable[Math.floor(Math.random() * mendable.length)];
			const repaired = repairItem(target, Math.floor(n * 2));
			n -= Math.ceil(repaired / 2);
		}
		this.pendXp += amount;
		this.stats.totalXp += amount;
		if (n <= 0) {
			this.syncStats();
			return;
		}
		this.xpInLevel += n;
		let need = xpToNextLevel(this.stats.level);
		while (this.xpInLevel >= need) {
			this.xpInLevel -= need;
			this.stats.level++;
			this.pendLevelUp = true;
			need = xpToNextLevel(this.stats.level);
		}
		this.syncStats();
	}

	/** レベルを n 消費する (エンチャント台)。足りなければ false */
	public spendLevels(n: number): boolean {
		if (n < 0 || this.stats.level < n) return false;
		this.stats.level -= n;
		this.xpInLevel = Math.min(this.xpInLevel, Math.max(0, xpToNextLevel(this.stats.level) - 1));
		this.syncStats();
		return true;
	}

	/** 死亡時に経験値を全部失う (累計 totalXp は変えない) */
	public loseAllXp(): void {
		this.stats.level = 0;
		this.xpInLevel = 0;
		this.syncStats();
	}

	// ----- 使う (食べる・弓) -----

	/** 持っている物を使い始める。食べられる・引ける物でなければ false */
	public startUsing(now: number): boolean {
		void now;
		if (this.isDead || this.using) return false;
		const stack = this.selectedStack;
		if (stack == null) return false;
		const def = ITEM_DEFS[stack.id];
		if (def == null) return false;
		if (def.food != null) {
			if (this.stats.hunger >= PLAYER.maxHunger && def.food.alwaysEdible !== true) return false;
		} else if (def.kind === 'bow') {
			if (this.inventory.findSlot(ITEM.arrow) < 0 && enchantLevel(stack, 'infinity') <= 0) return false;
		} else {
			return false;
		}
		this.using = true;
		this.usingSlot = this.hotbarIndex;
		this.usingId = stack.id;
		this.usingTime = 0;
		this.useProgress = 0;
		return true;
	}

	/** 使うのをやめる。やめた時点の進み具合 (弓の引き絞り 0..1) を返す */
	public stopUsing(): number {
		const p = this.using ? this.useProgress : 0;
		this.using = false;
		this.usingSlot = -1;
		this.usingId = -1;
		this.usingTime = 0;
		this.useProgress = 0;
		return p;
	}

	private finishEating(events: PlayerEvents): void {
		const stack = this.inventory.slots[this.usingSlot];
		const food = stack != null ? ITEM_DEFS[stack.id]?.food : undefined;
		const id = this.usingId;
		this.stopUsing();
		if (stack == null || food == null) return;
		this.inventory.take(this.hotbarIndex, 1);
		this.stats.hunger = Math.min(PLAYER.maxHunger, this.stats.hunger + food.nutrition);
		this.stats.saturation = Math.min(this.stats.hunger, this.stats.saturation + food.saturation);
		if (food.effect != null) this.addEffect(food.effect.id, food.effect.level, food.effect.seconds);
		if (id === ITEM.goldenApple) this.addEffect('absorption', 1, 120);
		events.ateFinished = { id };
	}

	// ----- 保存・表示 -----

	private syncStats(): void {
		this.stats.armor = this.inventory.armorPoints();
		this.stats.xpProgress = this.xpInLevel / xpToNextLevel(this.stats.level);
		this.stats.air = Math.max(0, Math.min(PLAYER.maxAir, this.airSeconds / this.maxAirSeconds * PLAYER.maxAir));
	}

	public exportStats(): PlayerStats {
		this.syncStats();
		return { ...this.stats };
	}

	/** サーバーやローカルに保存した状態を戻す */
	public restoreStats(s: Partial<PlayerStats>): void {
		const num = (v: unknown, lo: number, hi: number, d: number): number => typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d;
		this.stats.health = num(s.health, 1, PLAYER.maxHealth, PLAYER.maxHealth);
		this.stats.hunger = num(s.hunger, 0, PLAYER.maxHunger, PLAYER.maxHunger);
		this.stats.saturation = num(s.saturation, 0, this.stats.hunger, Math.min(5, this.stats.hunger));
		this.stats.level = Math.floor(num(s.level, 0, 1000, 0));
		this.stats.totalXp = num(s.totalXp, 0, 1e9, 0);
		this.xpInLevel = Math.floor(num(s.xpProgress, 0, 0.999, 0) * xpToNextLevel(this.stats.level));
		this.airSeconds = this.maxAirSeconds;
		this.syncStats();
	}

	/** restoreStats の別名 (値は範囲に丸める) */
	public loadStats(stats: PlayerStats): void {
		this.restoreStats(stats);
	}

	public overlapsBlock(bx: number, by: number, bz: number): boolean {
		return overlapsBlock(this.pos, PLAYER.width, this.heightNow, bx, by, bz);
	}

	public raycast(maxDist: number = PLAYER.reach): BlockHit | null {
		return raycastBlocks(this.world, this.pos.x, this.eyeY, this.pos.z, this.yaw, this.pitch, maxDist);
	}

	/** 体に触れているダメージブロック (サボテン) があるか */
	private touchesDamaging(): boolean {
		const half = PLAYER.width / 2;
		const bx = Math.floor(this.pos.x), bz = Math.floor(this.pos.z);
		const ys = [Math.floor(this.pos.y), Math.floor(this.pos.y + this.heightNow - 0.01)];
		const xs = [Math.floor(this.pos.x - half - 0.05), Math.floor(this.pos.x + half + 0.05)];
		const zs = [Math.floor(this.pos.z - half - 0.05), Math.floor(this.pos.z + half + 0.05)];
		const check = (x: number, y: number, z: number): boolean => BLOCK_DEFS[this.world.getBlock(x, y, z)]?.damaging === true;
		for (const y of ys) {
			if (check(bx, y, bz)) return true;
			for (const x of xs) if (check(x, y, bz)) return true;
			for (const z of zs) if (check(bx, y, z)) return true;
		}
		return false;
	}

	/** 立ち上がる余地があるときだけ姿勢を変える */
	private updatePose(wantSwim: boolean, wantSneak: boolean): void {
		const want: Pose = wantSwim ? 'swimming' : (wantSneak ? 'sneaking' : 'standing');
		if (want === this.pose) return;
		const h = POSE_HEIGHT[want];
		if (h > this.heightNow && collides(this.world, this.pos.x, this.pos.y, this.pos.z, PLAYER.width, h)) {
			// 天井が低くて立てない。泳ぎから戻れないときはしゃがみに近い高さまで
			if (this.pose === 'swimming' && !collides(this.world, this.pos.x, this.pos.y, this.pos.z, PLAYER.width, PLAYER.sneakHeight)) this.pose = 'sneaking';
			return;
		}
		this.pose = want;
	}

	// ----- 毎フレーム -----

	public update(dtRaw: number, input: InputState, now: number, ctx: { nearMobs?: unknown } = {}): PlayerEvents {
		void ctx;
		const events = newEvents();
		this.lastNow = now;
		if (this.isDead) {
			this.vel.x = 0;
			this.vel.y = 0;
			this.vel.z = 0;
			this.fovScale = 1;
			events.died = this.pendDied;
			this.pendDied = false;
			events.damaged = this.pendDamaged;
			this.pendDamaged = 0;
			return events;
		}
		const dt = Math.min(Math.max(dtRaw, 0), MAX_DT);
		const world = this.world;

		// 視点
		this.yaw += input.lookDX;
		this.pitch = Math.max(-(Math.PI / 2 - 0.01), Math.min(Math.PI / 2 - 0.01, this.pitch + input.lookDY));

		// 効果の期限
		if (this.effects.length > 0) {
			const had = this.effectLevel('absorption') > 0;
			this.effects = this.effects.filter(e => e.until > now);
			if (had && this.effectLevel('absorption') === 0) this.absorption = 0;
		}

		// 食べる・弓: 持ち替えたら中断
		if (this.using) {
			const s = this.inventory.slots[this.usingSlot];
			if (this.hotbarIndex !== this.usingSlot || s == null || s.id !== this.usingId) this.stopUsing();
		}

		const inWaterBefore = isInWater(world, this.pos, this.heightNow);
		const hasFood = this.stats.hunger > 6;
		const wantSwim = inWaterBefore && input.sprint && hasFood && !input.sneak;
		this.updatePose(wantSwim, input.sneak && !wantSwim);
		const sneaking = this.pose === 'sneaking';
		const swimming = this.pose === 'swimming';
		const h = this.heightNow;
		const inWater = isInWater(world, this.pos, h);
		const headInWater = isHeadInWater(world, this.pos, POSE_EYE[this.pose]);
		const onLadder = isOnLadder(world, this.pos, PLAYER.width, h);
		this.onLadder = onLadder;

		// 走る。壁にぶつかる・空腹・しゃがみ・使用中は止まる
		const moving = input.forward || input.back || input.left || input.right;
		this.isSprinting = !swimming && !sneaking && input.sprint && input.forward && hasFood && !this.hitWall && !this.using;

		// 移動速度
		let speed = swimming ? SWIM_SPRINT_SPEED : (sneaking ? PLAYER.sneakSpeed : (this.isSprinting ? PLAYER.sprintSpeed : PLAYER.walkSpeed));
		const speedLvl = this.effectLevel('speed');
		if (speedLvl > 0) speed *= 1 + 0.2 * speedLvl;
		const slowLvl = this.effectLevel('slowness');
		if (slowLvl > 0) speed *= Math.max(0, 1 - 0.15 * slowLvl);
		if (this.using) speed *= 0.2;
		if (inWater && !swimming) speed *= WATER_WALK_FACTOR;
		if (onLadder) speed *= 0.6;

		const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
		let mx = 0, mz = 0;
		if (input.forward) { mx -= sin; mz -= cos; }
		if (input.back) { mx += sin; mz += cos; }
		if (input.left) { mx -= cos; mz += sin; }
		if (input.right) { mx += cos; mz -= sin; }
		const len = Math.hypot(mx, mz);
		if (len > 0) { mx = mx / len * speed; mz = mz / len * speed; }

		const onIce = this.onGround && isOnIce(world, this.pos, PLAYER.width);
		if (swimming) {
			if (input.forward) {
				const [dx, dy, dz] = lookDir(this.yaw, this.pitch);
				this.vel.x = dx * speed;
				this.vel.y = dy * speed;
				this.vel.z = dz * speed;
			} else {
				this.vel.x = mx;
				this.vel.z = mz;
				this.vel.y = Math.max(this.vel.y - 2 * dt, -1.0);
			}
		} else {
			if (now < this.knockUntil) {
				// ノックバック直後は入力で打ち消さない (地上は摩擦で少しずつ減らす)
				if (this.onGround) {
					const f = Math.pow(0.9, dt * 20);
					this.vel.x *= f;
					this.vel.z *= f;
				}
			} else if (this.onGround || inWater) {
				if (onIce && !inWater) {
					// 氷は 1 tick あたり 2% しか入力に寄らず、よく滑る
					const k = 1 - Math.pow(0.98, dt * 20);
					this.vel.x += (mx - this.vel.x) * k;
					this.vel.z += (mz - this.vel.z) * k;
				} else {
					this.vel.x = mx;
					this.vel.z = mz;
				}
			} else {
				// 空中は入力方向へ寄せるだけ
				const k = Math.min(1, AIR_CONTROL * dt * 10);
				this.vel.x += (mx - this.vel.x) * k;
				this.vel.z += (mz - this.vel.z) * k;
			}

			if (onLadder) {
				const down = -3.0;
				if (input.jump || input.forward) this.vel.y = PLAYER.climbSpeed;
				else if (sneaking) this.vel.y = 0;
				else this.vel.y = down;
				events.climbing = this.vel.y !== 0;
			} else if (inWater) {
				this.vel.y -= 2 * dt;
				if (this.vel.y < -1.0) this.vel.y = -1.0;
				if (input.jump) {
					if (this.hitWall && !headInWater) this.vel.y = PLAYER.jumpSpeed;
					else this.vel.y = Math.min(3.5, this.vel.y + 30 * dt);
				}
			} else {
				this.vel.y -= GRAVITY * dt;
				this.vel.y *= Math.pow(0.98, dt * 20);
				if (this.vel.y < -MAX_FALL_SPEED) this.vel.y = -MAX_FALL_SPEED;
				if (input.jump && this.onGround) {
					this.vel.y = PLAYER.jumpSpeed;
					events.jumped = true;
					if (this.isSprinting) {
						this.vel.x += -sin * 2;
						this.vel.z += -cos * 2;
						this.addExhaustion(EXHAUSTION.sprintJump);
					} else {
						this.addExhaustion(EXHAUSTION.jump);
					}
				}
			}
		}

		// 移動
		const wasOnGround = this.onGround;
		const px = this.pos.x, py = this.pos.y, pz = this.pos.z;
		const res = moveEntity(world, this.pos, this.vel, PLAYER.width, h, dt, { stepUp: true, onGround: wasOnGround, edgeSafe: sneaking && wasOnGround });
		this.onGround = res.onGround;
		this.hitWall = res.hitWall;
		const moved = Math.hypot(this.pos.x - px, this.pos.z - pz);

		// 空気抵抗なしの落下は水・はしごで打ち切る
		if (inWater || onLadder) this.fallTopY = this.pos.y;

		// 着地と落下ダメージ
		if (this.onGround) {
			if (!wasOnGround) {
				const dist = this.fallTopY - this.pos.y;
				const below = blockBelow(world, this.pos, PLAYER.width);
				if (dist > 0.5) events.landed = { distance: dist, blockId: below };
				if (dist > 3 && !inWater && !onLadder) {
					const dmg = Math.floor(dist - 3);
					if (dmg > 0) this.damage(dmg, { kind: 'fall' }, now);
				}
			}
			this.fallTopY = this.pos.y;
		} else {
			this.fallTopY = Math.max(this.fallTopY, this.pos.y);
		}

		// 足音・泳ぎ・消耗
		if (this.onGround && !inWater) {
			this.walkDistance += moved;
			this.stepAcc += moved;
			if (this.stepAcc >= STEP_DISTANCE) {
				this.stepAcc -= STEP_DISTANCE;
				events.stepped = blockBelow(world, this.pos, PLAYER.width) || null;
			}
			if (this.isSprinting) this.addExhaustion(EXHAUSTION.sprintPerMeter * moved);
		} else if (inWater) {
			this.strokeAcc += moved + Math.abs(this.pos.y - py);
			if (this.strokeAcc >= STROKE_DISTANCE) {
				this.strokeAcc -= STROKE_DISTANCE;
				events.swimmingStroke = true;
			}
			this.addExhaustion(EXHAUSTION.swimPerMeter * (moved + Math.abs(this.pos.y - py)));
		}

		// 溺れ
		const eyeInWater = isHeadInWater(world, this.pos, POSE_EYE[this.pose]);
		const maxAir = this.maxAirSeconds;
		if (eyeInWater && this.effectLevel('waterBreathing') === 0) {
			this.airSeconds = Math.max(0, this.airSeconds - dt);
			if (this.airSeconds <= 0) {
				this.drownTimer += dt;
				if (this.drownTimer >= 1) {
					this.drownTimer -= 1;
					this.damage(2, { kind: 'drown' }, now);
					events.drowningTick = true;
				}
			}
		} else {
			this.airSeconds = Math.min(maxAir, this.airSeconds + 4 * dt);
			this.drownTimer = 0;
		}

		// 空腹と回復
		const hungerLvl = this.effectLevel('hunger');
		if (hungerLvl > 0) this.addExhaustion(0.1 * hungerLvl * dt);
		while (this.exhaustion >= 4) {
			this.exhaustion -= 4;
			if (this.stats.saturation > 0) this.stats.saturation = Math.max(0, this.stats.saturation - 1);
			else this.stats.hunger = Math.max(0, this.stats.hunger - 1);
		}
		if (this.stats.saturation > this.stats.hunger) this.stats.saturation = this.stats.hunger;
		const hurtable = this.stats.health < PLAYER.maxHealth;
		if (hurtable && this.stats.hunger >= PLAYER.maxHunger && this.stats.saturation > 0) {
			this.regenTimer = 0;
			this.fastRegenTimer += dt;
			if (this.fastRegenTimer >= 0.5) {
				this.fastRegenTimer -= 0.5;
				const healed = Math.min(this.stats.saturation / 6, 1, PLAYER.maxHealth - this.stats.health);
				this.stats.health += healed;
				this.addExhaustion(EXHAUSTION.regenPerHealth * healed);
			}
		} else if (hurtable && this.stats.hunger >= 18) {
			this.fastRegenTimer = 0;
			this.regenTimer += dt;
			if (this.regenTimer >= 4) {
				this.regenTimer -= 4;
				this.stats.health = Math.min(PLAYER.maxHealth, this.stats.health + 1);
				this.addExhaustion(EXHAUSTION.regenPerHealth);
			}
		} else {
			this.regenTimer = 0;
			this.fastRegenTimer = 0;
		}
		if (this.stats.hunger <= 0) {
			this.starveTimer += dt;
			if (this.starveTimer >= 4) {
				this.starveTimer -= 4;
				if (this.stats.health > 1) this.damage(1, { kind: 'starve' }, now);
			}
		} else {
			this.starveTimer = 0;
		}
		const regenLvl = this.effectLevel('regeneration');
		if (regenLvl > 0 && hurtable) {
			this.effectRegenTimer += dt;
			const interval = 2.5 / Math.pow(2, regenLvl - 1);
			if (this.effectRegenTimer >= interval) {
				this.effectRegenTimer -= interval;
				this.stats.health = Math.min(PLAYER.maxHealth, this.stats.health + 1);
			}
		} else {
			this.effectRegenTimer = 0;
		}

		// サボテン
		if (this.touchesDamaging()) {
			this.cactusTimer += dt;
			if (this.cactusTimer >= 0.5) {
				this.cactusTimer -= 0.5;
				this.damage(1, { kind: 'cactus' }, now);
			}
		} else {
			this.cactusTimer = 0;
		}

		// 奈落
		if (this.pos.y < -16) {
			this.voidTimer += dt;
			if (this.voidTimer >= 0.5) {
				this.voidTimer -= 0.5;
				this.damage(4, { kind: 'void' }, now);
			}
		} else {
			this.voidTimer = 0;
		}

		// 使う
		if (this.using && !this.isDead) {
			this.usingTime += dt;
			const stack = this.inventory.slots[this.usingSlot];
			if (stack != null && ITEM_DEFS[stack.id]?.kind === 'bow') {
				this.useProgress = Math.min(1, this.usingTime / BOW_FULL_SECONDS);
			} else {
				this.useProgress = Math.min(1, this.usingTime / EAT_SECONDS);
				if (this.useProgress >= 1) this.finishEating(events);
			}
		}

		// 視野と目の高さ
		const fovTarget = this.isSprinting && moving ? SPRINT_FOV : 1;
		if (this.fovScale < fovTarget) this.fovScale = Math.min(fovTarget, this.fovScale + SPRINT_FOV_RATE * dt);
		else this.fovScale = Math.max(fovTarget, this.fovScale - SPRINT_FOV_RATE * dt);
		const eyeTarget = POSE_EYE[this.pose];
		if (this.eyeHeight < eyeTarget) this.eyeHeight = Math.min(eyeTarget, this.eyeHeight + EYE_RATE * dt);
		else this.eyeHeight = Math.max(eyeTarget, this.eyeHeight - EYE_RATE * dt);

		this.syncStats();
		events.died = this.pendDied;
		this.pendDied = false;
		events.damaged = this.pendDamaged;
		this.pendDamaged = 0;
		events.levelUp = this.pendLevelUp;
		this.pendLevelUp = false;
		events.xpGained = this.pendXp;
		this.pendXp = 0;
		events.itemBroke = this.pendBroke;
		this.pendBroke = null;
		return events;
	}
}
