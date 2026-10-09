/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { MobType } from './constants.js';

/**
 * エンティティ (プレイヤー・MOB) の箱モデル。
 * モデル座標は足元の中心が原点で、yaw 0 のとき -z 方向 (math.ts の lookDir(0, 0)) を向く。
 * キャラクターの右手側が +x。頂点レイアウトは mesher.ts と同じ (x, y, z, u, v, sky, block, r, g, b)。
 */

export type EntityKind = 'player' | MobType | 'arrow';

export type EntityDraw = {
	kind: EntityKind;
	x: number;
	y: number;
	z: number;
	yaw: number;
	/** 頭の上下 (ラジアン、上が正)。矢では体全体の仰角 */
	pitch?: number;
	skinUrl?: string | null;
	walkPhase?: number;
	hurt?: boolean;
	/** 0..1 の明るさ (省略時 1) */
	light?: number;
	/** 0..1。倒れて沈み、透けていく */
	deathT?: number;
	/** 0..1 クリーパーの膨張 */
	swell?: number;
	scale?: number;
	/** 体に対する頭の左右の向き (ラジアン) */
	headYaw?: number;
};

/** テクスチャ上の矩形 (ピクセル) */
export type UvRect = { x: number; y: number; w: number; h: number };

export type BoxUv = {
	top: UvRect;
	bottom: UvRect;
	right: UvRect;
	front: UvRect;
	left: UvRect;
	back: UvRect;
};

export type SwingPart = 'leftArm' | 'rightArm' | 'leftLeg' | 'rightLeg';

export type ModelBox = {
	/** テクスチャ描画側が部位を見分けるための名前 */
	name: string;
	/** 最小コーナー (ブロック単位、モデル座標) */
	x: number;
	y: number;
	z: number;
	w: number;
	h: number;
	d: number;
	uv: BoxUv;
	/** 歩行で x 軸まわりに振る */
	swing?: SwingPart;
	/** 頭: headPitch / headYaw に追従する */
	head?: boolean;
	/** 回転の軸 (ブロック単位、モデル座標)。省略時は箱の上端中央 (頭は下端中央) */
	pivot?: [number, number, number];
	/** 固定の傾き (z 軸まわり / y 軸まわり、ラジアン) */
	restZ?: number;
	restY?: number;
	/** 歩行位相で y 軸まわりに振る (蜘蛛の脚) */
	ySwing?: { offset: number; amp: number };
	/** 羽ばたき (1: 右、-1: 左) */
	flap?: 1 | -1;
};

export type ModelDef = {
	boxes: ModelBox[];
	texW: number;
	texH: number;
	/** 足から頭頂まで (ブロック) */
	height: number;
	/** 腕を前に上げる角度 (ラジアン)。ゾンビ用 */
	armRaise: number;
};

export type ModelAnim = {
	walkPhase: number;
	headPitch?: number;
	headYaw?: number;
	/** 0..1 倒れる */
	deathT?: number;
	/** 0..1 クリーパーの膨張 */
	swell?: number;
};

export const MODEL_VERTEX_FLOATS = 10;
const VERTS_PER_BOX = 36;

/** Minecraft の標準的な箱の UV 展開。(ox, oy) は展開図の左上、w/h/d は箱の寸法 (テクスチャ px) */
export function boxUvLayout(ox: number, oy: number, w: number, h: number, d: number): BoxUv {
	return {
		top: { x: ox + d, y: oy, w, h: d },
		bottom: { x: ox + d + w, y: oy, w, h: d },
		right: { x: ox, y: oy + d, w: d, h },
		front: { x: ox + d, y: oy + d, w, h },
		left: { x: ox + d + w, y: oy + d, w: d, h },
		back: { x: ox + 2 * d + w, y: oy + d, w, h },
	};
}

/**
 * 箱を作る。寸法 (w, h, d) と展開図の位置 (tx, ty) はテクスチャ px、位置 (x, y, z) はブロック。
 * unit は 1 px が何ブロックか。
 */
