/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { BLOCK, MOB_DEFS, isNight } from './constants.js';
import { lookDir } from './math.js';
import { GRAVITY, MAX_FALL_SPEED, moveEntity, rayHitsBox } from './physics.js';
import type { MobType } from './constants.js';
import type { ItemStack, MobHit, MobSnapshot, MobState, Vec3 } from './types.js';
import type { CraftWorld } from './world.js';

export type MobDrawInfo = {
	id: string;
	type: MobType;
	x: number;
	y: number;
	z: number;
	yaw: number;
	walkPhase: number;
	hurt: boolean;
	/** 0..1 倒れる演出の進み (0 = 生きている) */
	deathT: number;
	/** 0..1 クリーパーの導火線の膨らみ */
	swell: number;
	/** 昼の日光で燃えている (炎の粒子用) */
	burning: boolean;
	/** 0..1 明るさ。engine がワールドの光から埋める (ここでは 1) */
	light: number;
};

export type MobEvent =
	| { type: 'attackPlayer'; userId: string; damage: number; mobId: string; ranged?: boolean; kx?: number; kz?: number }
	| { type: 'died'; mobId: string; mobType: MobType; killerId: string | null; x: number; y: number; z: number; xp: number; drops: ItemStack[] }
	| { type: 'explode'; x: number; y: number; z: number; radius: number; damage: number }
	| { type: 'shoot'; mobId: string; from: Vec3; to: Vec3; speed: number };

/** ローカルで受け取る攻撃。ネットワークには id / damage / kx / kz だけが流れる */
export type LocalMobHit = MobHit & { knockback?: number };

export type PlayerPos = { userId: string; x: number; y: number; z: number };

type PendingShot = { at: number; userId: string; damage: number; mobId: string; kx: number; kz: number };

type Mob = MobState & {
	vel: Vec3;
	/** 非ホスト: 補間の目標位置 */
	targetPos: Vec3;
	targetYaw: number;
	hurtUntil: number;
	wanderDir: number;
	wanderUntil: number;
	/** false なら立ち止まる */
	wanderMove: boolean;
	lastAttackAt: number;
	walkPhase: number;
	onGround: boolean;
	/** 倒れる演出の終了時刻 (now 基準)。0 なら生きている */
	dyingUntil: number;
	/** 殴られて逃げている間の終了時刻 (now 基準) */
	fleeUntil: number;
	fleeX: number;
	fleeZ: number;
	/** ローカルで最後に殴った時刻 (now 基準) */
	lastHitAt: number;
	/** ホストが日光の当たる場所にいると見ているか (燃える演出) */
	sunlit: boolean;
	/** 直前のスナップショットで知っている hp */
	knownHp: number;
};

const SPAWN_INTERVAL_MS = 2000;
const SPAWN_ATTEMPTS = 3;
const SPAWN_MIN_DIST = 24;
const SPAWN_MAX_DIST = 48;
const SPAWN_PLAYER_CLEAR = 24;
const DESPAWN_DIST = 80;
/** サーバーが 1 スナップショットで受ける上限 (48) に余裕を持たせた総数 */
const GLOBAL_CAP = 44;
const DYING_MS = 600;
const TWO_PI = Math.PI * 2;
const SPAWN_ORDER = Object.keys(MOB_DEFS) as MobType[];

function wrapAngleDiff(d: number): number {
	return d - Math.round(d / TWO_PI) * TWO_PI;
}

const round = (v: number, p: number): number => {
	const m = 10 ** p;
	return Math.round(v * m) / m;
};

function randInt(min: number, max: number): number {
	return min + Math.floor(Math.random() * (max - min + 1));
}

function rollDrops(type: MobType, looting: number): ItemStack[] {
	const out: ItemStack[] = [];
	for (const d of MOB_DEFS[type].drops) {
		const chance = (d.chance ?? 1) + (d.chance != null ? 0.01 * looting : 0);
		if (Math.random() >= chance) continue;
		const count = randInt(d.min, d.max) + (looting > 0 ? randInt(0, looting) : 0);
		if (count > 0) out.push({ id: d.id, count });
	}
	return out;
}

