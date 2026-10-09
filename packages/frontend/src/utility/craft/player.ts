/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { BLOCK_DEFS, ITEM_DEFS, PLAYER } from './constants.js';
import { Inventory } from './inventory.js';
import { GRAVITY, MAX_FALL_SPEED, isHeadInWater, isInWater, moveEntity, overlapsBlock, raycastBlocks } from './physics.js';
import type { BlockHit, InputState, ItemStack, PlayerStats, Vec3 } from './types.js';
import type { CraftWorld } from './world.js';

export type PlayerEvents = { died: boolean; damaged: number; fellDistance: number };

const WALK_SPEED = 4.3;
const SPRINT_SPEED = 5.6;
const SNEAK_SPEED = 1.3;
const AIR_CONTROL = 0.6;
const JUMP_SPEED = 9;
const MAX_DT = 0.05;
const HURT_MS = 400;

export class Player {
	public readonly pos: Vec3 = { x: 0, y: 0, z: 0 };
	public readonly vel: Vec3 = { x: 0, y: 0, z: 0 };
	public yaw = 0;
	public pitch = 0;
	public onGround = false;
	public readonly stats: PlayerStats = { health: PLAYER.maxHealth, hunger: PLAYER.maxHunger, air: PLAYER.maxAir };
	public readonly inventory = new Inventory();
	public hotbarIndex = 0;
	public hurtUntil = 0;
	public isDead = false;

	private fallTopY = 0;
	private hungerTimer = 0;
	private starveTimer = 0;
	private regenTimer = 0;
	private drownTimer = 0;
	private cactusTimer = 0;
	private voidTimer = 0;

	constructor(private world: CraftWorld) {
	}

	public get eyeY(): number {
		return this.pos.y + PLAYER.eyeHeight;
	}

	public get selectedStack(): ItemStack {
		return this.inventory.slots[this.hotbarIndex] ?? null;
	}

	public spawn(x: number, z: number): void {
		this.pos.x = x;
		this.pos.z = z;
		this.pos.y = this.world.surfaceY(Math.floor(x), Math.floor(z));
		this.vel.x = 0;
		this.vel.y = 0;
		this.vel.z = 0;
		this.onGround = false;
		this.fallTopY = this.pos.y;
	}

	public respawn(x: number, z: number): void {
		this.spawn(x, z);
		this.stats.health = PLAYER.maxHealth;
		this.stats.hunger = PLAYER.maxHunger;
		this.stats.air = PLAYER.maxAir;
		this.isDead = false;
		this.hungerTimer = 0;
		this.starveTimer = 0;
		this.regenTimer = 0;
		this.drownTimer = 0;
		this.cactusTimer = 0;
		this.voidTimer = 0;
	}

	public damage(amount: number, now: number): void {
		if (this.isDead || amount <= 0) return;
		this.stats.health = Math.max(0, this.stats.health - amount);
		this.hurtUntil = now + HURT_MS;
		if (this.stats.health <= 0) this.isDead = true;
	}

	public eat(now: number): boolean {
		void now;
		const stack = this.selectedStack;
		if (stack == null || this.isDead) return false;
		const food = ITEM_DEFS[stack.id]?.food;
		if (food == null || this.stats.hunger >= PLAYER.maxHunger) return false;
		if (!this.inventory.take(this.hotbarIndex, 1)) return false;
		this.stats.hunger = Math.min(PLAYER.maxHunger, this.stats.hunger + food);
		this.stats.health = Math.min(PLAYER.maxHealth, this.stats.health + 1);
		return true;
	}

	public overlapsBlock(bx: number, by: number, bz: number): boolean {
		return overlapsBlock(this.pos, PLAYER.width, PLAYER.height, bx, by, bz);
	}

	public raycast(maxDist: number = PLAYER.reach): BlockHit | null {
		return raycastBlocks(this.world, this.pos.x, this.eyeY, this.pos.z, this.yaw, this.pitch, maxDist);
	}

