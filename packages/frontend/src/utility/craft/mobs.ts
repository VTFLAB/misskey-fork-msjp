/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { BLOCK, MOB, MOB_DEFS, isNight } from './constants.js';
import { lookDir } from './math.js';
import { GRAVITY, MAX_FALL_SPEED, moveEntity, rayHitsBox } from './physics.js';
import type { MobType } from './constants.js';
import type { MobHit, MobSnapshot, MobState, Vec3 } from './types.js';
import type { CraftWorld } from './world.js';

export type MobDrawInfo = { id: string; type: MobType; x: number; y: number; z: number; yaw: number; walkPhase: number; hurt: boolean };
export type MobEvent =
	| { type: 'attackPlayer'; userId: string; damage: number; mobId: string }
	| { type: 'died'; mobId: string; mobType: MobType; killerId: string | null; x: number; y: number; z: number };

type PlayerPos = { userId: string; x: number; y: number; z: number };

type Mob = MobState & {
	vel: Vec3;
	/** 非ホスト: 補間の目標位置 */
	targetPos: Vec3;
	targetYaw: number;
	hurtUntil: number;
	wanderDir: number;
	wanderUntil: number;
	/** 0 なら立ち止まる */
	wanderMove: boolean;
	lastAttackAt: number;
	walkPhase: number;
	onGround: boolean;
};

const SPAWN_INTERVAL_MS = 2000;
const SPAWN_MIN_DIST = 24;
const SPAWN_MAX_DIST = 48;
const SPAWN_PLAYER_CLEAR = 20;
const DESPAWN_DIST = 80;
const TWO_PI = Math.PI * 2;
const MOB_TYPES: MobType[] = [MOB.zombie, MOB.wolf, MOB.bear];

function wrapAngleDiff(d: number): number {
	return d - Math.round(d / TWO_PI) * TWO_PI;
}

const round = (v: number, p: number): number => {
	const m = 10 ** p;
	return Math.round(v * m) / m;
};

export class MobSystem {
	public isHost = false;
	private mobs = new Map<string, Mob>();
	private counter = 0;
	private lastSpawnCheck = 0;

	constructor(private world: CraftWorld) {}

	public get count(): number {
		return this.mobs.size;
	}

	public clear(): void {
		this.mobs.clear();
	}

	private countOf(type: MobType): number {
		let n = 0;
		for (const m of this.mobs.values()) if (m.type === type) n++;
		return n;
	}

	/**
	 * ホストのとき: AI・物理・湧き・消滅。
	 * deviation: 4 つ目の引数 hostId を追加 (MOB id の `${hostId}:${counter}` に使う)。
	 */
	public tick(rawDt: number, now: number, players: PlayerPos[], hostId: string): MobEvent[] {
		const events: MobEvent[] = [];
		if (!this.isHost) return events;
		const dt = Math.min(rawDt, 0.1);

		if (now - this.lastSpawnCheck >= SPAWN_INTERVAL_MS) {
			this.lastSpawnCheck = now;
			this.trySpawn(now, players, hostId);
		}

		for (const mob of [...this.mobs.values()]) {
			if (this.shouldDespawn(mob, dt, now, players)) {
				this.mobs.delete(mob.id);
				continue;
			}
			this.stepMob(mob, dt, now, players, events);
		}
		return events;
	}

	private shouldDespawn(mob: Mob, dt: number, now: number, players: PlayerPos[]): boolean {
		if (mob.y < -8) return true;
		if (players.length === 0) return true;
		let near = false;
		for (const p of players) {
			if (Math.hypot(p.x - mob.x, p.z - mob.z) <= DESPAWN_DIST) { near = true; break; }
		}
		if (!near) return true;
		// ゾンビは昼に燃えて消える (毎秒 1/200)
		if (mob.type === MOB.zombie && !isNight() && Math.random() < dt / 200) return true;
		return false;
	}

