/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';
import type { IPaginator } from '@/utility/paginator.js';

const api = vi.fn();
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: (...args: unknown[]) => api(...args) }));

type Item = { id: string; createdAt: string };

function item(id: string): Item {
	return { id, createdAt: '2026-10-27T00:00:00.000Z' };
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((res) => { resolve = res; });
	return { promise, resolve };
}

async function createPaginator(): Promise<IPaginator<Item>> {
	const { Paginator } = await import('@/utility/paginator.js');
	// エンドポイントの型は Note に縛られるが、テストでは misskeyApi をモックしているので Item として扱う
	return new Paginator('notes/global-timeline', { useShallowRef: true }) as unknown as IPaginator<Item>;
}

describe('Paginator duplicate guards', () => {
	beforeEach(() => {
		vi.resetModules();
		api.mockReset();
	});

	test('init() が連続して呼ばれても、古い応答で同じアイテムが二重に積まれない', async () => {
		const paginator = await createPaginator();
		const first = deferred<Item[]>();
		const second = deferred<Item[]>();
		api.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

		const p1 = paginator.init();
		const p2 = paginator.reload();

		second.resolve([item('c'), item('b'), item('a')]);
		await p2;
		first.resolve([item('c'), item('b'), item('a')]);
		await p1;

		expect(paginator.items.value.map(x => x.id)).toEqual(['c', 'b', 'a']);
		expect(paginator.fetching.value).toBe(false);
	});

	test('読み込み中にストリームで届いたノートが API 応答にも含まれていても 1 件になる', async () => {
		const paginator = await createPaginator();
		const res = deferred<Item[]>();
		api.mockReturnValueOnce(res.promise);

		const p = paginator.init();
		paginator.prepend(item('c'));
		res.resolve([item('c'), item('b'), item('a')]);
		await p;

		expect(paginator.items.value.map(x => x.id)).toEqual(['c', 'b', 'a']);
	});

	test('同じノートが何度もキューに届いても releaseQueue() で 1 件だけ表示される', async () => {
		const paginator = await createPaginator();
		api.mockResolvedValueOnce([item('b'), item('a')]);
		await paginator.init();

		for (let i = 0; i < 20; i++) paginator.enqueue(item('c'));
		paginator.enqueue(item('b')); // 表示済みのノートが再度届いた場合
		expect(paginator.queuedAheadItemsCount.value).toBe(1);

		paginator.releaseQueue();

		expect(paginator.items.value.map(x => x.id)).toEqual(['c', 'b', 'a']);
		expect(paginator.queuedAheadItemsCount.value).toBe(0);
	});

	test('unshiftItems() / pushItems() はバッチ内の重複と表示済みのアイテムを取り除く', async () => {
		const paginator = await createPaginator();
		api.mockResolvedValueOnce([item('b'), item('a')]);
		await paginator.init();

		paginator.unshiftItems([item('d'), item('d'), item('c'), item('b')]);
		paginator.pushItems([item('a'), item('z'), item('z')]);

		expect(paginator.items.value.map(x => x.id)).toEqual(['d', 'c', 'b', 'a', 'z']);
	});

	test('fetchNewer({ toQueue: true }) はキュー済み・表示済みのアイテムを積まない', async () => {
		const paginator = await createPaginator();
		api.mockResolvedValueOnce([item('b'), item('a')]);
		await paginator.init();

		// sinceId 指定の API 応答は古い順で返る
		api.mockResolvedValueOnce([item('b'), item('c'), item('d')]);
		await paginator.fetchNewer({ toQueue: true });
		api.mockResolvedValueOnce([item('d'), item('e')]);
		await paginator.fetchNewer({ toQueue: true });

		expect(paginator.queuedAheadItemsCount.value).toBe(3);
		paginator.releaseQueue();
		expect(paginator.items.value.map(x => x.id)).toEqual(['e', 'd', 'c', 'b', 'a']);
	});
});