function box(name: string, unit: number, tx: number, ty: number, w: number, h: number, d: number, x: number, y: number, z: number, swing?: SwingPart, head = false, pivot?: [number, number, number]): ModelBox {
	return { name, x, y, z, w: w * unit, h: h * unit, d: d * unit, uv: boxUvLayout(tx, ty, w, h, d), swing, head, pivot };
}

type PxOpts = {
	swing?: SwingPart;
	head?: boolean;
	/** px 単位のモデル座標 */
	pivot?: [number, number, number];
	restZ?: number;
	restY?: number;
	ySwing?: { offset: number; amp: number };
	flap?: 1 | -1;
	/** 展開図の位置を固定する (省略時は自動で詰める) */
	uv?: [number, number];
};

/** px 単位で箱を並べ、展開図を幅 texW の棚詰めで自動配置するビルダー */
class ModelBuilder {
	public boxes: ModelBox[] = [];
	private cx = 0;
	private cy = 0;
	private rowH = 0;
	private maxY = 0;

	constructor(private unit: number, private texW: number) {}

	public add(name: string, w: number, h: number, d: number, x: number, y: number, z: number, o: PxOpts = {}): this {
		const u = this.unit;
		let tx: number, ty: number;
		if (o.uv) {
			[tx, ty] = o.uv;
		} else {
			const rw = 2 * d + 2 * w;
			const rh = d + h;
			if (this.cx + rw > this.texW) {
				this.cx = 0;
				this.cy += this.rowH;
				this.rowH = 0;
			}
			tx = this.cx;
			ty = this.cy;
			this.cx += rw;
			this.rowH = Math.max(this.rowH, rh);
			this.maxY = Math.max(this.maxY, this.cy + this.rowH);
		}
		const b = box(name, u, tx, ty, w, h, d, x * u, y * u, z * u, o.swing, o.head === true);
		if (o.pivot) b.pivot = [o.pivot[0] * u, o.pivot[1] * u, o.pivot[2] * u];
		if (o.restZ != null) b.restZ = o.restZ;
		if (o.restY != null) b.restY = o.restY;
		if (o.ySwing) b.ySwing = o.ySwing;
		if (o.flap) b.flap = o.flap;
		this.boxes.push(b);
		return this;
	}

	public done(height: number, texH?: number): ModelDef {
		return { boxes: this.boxes, texW: this.texW, texH: texH ?? Math.max(16, this.maxY), height, armRaise: 0 };
	}
}

/** 64x64 の Minecraft スキン配置に従う人型。scale 1 で全高 2.0、プレイヤーは 0.9 で 1.8 */
function humanoid(scale: number, armRaise: number): ModelDef {
	const u = scale / 16;
	const s = scale;
	return {
		texW: 64,
		texH: 64,
		height: 2 * s,
		armRaise,
		boxes: [
			box('head', u, 0, 0, 8, 8, 8, -0.25 * s, 1.5 * s, -0.25 * s, undefined, true, [0, 1.5 * s, 0]),
			box('body', u, 16, 16, 8, 12, 4, -0.25 * s, 0.75 * s, -0.125 * s),
			box('rightArm', u, 40, 16, 4, 12, 4, 0.25 * s, 0.75 * s, -0.125 * s, 'rightArm'),
			box('leftArm', u, 32, 48, 4, 12, 4, -0.5 * s, 0.75 * s, -0.125 * s, 'leftArm'),
			box('rightLeg', u, 0, 16, 4, 12, 4, 0, 0, -0.125 * s, 'rightLeg'),
			box('leftLeg', u, 16, 48, 4, 12, 4, -0.25 * s, 0, -0.125 * s, 'leftLeg'),
		],
	};
}