	private trySpawn(now: number, players: PlayerPos[], hostId: string): void {
		if (players.length === 0) return;
		const types = MOB_TYPES.filter(t => this.countOf(t) < MOB_DEFS[t].cap);
		if (types.length === 0) return;
		const type = types[Math.floor(Math.random() * types.length)];
		const def = MOB_DEFS[type];
		if (def.nightOnly && !isNight()) return;

		const p = players[Math.floor(Math.random() * players.length)];
		const ang = Math.random() * TWO_PI;
		const dist = SPAWN_MIN_DIST + Math.random() * (SPAWN_MAX_DIST - SPAWN_MIN_DIST);
		const bx = Math.floor(p.x + Math.cos(ang) * dist);
		const bz = Math.floor(p.z + Math.sin(ang) * dist);

		if (def.biomes.length > 0 && !(def.biomes as number[]).includes(this.world.biomeAt(bx, bz))) return;
		if (!this.world.hasChunk(Math.floor(bx / 16), Math.floor(bz / 16))) return;
		const y = this.world.surfaceY(bx, bz);
		if (this.world.getBlock(bx, y, bz) !== BLOCK.air || this.world.getBlock(bx, y + 1, bz) !== BLOCK.air) return;
		if (this.world.getBlock(bx, y - 1, bz) === BLOCK.water) return;
		const sx = bx + 0.5, sz = bz + 0.5;
		for (const q of players) {
			if (Math.hypot(q.x - sx, q.z - sz) < SPAWN_PLAYER_CLEAR) return;
		}

		const id = `${hostId}:${this.counter++}`;
		this.mobs.set(id, {
			id, type, x: sx, y, z: sz, yaw: Math.random() * TWO_PI, hp: def.maxHp, target: null, attackAt: 0,
			vel: { x: 0, y: 0, z: 0 }, targetPos: { x: sx, y, z: sz }, targetYaw: 0,
			hurtUntil: 0, wanderDir: 0, wanderUntil: 0, wanderMove: false, lastAttackAt: 0, walkPhase: 0, onGround: false,
		});
	}

	private stepMob(mob: Mob, dt: number, now: number, players: PlayerPos[], events: MobEvent[]): void {
		const def = MOB_DEFS[mob.type];

		// 一番近いプレイヤー
		let nearest: PlayerPos | null = null;
		let nearestD = Infinity;
		for (const p of players) {
			const d = Math.hypot(p.x - mob.x, p.z - mob.z);
			if (d < nearestD && Math.abs(p.y - mob.y) < 12) { nearest = p; nearestD = d; }
		}

		let moveX = 0, moveZ = 0;
		if (nearest != null && nearestD <= def.aggroRange) {
			mob.target = nearest.userId;
			if (nearestD > 0.3) {
				const dx = (nearest.x - mob.x) / nearestD;
				const dz = (nearest.z - mob.z) / nearestD;
				// 攻撃距離に入ったら止まる
				if (nearestD > def.width / 2 + 1.0) {
					moveX = dx * def.speed;
					moveZ = dz * def.speed;
				}
				mob.yaw = Math.atan2(-dx, -dz);
			}
			if (nearestD <= def.width / 2 + 1.6 && now - mob.lastAttackAt >= def.attackInterval * 1000) {
				mob.lastAttackAt = now;
				mob.attackAt = now;
				events.push({ type: 'attackPlayer', userId: nearest.userId, damage: def.attack, mobId: mob.id });
			}
		} else {
			mob.target = null;
			if (now >= mob.wanderUntil) {
				mob.wanderUntil = now + 2000 + Math.random() * 3000;
				mob.wanderDir = Math.random() * TWO_PI;
				mob.wanderMove = Math.random() < 0.5;
			}
			if (mob.wanderMove) {
				let dx = -Math.sin(mob.wanderDir), dz = -Math.cos(mob.wanderDir);
				// 前方が水なら向きを反転する
				const ahead = this.world.getBlock(Math.floor(mob.x + dx * (def.width / 2 + 0.7)), Math.floor(mob.y), Math.floor(mob.z + dz * (def.width / 2 + 0.7)));
				const aheadBelow = this.world.getBlock(Math.floor(mob.x + dx * (def.width / 2 + 0.7)), Math.floor(mob.y) - 1, Math.floor(mob.z + dz * (def.width / 2 + 0.7)));
				if (ahead === BLOCK.water || aheadBelow === BLOCK.water) {
					mob.wanderDir += Math.PI;
					dx = -dx; dz = -dz;
				}
				moveX = dx * def.speed * 0.4;
				moveZ = dz * def.speed * 0.4;
				mob.yaw = Math.atan2(-dx, -dz);
			}
		}

		// ノックバックの余韻は減衰させ、移動入力を重ねる
		mob.vel.x = moveX + (mob.vel.x - moveX) * Math.max(0, 1 - dt * 8);
		mob.vel.z = moveZ + (mob.vel.z - moveZ) * Math.max(0, 1 - dt * 8);
		mob.vel.y = Math.max(-MAX_FALL_SPEED, mob.vel.y - GRAVITY * dt);

		const pos: Vec3 = { x: mob.x, y: mob.y, z: mob.z };
		const px = mob.x, pz = mob.z;
		const r = moveEntity(this.world, pos, mob.vel, def.width, def.height, dt, { stepUp: false, onGround: mob.onGround });
		mob.onGround = r.onGround;
		if (r.hitWall && r.onGround) mob.vel.y = 9;
		else if (r.hitWall && mob.onGround) mob.vel.y = 9;
		mob.x = pos.x; mob.y = pos.y; mob.z = pos.z;

		const moved = Math.hypot(mob.x - px, mob.z - pz);
		mob.walkPhase = (mob.walkPhase + moved * 2.2) % TWO_PI;
	}