export class MobSystem {
	public isHost = false;
	/** 壁時計 (ms)。attackAt の基準で、テストでは差し替えられる */
	public clock: () => number = () => Date.now();
	private mobs = new Map<string, Mob>();
	private counter = 0;
	private lastSpawnCheck = 0;
	/** ホストの壁時計 − 自分の壁時計 (ms)。非ホストが attackAt と比べるときの補正 */
	private clockOffset = 0;
	private clockOffsetKnown = false;
	private pending: PendingShot[] = [];
	/** 自分で爆発させたクリーパー。直後のスナップショットで復活させない */
	private exploded = new Map<string, number>();

	constructor(private world: CraftWorld) {}

	public get count(): number {
		return this.mobs.size;
	}

	public clear(): void {
		this.clockOffsetKnown = false;
		this.clockOffset = 0;
		this.mobs.clear();
		this.pending = [];
		this.exploded.clear();
	}

	/** attackAt と比べるための時刻。非ホストはホストの時計に合わせる */
	private syncedNow(): number {
		return this.clock() + (this.isHost ? 0 : this.clockOffset);
	}

	private countOf(type: MobType): number {
		let n = 0;
		for (const m of this.mobs.values()) if (m.type === type) n++;
		return n;
	}

	private newMob(st: MobState): Mob {
		return {
			...st,
			vel: { x: 0, y: 0, z: 0 }, targetPos: { x: st.x, y: st.y, z: st.z }, targetYaw: st.yaw,
			hurtUntil: 0, wanderDir: 0, wanderUntil: 0, wanderMove: false, lastAttackAt: st.attackAt, walkPhase: 0, onGround: false,
			dyingUntil: 0, fleeUntil: 0, fleeX: 0, fleeZ: 0, lastHitAt: -Infinity, sunlit: true, knownHp: st.hp,
		};
	}

	/**
	 * ホストのとき: AI・物理・湧き・消滅。
	 * hostId は MOB id の `${hostId}:${counter}` に使う。lightAt は (sky << 4) | block を返す。
	 */
	public tick(rawDt: number, now: number, players: PlayerPos[], hostId: string, lightAt?: (x: number, y: number, z: number) => number): MobEvent[] {
		const events: MobEvent[] = [];
		if (!this.isHost) return events;
		const dt = Math.min(rawDt, 0.1);
		this.flushPending(events);

		if (now - this.lastSpawnCheck >= SPAWN_INTERVAL_MS) {
			this.lastSpawnCheck = now;
			for (let i = 0; i < SPAWN_ATTEMPTS; i++) this.trySpawn(players, hostId, lightAt);
		}

		const night = isNight(this.clock());
		for (const mob of [...this.mobs.values()]) {
			if (mob.dyingUntil > 0) {
				if (now >= mob.dyingUntil) { this.mobs.delete(mob.id); continue; }
				this.physics(mob, dt, 0, 0, MOB_DEFS[mob.type]);
				continue;
			}
			if (this.shouldDespawn(mob, dt, players, night)) {
				this.mobs.delete(mob.id);
				continue;
			}
			this.stepMob(mob, dt, now, players, events, night, lightAt);
		}
		return events;
	}

	private shouldDespawn(mob: Mob, dt: number, players: PlayerPos[], night: boolean): boolean {
		if (mob.y < -8) return true;
		if (players.length === 0) return true;
		let near = false;
		for (const p of players) {
			if (Math.hypot(p.x - mob.x, p.z - mob.z) <= DESPAWN_DIST) { near = true; break; }
		}
		if (!near) return true;
		// 昼に燃える種類は毎秒 1/200 で消える
		if (MOB_DEFS[mob.type].burnsInDay && !night && Math.random() < dt / 200) return true;
		return false;
	}