/** スケルトン: 64x32 の旧スキン配置。腕と脚は 2px 幅で、左右は同じ展開図を共有する */
function skeleton(): ModelDef {
	const s = 0.97;
	const b = new ModelBuilder(s / 16, 64);
	b.add('head', 8, 8, 8, -4, 24, -4, { uv: [0, 0], head: true, pivot: [0, 24, 0] });
	b.add('body', 8, 12, 4, -4, 12, -2, { uv: [16, 16] });
	b.add('rightArm', 2, 12, 2, 4, 12, -1, { uv: [40, 16], swing: 'rightArm' });
	b.add('leftArm', 2, 12, 2, -6, 12, -1, { uv: [40, 16], swing: 'leftArm' });
	b.add('rightLeg', 2, 12, 2, 0, 0, -1, { uv: [0, 16], swing: 'rightLeg' });
	b.add('leftLeg', 2, 12, 2, -2, 0, -1, { uv: [0, 16], swing: 'leftLeg' });
	const m = b.done(2 * s, 32);
	m.armRaise = 0.5;
	return m;
}

function creeper(): ModelDef {
	const b = new ModelBuilder(0.065, 64);
	b.add('head', 8, 8, 8, -4, 18, -4, { head: true, pivot: [0, 18, 0] });
	b.add('body', 8, 12, 4, -4, 6, -2);
	b.add('leg', 4, 6, 4, 0, 0, -6, { swing: 'rightArm' });
	b.add('leg', 4, 6, 4, -4, 0, -6, { swing: 'leftArm' });
	b.add('leg', 4, 6, 4, 0, 0, 2, { swing: 'rightLeg' });
	b.add('leg', 4, 6, 4, -4, 0, 2, { swing: 'leftLeg' });
	return b.done(1.7);
}

function spider(): ModelDef {
	const b = new ModelBuilder(0.0625, 64);
	b.add('body', 10, 8, 10, -5, 5, -1);
	b.add('head', 8, 8, 8, -4, 5, -9, { head: true, pivot: [0, 5, -1] });
	const fan = [0.6, 0.25, -0.25, -0.6];
	const tilt = 0.7;
	for (let i = 0; i < 4; i++) {
		const z = [-4, 0, 4, 8][i];
		const off = i % 2 === 0 ? 0 : Math.PI;
		// 右側 (+x): 先端が下がるよう z 軸まわりは負、前の脚ほど前に開く
		b.add('leg', 16, 2, 2, 4, 9, z, { pivot: [4, 10, z + 1], restZ: -tilt, restY: fan[i], ySwing: { offset: off, amp: 0.35 } });
		b.add('leg', 16, 2, 2, -20, 9, z, { pivot: [-4, 10, z + 1], restZ: tilt, restY: -fan[i], ySwing: { offset: off + Math.PI, amp: 0.35 } });
	}
	return b.done(0.9);
}

function cow(): ModelDef {
	const b = new ModelBuilder(0.0625, 64);
	b.add('body', 12, 10, 18, -6, 12, -9);
	const hp: [number, number, number] = [0, 14, -9];
	b.add('head', 8, 8, 6, -4, 14, -15, { head: true, pivot: hp });
	b.add('horn', 1, 3, 1, -5, 20, -13, { head: true, pivot: hp });
	b.add('horn', 1, 3, 1, 4, 20, -13, { head: true, pivot: hp });
	b.add('leg', 4, 12, 4, 2, 0, -8, { swing: 'rightArm' });
	b.add('leg', 4, 12, 4, -6, 0, -8, { swing: 'leftArm' });
	b.add('leg', 4, 12, 4, 2, 0, 5, { swing: 'rightLeg' });
	b.add('leg', 4, 12, 4, -6, 0, 5, { swing: 'leftLeg' });
	return b.done(1.4);
}

