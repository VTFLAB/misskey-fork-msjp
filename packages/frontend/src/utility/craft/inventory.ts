/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { ITEM_DEFS, PLAYER } from './constants.js';
import type { ItemStack } from './types.js';

export class Inventory {
	public readonly slots: ItemStack[];

	constructor() {
		this.slots = new Array<ItemStack>(PLAYER.inventorySize).fill(null);
	}

	/** 入りきらなかった個数を返す */
	public add(id: number, count: number): number {
		const def = ITEM_DEFS[id];
		if (def == null || count <= 0) return Math.max(0, count);
		let left = count;
		for (const s of this.slots) {
			if (left <= 0) break;
			if (s != null && s.id === id && s.count < def.maxStack) {
				const n = Math.min(left, def.maxStack - s.count);
				s.count += n;
				left -= n;
			}
		}
		for (let i = 0; i < this.slots.length && left > 0; i++) {
			if (this.slots[i] == null) {
				const n = Math.min(left, def.maxStack);
				this.slots[i] = { id, count: n };
				left -= n;
			}
		}
		return left;
	}

	public remove(id: number, count: number): boolean {
		if (this.count(id) < count) return false;
		let left = count;
		// 後ろの枠から減らす (ホットバーを残しやすい)
		for (let i = this.slots.length - 1; i >= 0 && left > 0; i--) {
			const s = this.slots[i];
			if (s == null || s.id !== id) continue;
			const n = Math.min(left, s.count);
			s.count -= n;
			left -= n;
			if (s.count <= 0) this.slots[i] = null;
		}
		return true;
	}

	public count(id: number): number {
		let n = 0;
		for (const s of this.slots) {
			if (s != null && s.id === id) n += s.count;
		}
		return n;
	}

	public has(ingredients: { id: number; count: number }[]): boolean {
		return ingredients.every(ing => this.count(ing.id) >= ing.count);
	}

	public take(slot: number, count: number): boolean {
		const s = this.slots[slot];
		if (s == null || count <= 0 || s.count < count) return false;
		s.count -= count;
		if (s.count <= 0) this.slots[slot] = null;
		return true;
	}

	public move(from: number, to: number): void {
		if (from === to) return;
		if (from < 0 || to < 0 || from >= this.slots.length || to >= this.slots.length) return;
		const a = this.slots[from];
		const b = this.slots[to];
		if (a == null) return;
		if (b != null && b.id === a.id) {
			const max = ITEM_DEFS[a.id]?.maxStack ?? 1;
			const n = Math.min(a.count, max - b.count);
			if (n > 0) {
				b.count += n;
				a.count -= n;
				if (a.count <= 0) this.slots[from] = null;
			}
			return;
		}
		this.slots[from] = b;
		this.slots[to] = a;
	}

	public serialize(): (number[] | null)[] {
		return this.slots.map(s => s == null ? null : [s.id, s.count]);
	}

	public load(data: unknown): void {
		this.clear();
		if (!Array.isArray(data)) return;
		for (let i = 0; i < this.slots.length && i < data.length; i++) {
			const entry: unknown = data[i];
			if (!Array.isArray(entry) || entry.length < 2) continue;
			const id: unknown = entry[0];
			const count: unknown = entry[1];
			if (typeof id !== 'number' || typeof count !== 'number') continue;
			const def = ITEM_DEFS[id];
			if (def == null || !Number.isInteger(count) || count < 1 || count > def.maxStack) continue;
			this.slots[i] = { id, count };
		}
	}

	public clear(): void {
		this.slots.fill(null);
	}
}
