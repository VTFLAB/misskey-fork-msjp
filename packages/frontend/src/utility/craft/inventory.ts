/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { ARMOR_MATERIALS, ARMOR_SLOTS, ITEM_DEFS, PLAYER } from './constants.js';
import type { EnchantId, Ingredient } from './constants.js';
import { canMerge, cloneStack, damageItem, deserializeStack, enchantLevel, hasEnchants, maxStackOf, serializeStack } from './items.js';
import type { ItemStack, SerializedStack } from './types.js';

/** 0..8 ホットバー、9..35 メイン、36..39 防具 (兜、胸、脚、靴) */
export class Inventory {
	public readonly slots: ItemStack[];

	constructor() {
		this.slots = new Array<ItemStack>(PLAYER.totalSlots).fill(null);
	}

	/** メイン (9..35) を重ねて並べ替える。ホットバーと防具枠は触らない。変わったら true */
	public sort(): boolean {
		const start = PLAYER.hotbarSize;
		const end = PLAYER.inventorySize;
		const before = JSON.stringify(this.serialize().slice(start, end));
		const merged: NonNullable<ItemStack>[] = [];
		for (let i = start; i < end; i++) {
			const s = this.slots[i];
			if (s == null) continue;
			const max = maxStackOf(s);
			let left = s.count;
			if (max > 1) {
				for (const m of merged) {
					if (left <= 0) break;
					if (canMerge(m, s) && m.count < max) {
						const n = Math.min(left, max - m.count);
						m.count += n;
						left -= n;
					}
				}
			}
			if (left > 0) {
				const c = cloneStack(s) as NonNullable<ItemStack>;
				c.count = left;
				merged.push(c);
			}
		}
		const armorRank = (id: number): number => {
			const m = ARMOR_MATERIALS.find(a => a.index === Math.floor((id - 300) / 10));
			return m == null ? 0 : m.points.reduce((a, b) => a + b, 0) + m.toughness;
		};
		const key = (s: NonNullable<ItemStack>): number[] => {
			const def = ITEM_DEFS[s.id];
			const plain = (hasEnchants(s) || (s.dmg ?? 0) > 0) ? 0 : 1;
			if (def?.kind === 'tool' && def.tool != null) {
				const mat = Math.floor((s.id - 200) / 10);
				return [0, -def.tool.tier, -mat, s.id, plain, -s.count];
			}
			if (def?.kind === 'armor' && def.armor != null) return [1, -armorRank(s.id), def.armor.slotIndex, s.id, plain, -s.count];
			const cat = def?.kind === 'bow' ? 2 : def?.kind === 'food' ? 3 : def?.kind === 'block' ? 4 : 5;
			return [cat, s.id, plain, -s.count];
		};
		merged.sort((a, b) => {
			const ka = key(a), kb = key(b);
			for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
				const d = (ka[i] ?? 0) - (kb[i] ?? 0);
				if (d !== 0) return d;
			}
			return 0;
		});
		for (let i = start; i < end; i++) this.slots[i] = merged[i - start] ?? null;
		return JSON.stringify(this.serialize().slice(start, end)) !== before;
	}

	/** 防具枠か */
	public static isArmorSlot(index: number): boolean {
		return index >= PLAYER.armorSlotStart && index < PLAYER.totalSlots;
	}

	/** 入りきらなかった個数を返す (防具枠には入れない) */
	public add(id: number, count: number): number {
		if (ITEM_DEFS[id] == null || count <= 0) return Math.max(0, count);
		return this.addStack({ id, count });
	}

	/** 入りきらなかった個数を返す。stack 自体は変更しない */
	public addStack(stack: NonNullable<ItemStack>): number {
		if (ITEM_DEFS[stack.id] == null || stack.count <= 0) return Math.max(0, stack.count);
		let left = stack.count;
		const max = maxStackOf(stack);
		if (max > 1) {
			for (let i = 0; i < PLAYER.inventorySize && left > 0; i++) {
				const s = this.slots[i];
				if (s != null && canMerge(s, stack) && s.count < max) {
					const n = Math.min(left, max - s.count);
					s.count += n;
					left -= n;
				}
			}
		}
		for (let i = 0; i < PLAYER.inventorySize && left > 0; i++) {
			if (this.slots[i] == null) {
				const n = Math.min(left, max);
				const placed = cloneStack(stack) as NonNullable<ItemStack>;
				placed.count = n;
				this.slots[i] = placed;
				left -= n;
			}
		}
		return left;
	}

	/** 作る・燃料に使える素材の個数 (メイン 36 枠のみ。防具枠は数えない) */
	public count(id: number): number {
		let n = 0;
		for (let i = 0; i < PLAYER.inventorySize; i++) {
			const s = this.slots[i];
			if (s != null && s.id === id) n += s.count;
		}
		return n;
	}

	public countOf(ingredient: Ingredient): number {
		let n = 0;
		for (const id of ingredient.ids) n += this.count(id);
		return n;
	}

	public has(ingredients: Ingredient[]): boolean {
		// 同じ素材を複数の材料が使う場合に備えて、合計で確かめる
		const need = new Map<number, number>();
		for (const ing of ingredients) {
			if (ing.ids.length === 1) need.set(ing.ids[0], (need.get(ing.ids[0]) ?? 0) + ing.count);
			else if (this.countOf(ing) < ing.count) return false;
		}
		for (const [id, n] of need) if (this.count(id) < n) return false;
		return true;
	}

	/** ingredient を消費する。無印・無傷の枠を優先し、後ろの枠から減らす */
	public remove(ingredient: Ingredient): boolean {
		if (this.countOf(ingredient) < ingredient.count) return false;
		const candidates: number[] = [];
		for (let i = PLAYER.inventorySize - 1; i >= 0; i--) {
			const s = this.slots[i];
			if (s != null && ingredient.ids.includes(s.id)) candidates.push(i);
		}
		const plain = (i: number): boolean => {
			const s = this.slots[i];
			return s != null && !hasEnchants(s) && (s.dmg ?? 0) === 0;
		};
		const rank = (i: number): number => ingredient.ids.indexOf(this.slots[i]!.id);
		// 無印を先に、次に ids の並び順 (燃料なら石炭が先)。同順位は後ろの枠から (sort は安定)
		candidates.sort((a, b) => (Number(plain(b)) - Number(plain(a))) || (rank(a) - rank(b)));
		let left = ingredient.count;
		for (const i of candidates) {
			if (left <= 0) break;
			const s = this.slots[i]!;
			const n = Math.min(left, s.count);
			s.count -= n;
			left -= n;
			if (s.count <= 0) this.slots[i] = null;
		}
		return true;
	}

	public take(slot: number, count: number): boolean {
		const s = this.slots[slot];
		if (s == null || count <= 0 || s.count < count) return false;
		s.count -= count;
		if (s.count <= 0) this.slots[slot] = null;
		return true;
	}

	/** その枠の中身を捨てる (空にする)。捨てた stack を返す */
	public discard(index: number): ItemStack {
		const s = this.slots[index] ?? null;
		this.slots[index] = null;
		return s;
	}

	public findSlot(id: number): number {
		for (let i = 0; i < PLAYER.inventorySize; i++) {
			if (this.slots[i]?.id === id) return i;
		}
		return -1;
	}

	/** stack を slot に置けるか (防具枠は部位が合う防具だけ) */
	public accepts(slot: number, stack: ItemStack): boolean {
		if (stack == null || !Inventory.isArmorSlot(slot)) return true;
		return ITEM_DEFS[stack.id]?.armor?.slotIndex === slot - PLAYER.armorSlotStart;
	}

	/** from の中身を to に移す。同じ物なら重ね、そうでなければ入れ替える。動かせたら true */
	public move(from: number, to: number): boolean {
		if (from === to) return false;
		if (from < 0 || to < 0 || from >= this.slots.length || to >= this.slots.length) return false;
		const a = this.slots[from];
		const b = this.slots[to];
		if (a == null) return false;
		if (!this.accepts(to, a) || !this.accepts(from, b)) return false;
		if (b != null && canMerge(a, b)) {
			const n = Math.min(a.count, maxStackOf(b) - b.count);
			if (n > 0) {
				b.count += n;
				a.count -= n;
				if (a.count <= 0) this.slots[from] = null;
				return true;
			}
			return false;
		}
		this.slots[from] = b;
		this.slots[to] = a;
		return true;
	}

	/** 防具を対応する防具枠へ着る (入れ替え)。着られたら true */
	public equipFromSlot(index: number): boolean {
		const s = this.slots[index];
		const armor = s != null ? ITEM_DEFS[s.id]?.armor : undefined;
		if (s == null || armor == null || Inventory.isArmorSlot(index)) return false;
		return this.move(index, PLAYER.armorSlotStart + armor.slotIndex);
	}

	/** 防具枠の防具を外してバッグに戻す。入らなければ false */
	public unequip(index: number): boolean {
		if (!Inventory.isArmorSlot(index)) return false;
		const s = this.slots[index];
		if (s == null) return false;
		for (let i = 0; i < PLAYER.inventorySize; i++) {
			if (this.slots[i] == null) {
				this.slots[i] = s;
				this.slots[index] = null;
				return true;
			}
		}
		return false;
	}

	private armorPieces(): NonNullable<ItemStack>[] {
		const out: NonNullable<ItemStack>[] = [];
		for (let i = 0; i < PLAYER.armorSlots; i++) {
			const s = this.slots[PLAYER.armorSlotStart + i];
			if (s != null) out.push(s);
		}
		return out;
	}

	public armorPoints(): number {
		let n = 0;
		for (const s of this.armorPieces()) n += ITEM_DEFS[s.id]?.armor?.points ?? 0;
		return n;
	}

	public armorToughness(): number {
		let n = 0;
		for (const s of this.armorPieces()) n += ITEM_DEFS[s.id]?.armor?.toughness ?? 0;
		return n;
	}

	/** 4 部位のエンチャントレベルの合計 */
	public armorEnchantLevel(id: EnchantId): number {
		let n = 0;
		for (const s of this.armorPieces()) n += enchantLevel(s, id);
		return n;
	}

	/** 装備中の防具それぞれの耐久を amount 減らす。壊れた防具の id 一覧を返す */
	public damageArmor(amount: number, random: () => number = Math.random): number[] {
		const broke: number[] = [];
		for (let i = 0; i < PLAYER.armorSlots; i++) {
			const idx = PLAYER.armorSlotStart + i;
			const s = this.slots[idx];
			if (s != null && damageItem(s, amount, random)) {
				broke.push(s.id);
				this.slots[idx] = null;
			}
		}
		return broke;
	}

	/** 枠の道具・防具の耐久を減らす。壊れたら枠を空にして true */
	public damageSlot(index: number, amount: number, random: () => number = Math.random): boolean {
		const s = this.slots[index];
		if (s == null || amount <= 0) return false;
		if (damageItem(s, amount, random)) {
			this.slots[index] = null;
			return true;
		}
		return false;
	}

	/** 防具の部位名 (表示用) */
	public static armorSlotName(index: number): string {
		return ARMOR_SLOTS[index - PLAYER.armorSlotStart] ?? '';
	}

	public serialize(): SerializedStack[] {
		return this.slots.map(s => serializeStack(s));
	}

	/** 保存データを読む。古い 36 枠の配列も読める */
	public load(data: unknown): void {
		this.clear();
		if (!Array.isArray(data)) return;
		for (let i = 0; i < this.slots.length && i < data.length; i++) {
			const stack = deserializeStack(data[i]);
			if (stack != null && this.accepts(i, stack)) this.slots[i] = stack;
		}
	}

	public clear(): void {
		this.slots.fill(null);
	}
}