function pig(): ModelDef {
	const b = new ModelBuilder(0.0625, 64);
	b.add('body', 10, 8, 16, -5, 6, -8);
	const hp: [number, number, number] = [0, 7, -8];
	b.add('head', 8, 8, 8, -4, 7, -16, { head: true, pivot: hp });
	b.add('snout', 4, 3, 1, -2, 8, -17, { head: true, pivot: hp });
	b.add('leg', 4, 6, 4, 1, 0, -7, { swing: 'rightArm' });
	b.add('leg', 4, 6, 4, -5, 0, -7, { swing: 'leftArm' });
	b.add('leg', 4, 6, 4, 1, 0, 4, { swing: 'rightLeg' });
	b.add('leg', 4, 6, 4, -5, 0, 4, { swing: 'leftLeg' });
	return b.done(0.9);
}

function sheep(): ModelDef {
	const b = new ModelBuilder(0.0625, 64);
	b.add('body', 10, 8, 16, -5, 12, -8);
	b.add('head', 6, 6, 8, -3, 13, -16, { head: true, pivot: [0, 13, -8] });
	b.add('leg', 4, 12, 4, 1, 0, -7, { swing: 'rightArm' });
	b.add('leg', 4, 12, 4, -5, 0, -7, { swing: 'leftArm' });
	b.add('leg', 4, 12, 4, 1, 0, 3, { swing: 'rightLeg' });
	b.add('leg', 4, 12, 4, -5, 0, 3, { swing: 'leftLeg' });
	return b.done(1.3);
}

function chicken(): ModelDef {
	const b = new ModelBuilder(0.05, 64);
	b.add('body', 6, 6, 8, -3, 5, -4);
	const hp: [number, number, number] = [0, 8, -4];
	b.add('head', 4, 6, 3, -2, 8, -7, { head: true, pivot: hp });
	b.add('beak', 4, 2, 2, -2, 11, -9, { head: true, pivot: hp });
	b.add('wattle', 2, 2, 2, -1, 9, -8, { head: true, pivot: hp });
	b.add('leg', 2, 5, 2, 1, 0, -1, { swing: 'rightLeg' });
	b.add('leg', 2, 5, 2, -3, 0, -1, { swing: 'leftLeg' });
	b.add('wing', 1, 4, 6, 3, 6, -3, { pivot: [3.5, 10, 0], flap: 1 });
	b.add('wing', 1, 4, 6, -4, 6, -3, { pivot: [-3.5, 10, 0], flap: -1 });
	return b.done(0.7);
}

/** 矢: 長さ 0.5、太さ 0.05。原点が中心で、先端が -z */
function arrow(): ModelDef {
	const b = new ModelBuilder(0.025, 64);
	b.add('arrow', 2, 2, 20, -1, -1, -10);
	return b.done(0.05);
}

/** 狼: 1 px = 0.05 ブロック。テクスチャ 64x64 */
function wolf(): ModelDef {
	const u = 0.05;
	return {
		texW: 64,
		texH: 64,
		height: 0.85,
		armRaise: 0,
		boxes: [
			box('body', u, 0, 0, 8, 8, 18, -0.2, 0.4, -0.3),
			box('head', u, 0, 26, 8, 8, 8, -0.2, 0.45, -0.7, undefined, true, [0, 0.45, -0.3]),
			// 前脚は右 (rightArm) と左 (leftArm)、後脚は右 (rightLeg) と左 (leftLeg)
			box('leg', u, 0, 42, 3, 8, 3, 0.05, 0, -0.28, 'rightArm'),
			box('leg', u, 12, 42, 3, 8, 3, -0.2, 0, -0.28, 'leftArm'),
			box('leg', u, 24, 42, 3, 8, 3, 0.05, 0, 0.45, 'rightLeg'),
			box('leg', u, 36, 42, 3, 8, 3, -0.2, 0, 0.45, 'leftLeg'),
			box('tail', u, 0, 53, 3, 3, 6, -0.075, 0.6, 0.6),
		],
	};
}

