/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import ipaddr from 'ipaddr.js';

// bsky-fork 独自: CIDR の一覧に IP が含まれるかを二分探索で調べる集合。
// IPv4 は IPv4-mapped IPv6 (::ffff:a.b.c.d) として 128 bit の数直線に載せ、IPv6 と同じ配列で扱う。
// 登録時の送信元 IP をデータセンター/VPN の一覧 (数万件) と照合するのに使う。

export type IpRange = { start: bigint; end: bigint };

const V4_MAPPED_OFFSET = 96;
const MAX_V6 = (1n << 128n) - 1n;

function addressToBigInt(addr: ipaddr.IPv4 | ipaddr.IPv6): bigint {
	const v6 = addr.kind() === 'ipv4' ? (addr as ipaddr.IPv4).toIPv4MappedAddress() : (addr as ipaddr.IPv6);
	let n = 0n;
	for (const byte of v6.toByteArray()) {
		n = (n << 8n) | BigInt(byte);
	}
	return n;
}

/**
 * CIDR または単一の IP を範囲に変換する。解釈できなければ null。
 */
export function cidrToRange(entry: string): IpRange | null {
	const text = entry.trim();
	if (text === '') return null;
	try {
		let addr: ipaddr.IPv4 | ipaddr.IPv6;
		let prefix: number;
		if (text.includes('/')) {
			const parsed = ipaddr.parseCIDR(text);
			addr = parsed[0];
			prefix = parsed[1];
		} else {
			addr = ipaddr.parse(text);
			prefix = addr.kind() === 'ipv4' ? 32 : 128;
		}
		if (addr.kind() === 'ipv4') prefix += V4_MAPPED_OFFSET;
		if (prefix < 0 || prefix > 128) return null;
		const base = addressToBigInt(addr);
		const hostBits = BigInt(128 - prefix);
		const mask = hostBits === 0n ? MAX_V6 : (MAX_V6 << hostBits) & MAX_V6;
		const start = base & mask;
		const end = start | (MAX_V6 >> BigInt(prefix));
		return { start, end };
	} catch {
		return null;
	}
}

/**
 * IP 文字列を数直線上の値にする。解釈できなければ null。
 */
export function ipToBigInt(ip: string): bigint | null {
	try {
		return addressToBigInt(ipaddr.parse(ip.trim()));
	} catch {
		return null;
	}
}

export class IpRangeSet {
	private readonly ranges: IpRange[];

	constructor(ranges: Iterable<IpRange>) {
		const sorted = [...ranges].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
		const merged: IpRange[] = [];
		for (const r of sorted) {
			const last = merged[merged.length - 1];
			if (last != null && r.start <= last.end + 1n) {
				if (r.end > last.end) last.end = r.end;
			} else {
				merged.push({ start: r.start, end: r.end });
			}
		}
		this.ranges = merged;
	}

	/**
	 * CIDR の一覧 (1 行 1 件、空行と # コメントは無視) から作る。
	 * 返り値の invalid は解釈できなかった行の数。
	 */
	public static fromCidrLines(lines: Iterable<string>): { set: IpRangeSet; valid: number; invalid: number } {
		const ranges: IpRange[] = [];
		let invalid = 0;
		for (const raw of lines) {
			const line = raw.replace(/#.*$/, '').trim();
			if (line === '') continue;
			const range = cidrToRange(line);
			if (range == null) {
				invalid++;
				continue;
			}
			ranges.push(range);
		}
		return { set: new IpRangeSet(ranges), valid: ranges.length, invalid };
	}

	/** まとめた後の範囲の数 */
	public get size(): number {
		return this.ranges.length;
	}

	public has(ip: string): boolean {
		const n = ipToBigInt(ip);
		if (n == null) return false;
		let lo = 0;
		let hi = this.ranges.length - 1;
		while (lo <= hi) {
			const mid = (lo + hi) >> 1;
			const r = this.ranges[mid];
			if (n < r.start) {
				hi = mid - 1;
			} else if (n > r.end) {
				lo = mid + 1;
			} else {
				return true;
			}
		}
		return false;
	}
}