	/** ホストのとき: 配信用スナップショット (全 MOB) */
	public snapshot(hostId: string): MobSnapshot {
		const mobs: MobState[] = [];
		for (const m of this.mobs.values()) {
			mobs.push({
				id: m.id, type: m.type,
				x: round(m.x, 2), y: round(m.y, 2), z: round(m.z, 2),
				yaw: round(m.yaw, 3), hp: m.hp, target: m.target, attackAt: m.attackAt,
			});
		}
		return { hostId, t: Date.now(), mobs };
	}

	/** 非ホストのとき: 受信したスナップショットを反映し、自分への攻撃を検出して返す */
	public applySnapshot(s: MobSnapshot, now: number, localUserId: string | null): MobEvent[] {
		const events: MobEvent[] = [];
		const seen = new Set<string>();
		for (const st of s.mobs) {
			if (!(st.type in MOB_DEFS)) continue;
			seen.add(st.id);
			let mob = this.mobs.get(st.id);
			if (mob == null) {
				mob = {
					...st,
					vel: { x: 0, y: 0, z: 0 }, targetPos: { x: st.x, y: st.y, z: st.z }, targetYaw: st.yaw,
					hurtUntil: 0, wanderDir: 0, wanderUntil: 0, wanderMove: false, lastAttackAt: st.attackAt, walkPhase: 0, onGround: false,
				};
				this.mobs.set(st.id, mob);
				// 湧いた直後の古い attackAt は攻撃として扱わない
				continue;
			}
			if (st.hp < mob.hp) mob.hurtUntil = now + 400;
			mob.hp = st.hp;
			mob.target = st.target;
			mob.targetPos.x = st.x; mob.targetPos.y = st.y; mob.targetPos.z = st.z;
			mob.targetYaw = st.yaw;
			if (st.attackAt > mob.lastAttackAt) {
				mob.lastAttackAt = st.attackAt;
				mob.attackAt = st.attackAt;
				if (localUserId != null && st.target === localUserId) {
					events.push({ type: 'attackPlayer', userId: localUserId, damage: MOB_DEFS[st.type].attack, mobId: st.id });
				}
			}
		}
		for (const id of [...this.mobs.keys()]) {
			if (!seen.has(id)) this.mobs.delete(id);
		}
		return events;
	}

	/** 非ホストのとき: 毎フレームの補間 */
	public interpolate(dt: number): void {
		const k = Math.min(1, dt * 10);
		for (const m of this.mobs.values()) {
			const px = m.x, pz = m.z;
			m.x += (m.targetPos.x - m.x) * k;
			m.y += (m.targetPos.y - m.y) * k;
			m.z += (m.targetPos.z - m.z) * k;
			m.yaw += wrapAngleDiff(m.targetYaw - m.yaw) * k;
			m.walkPhase = (m.walkPhase + Math.hypot(m.x - px, m.z - pz) * 2.2) % TWO_PI;
		}
	}

	/** 攻撃を適用する。倒したら died イベントを返す */
	public applyHit(hit: MobHit, attackerId: string | null, now: number): MobEvent[] {
		const mob = this.mobs.get(hit.id);
		if (mob == null) return [];
		mob.hp -= hit.damage;
		mob.hurtUntil = now + 400;
		mob.vel.x += hit.kx * 6;
		mob.vel.z += hit.kz * 6;
		mob.vel.y = 4;
		if (mob.hp <= 0) {
			this.mobs.delete(mob.id);
			return [{ type: 'died', mobId: mob.id, mobType: mob.type, killerId: attackerId, x: mob.x, y: mob.y, z: mob.z }];
		}
		return [];
	}

	public raycast(ox: number, oy: number, oz: number, yaw: number, pitch: number, maxDist: number): { id: string; dist: number } | null {
		const dir = lookDir(yaw, pitch);
		let best: { id: string; dist: number } | null = null;
		for (const m of this.mobs.values()) {
			const def = MOB_DEFS[m.type];
			const d = rayHitsBox(ox, oy, oz, dir, m, def.width, def.height, maxDist);
			if (d != null && (best == null || d < best.dist)) best = { id: m.id, dist: d };
		}
		return best;
	}

	public drawList(now: number): MobDrawInfo[] {
		const out: MobDrawInfo[] = [];
		for (const m of this.mobs.values()) {
			out.push({ id: m.id, type: m.type, x: m.x, y: m.y, z: m.z, yaw: m.yaw, walkPhase: m.walkPhase, hurt: now < m.hurtUntil });
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
}