/** 熊: 1 px = 0.05 ブロック。テクスチャ 128x80 */
function bear(): ModelDef {
	const u = 0.05;
	return {
		texW: 128,
		texH: 80,
		height: 1.3,
		armRaise: 0,
		boxes: [
			box('body', u, 0, 0, 20, 16, 26, -0.5, 0.5, -0.45),
			box('head', u, 0, 42, 10, 10, 10, -0.25, 0.65, -0.95, undefined, true, [0, 0.65, -0.45]),
			box('leg', u, 0, 62, 6, 10, 6, 0.2, 0, -0.4, 'rightArm'),
			box('leg', u, 24, 62, 6, 10, 6, -0.5, 0, -0.4, 'leftArm'),
			box('leg', u, 48, 62, 6, 10, 6, 0.2, 0, 0.5, 'rightLeg'),
			box('leg', u, 72, 62, 6, 10, 6, -0.5, 0, 0.5, 'leftLeg'),
		],
	};
}

const models = new Map<EntityKind, ModelDef>();

/** 種類ごとのモデル定義 (初回だけ作って使い回す) */
export function modelFor(kind: EntityKind): ModelDef {
	let m = models.get(kind);
	if (m == null) {
		switch (kind) {
			case 'player': m = humanoid(0.9, 0); break;
			case 'zombie': m = humanoid(0.95, 1.45); break;
			case 'skeleton': m = skeleton(); break;
			case 'creeper': m = creeper(); break;
			case 'spider': m = spider(); break;
			case 'cow': m = cow(); break;
			case 'pig': m = pig(); break;
			case 'sheep': m = sheep(); break;
			case 'chicken': m = chicken(); break;
			case 'arrow': m = arrow(); break;
			case 'wolf': m = wolf(); break;
			case 'bear': m = bear(); break;
		}
		models.set(kind, m);
	}
	return m;
}

/** モデルに必要な Float32Array の長さ */
export function modelVertexFloats(model: ModelDef): number {
	return model.boxes.length * VERTS_PER_BOX * MODEL_VERTEX_FLOATS;
}

// 仕様では全速で腕が約 1.0 rad、脚が約 1.4 rad 振れる。少し控えめにする
const ARM_SWING_AMPLITUDE = 0.9;
const LEG_SWING_AMPLITUDE = 1.2;

function swingAngle(part: SwingPart, phase: number, armRaise: number): number {
	const s = Math.sin(phase);
	switch (part) {
		case 'rightArm': return s * ARM_SWING_AMPLITUDE + armRaise;
		case 'leftArm': return -s * ARM_SWING_AMPLITUDE + armRaise;
		case 'rightLeg': return -s * LEG_SWING_AMPLITUDE;
		case 'leftLeg': return s * LEG_SWING_AMPLITUDE;
	}
}

// 面ごとの 4 隅 (左下, 右下, 右上, 左上: 外から見て)。x0/x1 などは箱の最小/最大。順序は mesher.ts と同じ向き
// 型は [x選択, y選択, z選択] で 0 = 最小、1 = 最大
type Corner = [0 | 1, 0 | 1, 0 | 1];
const BOX_FACES: { key: keyof BoxUv; corners: [Corner, Corner, Corner, Corner]; shade: number }[] = [
	// +x (キャラクターの右)
	{ key: 'right', corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], shade: 0.8 },
	// -x (左)
	{ key: 'left', corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], shade: 0.8 },
	// +y
	{ key: 'top', corners: [[1, 1, 0], [0, 1, 0], [0, 1, 1], [1, 1, 1]], shade: 1.0 },
	// -y
	{ key: 'bottom', corners: [[1, 0, 1], [0, 0, 1], [0, 0, 0], [1, 0, 0]], shade: 0.5 },
	// +z (背中)
	{ key: 'back', corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], shade: 0.7 },
	// -z (正面)
	{ key: 'front', corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], shade: 0.7 },
];
const CORNER_UV: [number, number][] = [[0, 1], [1, 1], [1, 0], [0, 0]];
const TRI = [0, 1, 2, 0, 2, 3];

const FACE_IDX = BOX_FACES.map(f => f.corners.map(c => c[0] | (c[1] << 1) | (c[2] << 2)));
const cx8 = new Float32Array(8);
const cy8 = new Float32Array(8);
const cz8 = new Float32Array(8);