	private trySpawn(players: PlayerPos[], hostId: string, lightAt?: (x: number, y: number, z: number) => number): void {
		if (players.length === 0 || this.mobs.size >= GLOBAL_CAP) return;
		const night = isNight(this.clock());
		const types = SPAWN_ORDER.filter(t => {
			const def = MOB_DEFS[t];
			if (this.countOf(t) >= def.cap) return false;
			if (def.nightOnly && !night) return false;
			if (def.dayOnly && night) return false;
			return true;
		});
		if (types.length === 0) return;
		const type = types[Math.floor(Math.random() * types.length)];
		const def = MOB_DEFS[type];

		const p = players[Math.floor(Math.random() * players.length)];
		const ang = Math.random() * TWO_PI;
		const dist = SPAWN_MIN_DIST + Math.random() * (SPAWN_MAX_DIST - SPAWN_MIN_DIST);
		const bx = Math.floor(p.x + Math.cos(ang) * dist);
		const bz = Math.floor(p.z + Math.sin(ang) * dist);

		if (def.biomes.length > 0 && !(def.biomes as number[]).includes(this.world.biomeAt(bx, bz))) return;
		if (!this.world.hasChunk(Math.floor(bx / 16), Math.floor(bz / 16))) return;
		const y = this.world.surfaceY(bx, bz);
		if (this.world.getBlock(bx, y, bz) !== BLOCK.air || this.world.getBlock(bx, y + 1, bz) !== BLOCK.air) return;
		const below = this.world.getBlock(bx, y - 1, bz);
		if (below === BLOCK.water) return;
		if (def.dayOnly && below !== BLOCK.grass) return;
		if (def.hostile && lightAt != null && (lightAt(bx, y, bz) & 15) >= 8) return;
		const sx = bx + 0.5, sz = bz + 0.5;
		for (const q of players) {
			if (Math.hypot(q.x - sx, q.z - sz) < SPAWN_PLAYER_CLEAR) return;
		}

		const id = `${hostId}:${this.counter++}`;
		this.mobs.set(id, this.newMob({ id, type, x: sx, y, z: sz, yaw: Math.random() * TWO_PI, hp: def.maxHp, target: null, attackAt: 0 }));
	}

	private flushPending(events: MobEvent[], onlyUserId?: string | null): void {
		if (this.pending.length === 0) return;
		const wall = this.clock();
		const rest: PendingShot[] = [];
		for (const s of this.pending) {
			if (s.at <= wall) {
				if (onlyUserId == null || s.userId === onlyUserId) events.push({ type: 'attackPlayer', userId: s.userId, damage: s.damage, mobId: s.mobId, ranged: true, kx: s.kx, kz: s.kz });
			} else rest.push(s);
		}
		this.pending = rest;
	}