	/** 足元と頭のブロックの水平 4 近傍にダメージブロックがあるか */
	private touchesDamaging(): boolean {
		const half = PLAYER.width / 2;
		const bx = Math.floor(this.pos.x), bz = Math.floor(this.pos.z);
		const ys = [Math.floor(this.pos.y), Math.floor(this.pos.y + PLAYER.height - 0.01)];
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

	public update(dtRaw: number, input: InputState, now: number): PlayerEvents {
		const events: PlayerEvents = { died: false, damaged: 0, fellDistance: 0 };
		if (this.isDead) {
			this.vel.x = 0;
			this.vel.y = 0;
			this.vel.z = 0;
			return events;
		}
		const dt = Math.min(Math.max(dtRaw, 0), MAX_DT);
		const hurt = (amount: number): void => {
			if (amount <= 0 || this.isDead) return;
			events.damaged += amount;
			this.damage(amount, now);
		};

		// 視点
		this.yaw += input.lookDX;
		this.pitch = Math.max(-(Math.PI / 2 - 0.01), Math.min(Math.PI / 2 - 0.01, this.pitch + input.lookDY));

		// 移動
		const inWater = isInWater(this.world, this.pos, PLAYER.height);
		const sneaking = input.sneak;
		const sprinting = input.sprint && !sneaking && this.stats.hunger > 6;
		let speed = sneaking ? SNEAK_SPEED : (sprinting ? SPRINT_SPEED : WALK_SPEED);
		if (inWater) speed *= 0.6;
		const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
		let mx = 0, mz = 0;
		if (input.forward) { mx -= sin; mz -= cos; }
		if (input.back) { mx += sin; mz += cos; }
		if (input.left) { mx -= cos; mz += sin; }
		if (input.right) { mx += cos; mz -= sin; }
		const len = Math.hypot(mx, mz);
		if (len > 0) { mx = mx / len * speed; mz = mz / len * speed; }
		if (this.onGround || inWater) {
			this.vel.x = mx;
			this.vel.z = mz;
		} else {
			// 空中は入力方向へ寄せるだけ
			const k = Math.min(1, AIR_CONTROL * dt * 10);
			this.vel.x += (mx - this.vel.x) * k;
			this.vel.z += (mz - this.vel.z) * k;
		}

		if (inWater) {
			this.vel.y -= GRAVITY * 0.2 * dt;
			if (this.vel.y < -3) this.vel.y = -3;
			if (input.jump) this.vel.y = Math.min(4, this.vel.y + 30 * dt);
		} else {
			this.vel.y -= GRAVITY * dt;
			if (this.vel.y < -MAX_FALL_SPEED) this.vel.y = -MAX_FALL_SPEED;
			if (input.jump && this.onGround) this.vel.y = JUMP_SPEED;
		}

		const wasOnGround = this.onGround;
		const res = moveEntity(this.world, this.pos, this.vel, PLAYER.width, PLAYER.height, dt, { stepUp: !sneaking, onGround: wasOnGround });
		this.onGround = res.onGround;

		// 落下ダメージ
		if (inWater) {
			this.fallTopY = this.pos.y;
		} else if (this.onGround) {
			if (!wasOnGround) {
				const dist = this.fallTopY - this.pos.y;
				if (dist > 3) {
					events.fellDistance = dist;
					hurt(Math.floor(dist - 3));
				}
			}
			this.fallTopY = this.pos.y;
		} else {
			this.fallTopY = Math.max(this.fallTopY, this.pos.y);
		}

		// 溺れ
		if (isHeadInWater(this.world, this.pos, PLAYER.eyeHeight)) {
			this.stats.air = Math.max(0, this.stats.air - dt);
			if (this.stats.air <= 0) {
				this.drownTimer += dt;
				if (this.drownTimer >= 1) {
					this.drownTimer -= 1;
					hurt(2);
				}
			}
		} else {
			this.stats.air = Math.min(PLAYER.maxAir, this.stats.air + 2 * dt);
			this.drownTimer = 0;
		}

		// 空腹と回復
		const moving = len > 0;
		this.hungerTimer += dt;
		const hungerInterval = sprinting && moving ? 15 : 40;
		if (this.hungerTimer >= hungerInterval) {
			this.hungerTimer = 0;
			this.stats.hunger = Math.max(0, this.stats.hunger - 1);
		}
		if (this.stats.hunger <= 0) {
			this.starveTimer += dt;
			if (this.starveTimer >= 4) {
				this.starveTimer -= 4;
				if (this.stats.health > 1) hurt(1);
			}
		} else {
			this.starveTimer = 0;
		}
		if (this.stats.hunger >= 18 && this.stats.health < PLAYER.maxHealth) {
			this.regenTimer += dt;
			if (this.regenTimer >= 4) {
				this.regenTimer -= 4;
				this.stats.health = Math.min(PLAYER.maxHealth, this.stats.health + 1);
			}
		} else {
			this.regenTimer = 0;
		}

		// サボテン
		if (this.touchesDamaging()) {
			this.cactusTimer += dt;
			if (this.cactusTimer >= 0.5) {
				this.cactusTimer -= 0.5;
				hurt(1);
			}
		} else {
			this.cactusTimer = 0;
		}

		// 奈落
		if (this.pos.y < -16) {
			this.voidTimer += dt;
			if (this.voidTimer >= 0.25) {
				this.voidTimer -= 0.25;
				hurt(1);
			}
		} else {
			this.voidTimer = 0;
		}

		if (this.isDead) events.died = true;
		return events;
	}
}