/**
 * 現在の姿勢でのモデルの頂点データ (pos, uv, shade, 0, 1, 1, 1) を作る。
 * 部位は z → x → y の順に回す (傾き → 振り・頭の上下 → 頭の左右・蜘蛛の脚の開き)。
 * 倒れる・膨らむは全体にかける。out を渡すと再利用する (長さは modelVertexFloats 以上)。
 */
export function buildModelVertices(model: ModelDef, anim: ModelAnim | number, out?: Float32Array): Float32Array {
	const a: ModelAnim = typeof anim === 'number' ? { walkPhase: anim } : anim;
	const data = out ?? new Float32Array(modelVertexFloats(model));
	const phase = a.walkPhase;
	const headPitch = Math.max(-1.4, Math.min(1.4, a.headPitch ?? 0));
	const headYaw = Math.max(-1.2, Math.min(1.2, a.headYaw ?? 0));
	const swell = a.swell ?? 0;
	const sxz = 1 + 0.3 * swell;
	const sy = 1 + 0.08 * swell;
	const death = Math.max(0, Math.min(1, a.deathT ?? 0));
	const dc = Math.cos(death * Math.PI / 2);
	const ds = Math.sin(death * Math.PI / 2);
	const sink = death * 0.3;
	let n = 0;
	for (const b of model.boxes) {
		let rx = b.swing != null ? swingAngle(b.swing, phase, model.armRaise) : 0;
		let ry = b.restY ?? 0;
		let rz = b.restZ ?? 0;
		if (b.head) { rx += headPitch; ry += headYaw; }
		if (b.ySwing) ry += Math.sin(phase + b.ySwing.offset) * b.ySwing.amp;
		if (b.flap) rz += b.flap * (0.12 + 0.45 * Math.abs(Math.sin(phase * 1.7)));
		const pv = b.pivot ?? (b.head ? [b.x + b.w / 2, b.y, b.z + b.d / 2] : [b.x + b.w / 2, b.y + b.h, b.z + b.d / 2]);
		const cxr = Math.cos(rx), sxr = Math.sin(rx);
		const cyr = Math.cos(ry), syr = Math.sin(ry);
		const czr = Math.cos(rz), szr = Math.sin(rz);
		for (let i = 0; i < 8; i++) {
			let x = ((i & 1) ? b.x + b.w : b.x) - pv[0];
			let y = ((i & 2) ? b.y + b.h : b.y) - pv[1];
			let z = ((i & 4) ? b.z + b.d : b.z) - pv[2];
			if (rz !== 0) { const t = x * czr - y * szr; y = x * szr + y * czr; x = t; }
			if (rx !== 0) { const t = y * cxr - z * sxr; z = y * sxr + z * cxr; y = t; }
			if (ry !== 0) { const t = x * cyr + z * syr; z = -x * syr + z * cyr; x = t; }
			x += pv[0]; y += pv[1]; z += pv[2];
			if (swell > 0) { x *= sxz; z *= sxz; y *= sy; }
			if (death > 0) { const t = x * dc - y * ds; y = x * ds + y * dc - sink; x = t; }
			cx8[i] = x; cy8[i] = y; cz8[i] = z;
		}
		for (let fi = 0; fi < 6; fi++) {
			const face = BOX_FACES[fi];
			const r = b.uv[face.key];
			const idx = FACE_IDX[fi];
			for (const t of TRI) {
				const [uu, vv] = CORNER_UV[t];
				const ci = idx[t];
				data[n++] = cx8[ci];
				data[n++] = cy8[ci];
				data[n++] = cz8[ci];
				data[n++] = (r.x + uu * r.w) / model.texW;
				data[n++] = (r.y + vv * r.h) / model.texH;
				data[n++] = face.shade;
				data[n++] = 0;
				data[n++] = 1;
				data[n++] = 1;
				data[n++] = 1;
			}
		}
	}
	return data;
}