	private schedule(mob: Mob, userId: string, from: Vec3, to: Vec3, damage: number, speed: number): void {
		const flight = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z) / speed;
		const len = Math.hypot(to.x - from.x, to.z - from.z) || 1;
		this.pending.push({ at: this.clock() + flight * 1000, userId, damage, mobId: mob.id, kx: (to.x - from.x) / len, kz: (to.z - from.z) / len });
	}

	private isAggressive(mob: Mob, night: boolean, lightAt?: (x: number, y: number, z: number) => number): boolean {
		const def = MOB_DEFS[mob.type];
		if (!def.hostile) return false;
		if (def.hostileAtNightOnly === true) {
			if (night) return true;
			if (lightAt == null) return false;
			const l = lightAt(Math.floor(mob.x), Math.floor(mob.y + 0.5), Math.floor(mob.z));
			return (l >> 4) + (l & 15) < 8;
		}
		return true;
	}

	/** 速度入力を重ねて物理を 1 歩進める。歩いた距離で walkPhase を進める */
	private physics(mob: Mob, dt: number, moveX: number, moveZ: number, def: typeof MOB_DEFS[MobType]): void {
		// ノックバックの余韻は減衰させ、移動入力を重ねる
		mob.vel.x = moveX + (mob.vel.x - moveX) * Math.max(0, 1 - dt * 8);
		mob.vel.z = moveZ + (mob.vel.z - moveZ) * Math.max(0, 1 - dt * 8);
		const inWater = this.world.getBlock(Math.floor(mob.x), Math.floor(mob.y + def.height * 0.4), Math.floor(mob.z)) === BLOCK.water;
		if (inWater) {
			mob.vel.y += (1.4 - mob.vel.y) * Math.min(1, dt * 6);
		} else {
			mob.vel.y = Math.max(-MAX_FALL_SPEED, mob.vel.y - GRAVITY * dt);
			// ニワトリはゆっくり落ちる
			if (mob.type === 'chicken' && mob.vel.y < -2) mob.vel.y = -2;
		}

		const pos: Vec3 = { x: mob.x, y: mob.y, z: mob.z };
		const px = mob.x, pz = mob.z;
		const r = moveEntity(this.world, pos, mob.vel, def.width, def.height, dt, { stepUp: true, onGround: mob.onGround });
		const wasOnGround = mob.onGround;
		mob.onGround = r.onGround;
		if (r.hitWall && (r.onGround || wasOnGround) && mob.dyingUntil === 0 && (moveX !== 0 || moveZ !== 0)) mob.vel.y = 9;
		mob.x = pos.x; mob.y = pos.y; mob.z = pos.z;

		const moved = Math.hypot(mob.x - px, mob.z - pz);
		mob.walkPhase = (mob.walkPhase + moved * 2.65) % TWO_PI;
	}

	private stepMob(mob: Mob, dt: number, now: number, players: PlayerPos[], events: MobEvent[], night: boolean, lightAt?: (x: number, y: number, z: number) => number): void {
		const def = MOB_DEFS[mob.type];
		const wall = this.clock();

		mob.sunlit = lightAt == null ? true : (lightAt(Math.floor(mob.x), Math.floor(mob.y + def.height), Math.floor(mob.z)) >> 4) >= 12;

		// 一番近いプレイヤー
		let nearest: PlayerPos | null = null;
		let nearestD = Infinity;
		for (const p of players) {
			const d = Math.hypot(p.x - mob.x, p.z - mob.z);
			if (d < nearestD && Math.abs(p.y - mob.y) < 12) { nearest = p; nearestD = d; }
		}

		let moveX = 0, moveZ = 0;
		const aggressive = nearest != null && nearestD <= def.aggroRange && this.isAggressive(mob, night, lightAt);

		if (def.explode != null) {
			// 導火線の途中で追跡を止める判定は爆発側で行う
			if (aggressive && nearest != null) {
				const ex = def.explode;
				mob.target = nearest.userId;
				const dx = (nearest.x - mob.x) / Math.max(0.01, nearestD);
				const dz = (nearest.z - mob.z) / Math.max(0.01, nearestD);
				mob.yaw = Math.atan2(-dx, -dz);
				if (mob.attackAt > 0) {
					if (nearestD > ex.triggerRange + 2) {
						mob.attackAt = 0;
					} else if (wall - mob.attackAt >= ex.fuseSeconds * 1000) {
						this.mobs.delete(mob.id);
						events.push({ type: 'explode', x: mob.x, y: mob.y + def.height / 2, z: mob.z, radius: ex.radius, damage: ex.damage });
						return;
					} else {
						// 導火線中は立ち止まって小刻みに揺れる
						mob.yaw += Math.sin(wall / 40) * 0.08;
					}
				} else if (nearestD <= ex.triggerRange && Math.abs(nearest.y - mob.y) < 3) {
					mob.attackAt = wall;
				}
				if (mob.attackAt === 0 && nearestD > 1.0) {
					moveX = dx * def.speed;
					moveZ = dz * def.speed;
				}
			} else {
				mob.target = null;
				mob.attackAt = 0;
				[moveX, moveZ] = this.wander(mob, now, def);
			}
		} else if (aggressive && nearest != null) {
			mob.target = nearest.userId;
			const dx = (nearest.x - mob.x) / Math.max(0.01, nearestD);
			const dz = (nearest.z - mob.z) / Math.max(0.01, nearestD);
			if (def.ranged != null) {
				const rg = def.ranged;
				if (nearestD < rg.minRange) {
					moveX = -dx * def.speed;
					moveZ = -dz * def.speed;
				} else if (nearestD > rg.maxRange) {
					moveX = dx * def.speed;
					moveZ = dz * def.speed;
				} else {
					// 距離を保ったままゆっくり横へ回る
					const sign = (mob.id.length & 1) === 0 ? 1 : -1;
					moveX = -dz * sign * def.speed * 0.35;
					moveZ = dx * sign * def.speed * 0.35;
				}
				mob.yaw = Math.atan2(-dx, -dz);
				if (nearestD >= rg.minRange && nearestD <= rg.maxRange && wall - mob.lastAttackAt >= rg.interval * 1000) {
					mob.lastAttackAt = wall;
					mob.attackAt = wall;
					const from = { x: mob.x, y: mob.y + def.height * 0.85, z: mob.z };
					const to = { x: nearest.x, y: nearest.y + 1.0, z: nearest.z };
					events.push({ type: 'shoot', mobId: mob.id, from, to, speed: rg.speed });
					this.schedule(mob, nearest.userId, from, to, rg.damage, rg.speed);
				}
			} else {
				if (nearestD > 0.3) {
					// 攻撃距離に入ったら止まる
					if (nearestD > def.width / 2 + 1.0) {
						moveX = dx * def.speed;
						moveZ = dz * def.speed;
					}
					mob.yaw = Math.atan2(-dx, -dz);
				}
				if (def.attack > 0 && nearestD <= def.width / 2 + 1.6 && wall - mob.lastAttackAt >= def.attackInterval * 1000) {
					mob.lastAttackAt = wall;
					mob.attackAt = wall;
					events.push({ type: 'attackPlayer', userId: nearest.userId, damage: def.attack, mobId: mob.id, kx: dx, kz: dz });
				}
			}
		} else {
			mob.target = null;
			if (def.flees && now < mob.fleeUntil) {
				moveX = mob.fleeX * def.speed * 1.6;
				moveZ = mob.fleeZ * def.speed * 1.6;
				mob.yaw = Math.atan2(-mob.fleeX, -mob.fleeZ);
			} else {
				[moveX, moveZ] = this.wander(mob, now, def);
			}
		}

		this.physics(mob, dt, moveX, moveZ, def);
	}

	private wander(mob: Mob, now: number, def: typeof MOB_DEFS[MobType]): [number, number] {
		if (now >= mob.wanderUntil) {
			mob.wanderUntil = now + 2000 + Math.random() * 3000;
			mob.wanderDir = Math.random() * TWO_PI;
			// 立ち止まっている時間 (草を食べる) を長めに取る
			mob.wanderMove = Math.random() < (def.hostile ? 0.5 : 0.4);
		}
		if (!mob.wanderMove) return [0, 0];
		let dx = -Math.sin(mob.wanderDir), dz = -Math.cos(mob.wanderDir);
		// 前方が水なら向きを反転する
		const fx = Math.floor(mob.x + dx * (def.width / 2 + 0.7)), fz = Math.floor(mob.z + dz * (def.width / 2 + 0.7));
		if (this.world.getBlock(fx, Math.floor(mob.y), fz) === BLOCK.water || this.world.getBlock(fx, Math.floor(mob.y) - 1, fz) === BLOCK.water) {
			mob.wanderDir += Math.PI;
			dx = -dx; dz = -dz;
		}
		mob.yaw = Math.atan2(-dx, -dz);
		return [dx * def.speed * 0.4, dz * def.speed * 0.4];
	}

	/** ホストのとき: 配信用スナップショット (倒れている最中の MOB は含めない) */
	public snapshot(hostId: string): MobSnapshot {
		const mobs: MobState[] = [];
		for (const m of this.mobs.values()) {
			if (m.dyingUntil > 0) continue;
			mobs.push({
				id: m.id, type: m.type,
				x: round(m.x, 2), y: round(m.y, 2), z: round(m.z, 2),
				yaw: round(m.yaw, 3), hp: m.hp, target: m.target, attackAt: m.attackAt,
			});
		}
		return { hostId, t: this.clock(), mobs };
	}

	/**
	 * 非ホストのとき: 受信したスナップショットを反映し、自分への攻撃・矢・爆発を返す。
	 * players を渡すと、スケルトンの矢の終点を自分の位置に合わせられる。
	 */
	public applySnapshot(s: MobSnapshot, now: number, localUserId: string | null, players?: PlayerPos[]): MobEvent[] {
		const events: MobEvent[] = [];
		const seen = new Set<string>();
		const offset = s.t - this.clock();
		this.clockOffset = this.clockOffsetKnown ? this.clockOffset * 0.9 + offset * 0.1 : offset;
		this.clockOffsetKnown = true;
		const wall = this.syncedNow();
		for (const [id, at] of this.exploded) if (wall - at > 4000) this.exploded.delete(id);

		for (const st of s.mobs) {
			if (!(st.type in MOB_DEFS)) continue;
			if (this.exploded.has(st.id)) continue;
			seen.add(st.id);
			const mob = this.mobs.get(st.id);
			if (mob == null) {
				// 湧いた直後の古い attackAt は攻撃として扱わない
				this.mobs.set(st.id, this.newMob(st));
				continue;
			}
			if (mob.dyingUntil > 0) continue;
			if (st.hp < mob.hp) mob.hurtUntil = now + 400;
			mob.hp = st.hp;
			mob.knownHp = st.hp;
			mob.target = st.target;
			mob.targetPos.x = st.x; mob.targetPos.y = st.y; mob.targetPos.z = st.z;
			mob.targetYaw = st.yaw;
			const def = MOB_DEFS[st.type];
			if (def.explode != null) {
				// 導火線の開始と中断はそのまま反映する (爆発は interpolate が壁時計で行う)
				mob.attackAt = st.attackAt;
				mob.lastAttackAt = st.attackAt;
			} else if (st.attackAt > mob.lastAttackAt) {
				mob.lastAttackAt = st.attackAt;
				mob.attackAt = st.attackAt;
				if (def.ranged != null) {
					const rg = def.ranged;
					const from = { x: mob.targetPos.x, y: mob.targetPos.y + def.height * 0.85, z: mob.targetPos.z };
					const me = localUserId != null && st.target === localUserId ? players?.find(p => p.userId === localUserId) : undefined;
					const to = me != null
						? { x: me.x, y: me.y + 1.0, z: me.z }
						: { x: from.x - Math.sin(st.yaw) * 10, y: from.y, z: from.z - Math.cos(st.yaw) * 10 };
					events.push({ type: 'shoot', mobId: st.id, from, to, speed: rg.speed });
					if (me != null && localUserId != null) this.schedule(mob, localUserId, from, to, rg.damage, rg.speed);
				} else if (localUserId != null && st.target === localUserId && def.attack > 0) {
					events.push({ type: 'attackPlayer', userId: localUserId, damage: def.attack, mobId: st.id });
				}
			}
		}
		for (const [id, mob] of [...this.mobs]) {
			if (seen.has(id) || mob.dyingUntil > 0) continue;
			const def = MOB_DEFS[mob.type];
			if (def.explode != null && mob.attackAt > 0 && wall - mob.attackAt >= def.explode.fuseSeconds * 1000 - 500) {
				// ホストの方が先に導火線が尽きた: 同じ爆発をこちらでも起こす
				this.mobs.delete(id);
				events.push({ type: 'explode', x: mob.x, y: mob.y + def.height / 2, z: mob.z, radius: def.explode.radius, damage: def.explode.damage });
			} else if (mob.knownHp <= 6 || now - mob.lastHitAt < 1000) {
				mob.dyingUntil = now + DYING_MS;
				mob.attackAt = 0;
			} else {
				this.mobs.delete(id);
			}
		}
		return events;
	}

	/** 非ホストのとき: 毎フレームの補間。遅れて届く矢のダメージ・爆発・死亡演出の後始末もここで返す */
	public interpolate(dt: number, now: number = performance.now(), localUserId: string | null = null): MobEvent[] {
		const events: MobEvent[] = [];
		this.flushPending(events, localUserId);
		const k = Math.min(1, dt * 10);
		const wall = this.syncedNow();
		for (const m of [...this.mobs.values()]) {
			if (m.dyingUntil > 0) {
				if (now >= m.dyingUntil) this.mobs.delete(m.id);
				continue;
			}
			const px = m.x, pz = m.z;
			m.x += (m.targetPos.x - m.x) * k;
			m.y += (m.targetPos.y - m.y) * k;
			m.z += (m.targetPos.z - m.z) * k;
			m.yaw += wrapAngleDiff(m.targetYaw - m.yaw) * k;
			m.walkPhase = (m.walkPhase + Math.hypot(m.x - px, m.z - pz) * 2.65) % TWO_PI;
			const ex = MOB_DEFS[m.type].explode;
			if (ex != null && m.attackAt > 0 && wall - m.attackAt >= ex.fuseSeconds * 1000) {
				this.mobs.delete(m.id);
				this.exploded.set(m.id, wall);
				events.push({ type: 'explode', x: m.x, y: m.y + MOB_DEFS[m.type].height / 2, z: m.z, radius: ex.radius, damage: ex.damage });
			}
		}
		return events;
	}

	/**
	 * 攻撃を適用する。倒したら died イベントを返す (倒れる演出が終わるまで MOB は残る)。
	 * ネットワーク形式は {id, damage, kx, kz} のまま。knockback はローカルだけの追加値。
	 */
	public applyHit(hit: LocalMobHit, attackerId: string | null, now: number, opts: { looting?: number; knockback?: number } = {}): MobEvent[] {
		const mob = this.mobs.get(hit.id);
		if (mob == null || mob.dyingUntil > 0) return [];
		const def = MOB_DEFS[mob.type];
		mob.hp -= hit.damage;
		mob.hurtUntil = now + 400;
		mob.lastHitAt = now;
		const units = opts.knockback ?? hit.knockback ?? 0;
		const kb = units > 0 ? 4 + 4 * units : 6;
		mob.vel.x += hit.kx * kb;
		mob.vel.z += hit.kz * kb;
		mob.vel.y = 6;
		mob.onGround = false;
		if (def.flees && (hit.kx !== 0 || hit.kz !== 0)) {
			const len = Math.hypot(hit.kx, hit.kz);
			mob.fleeX = hit.kx / len;
			mob.fleeZ = hit.kz / len;
			mob.fleeUntil = now + 5000;
		}
		if (mob.hp <= 0) {
			mob.dyingUntil = now + DYING_MS;
			mob.attackAt = 0;
			mob.target = null;
			this.pending = this.pending.filter(p => p.mobId !== mob.id);
			return [{
				type: 'died', mobId: mob.id, mobType: mob.type, killerId: attackerId, x: mob.x, y: mob.y, z: mob.z,
				xp: randInt(def.xp[0], def.xp[1]), drops: rollDrops(mob.type, opts.looting ?? 0),
			}];
		}
		return [];
	}

	public positionOf(id: string): Vec3 | null {
		const m = this.mobs.get(id);
		return m == null ? null : { x: m.x, y: m.y, z: m.z };
	}

	public raycast(ox: number, oy: number, oz: number, yaw: number, pitch: number, maxDist: number): { id: string; dist: number } | null {
		const dir = lookDir(yaw, pitch);
		return this.rayTo(ox, oy, oz, dir, maxDist);
	}

	/** 方向 (dx, dy, dz) への線分 (長さ len) が最初に当たる MOB。矢の当たり判定用 */
	public hitTest(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, len: number): { id: string; dist: number } | null {
		const l = Math.hypot(dx, dy, dz);
		if (l < 1e-9) return null;
		return this.rayTo(ox, oy, oz, [dx / l, dy / l, dz / l], len);
	}

	private rayTo(ox: number, oy: number, oz: number, dir: [number, number, number], maxDist: number): { id: string; dist: number } | null {
		let best: { id: string; dist: number } | null = null;
		for (const m of this.mobs.values()) {
			if (m.dyingUntil > 0) continue;
			const def = MOB_DEFS[m.type];
			const d = rayHitsBox(ox, oy, oz, dir, m, def.width, def.height, maxDist);
			if (d != null && (best == null || d < best.dist)) best = { id: m.id, dist: d };
		}
		return best;
	}

	public drawList(now: number): MobDrawInfo[] {
		const out: MobDrawInfo[] = [];
		const wall = this.syncedNow();
		const day = !isNight(this.clock());
		for (const m of this.mobs.values()) {
			const def = MOB_DEFS[m.type];
			const dying = m.dyingUntil > 0;
			const deathT = dying ? Math.min(1, Math.max(0, 1 - (m.dyingUntil - now) / DYING_MS)) : 0;
			const swell = !dying && def.explode != null && m.attackAt > 0
				? Math.min(1, Math.max(0, (wall - m.attackAt) / (def.explode.fuseSeconds * 1000)))
				: 0;
			out.push({
				id: m.id, type: m.type, x: m.x, y: m.y, z: m.z, yaw: m.yaw, walkPhase: m.walkPhase,
				hurt: now < m.hurtUntil, deathT, swell, burning: !dying && def.burnsInDay && day && m.sunlit, light: 1,
			});
		}
		return out;
	}

	public nearestDistance(x: number, y: number, z: number): number | null {
		let best: number | null = null;
		for (const m of this.mobs.values()) {
			const d = Math.hypot(m.x - x, m.y - y, m.z - z);
			if (best == null || d < best) best = d;
		}
		return best;
	}

	/** 敵対的な MOB だけの最短距離 (HUD の警告用) */
	public nearestHostileDistance(x: number, y: number, z: number): number | null {
		let best: number | null = null;
		for (const m of this.mobs.values()) {
			if (m.dyingUntil > 0 || !MOB_DEFS[m.type].hostile) continue;
			const d = Math.hypot(m.x - x, m.y - y, m.z - z);
			if (best == null || d < best) best = d;
		}
		return best;
	}
}
