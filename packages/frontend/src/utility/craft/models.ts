/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * エンティティ (プレイヤー・MOB) の箱モデル。
 * モデル座標は足元の中心が原点で、yaw 0 のとき -z 方向 (math.ts の lookDir(0, 0)) を向く。
 * キャラクターの右手側が +x。頂点レイアウトは mesher.ts と同じ (x, y, z, u, v, light)。
 */

export type EntityKind = 'player' | 'zombie' | 'wolf' | 'bear';

export type EntityDraw = {
	kind: EntityKind;
	x: number;
	y: number;
	z: number;
	yaw: number;
	skinUrl?: string | null;
	walkPhase?: number;
	hurt?: boolean;
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
	swing?: SwingPart;
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

export const MODEL_VERTEX_FLOATS = 6;
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
function box(name: string, unit: number, tx: number, ty: number, w: number, h: number, d: number, x: number, y: number, z: number, swing?: SwingPart): ModelBox {
	return { name, x, y, z, w: w * unit, h: h * unit, d: d * unit, uv: boxUvLayout(tx, ty, w, h, d), swing };
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
			box('head', u, 0, 0, 8, 8, 8, -0.25 * s, 1.5 * s, -0.25 * s),
			box('body', u, 16, 16, 8, 12, 4, -0.25 * s, 0.75 * s, -0.125 * s),
			box('rightArm', u, 40, 16, 4, 12, 4, 0.25 * s, 0.75 * s, -0.125 * s, 'rightArm'),
			box('leftArm', u, 32, 48, 4, 12, 4, -0.5 * s, 0.75 * s, -0.125 * s, 'leftArm'),
			box('rightLeg', u, 0, 16, 4, 12, 4, 0, 0, -0.125 * s, 'rightLeg'),
			box('leftLeg', u, 16, 48, 4, 12, 4, -0.25 * s, 0, -0.125 * s, 'leftLeg'),
		],
	};
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
			box('head', u, 0, 26, 8, 8, 8, -0.2, 0.45, -0.7),
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
			box('head', u, 0, 42, 10, 10, 10, -0.25, 0.65, -0.95),
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
		m = kind === 'player' ? humanoid(0.9, 0)
			: kind === 'zombie' ? humanoid(0.95, 1.45)
			: kind === 'wolf' ? wolf()
			: bear();
		models.set(kind, m);
	}
	return m;
}

/** モデルに必要な Float32Array の長さ */
export function modelVertexFloats(model: ModelDef): number {
	return model.boxes.length * VERTS_PER_BOX * MODEL_VERTEX_FLOATS;
}

const SWING_AMPLITUDE = 0.6;

function swingAngle(part: SwingPart, phase: number, armRaise: number): number {
	const s = Math.sin(phase) * SWING_AMPLITUDE;
	switch (part) {
		case 'rightArm': return s + armRaise;
		case 'leftArm': return -s + armRaise;
		case 'rightLeg': return -s;
		case 'leftLeg': return s;
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

/**
 * 現在の歩行位相でのモデルの頂点データ (pos, uv, light) を作る。
 * 肢は上端を軸に x 軸まわりに振る。out を渡すと再利用する (長さは modelVertexFloats 以上)。
 */
export function buildModelVertices(model: ModelDef, walkPhase = 0, out?: Float32Array): Float32Array {
	const data = out ?? new Float32Array(modelVertexFloats(model));
	let n = 0;
	const px: number[] = [0, 0, 0, 0];
	const py: number[] = [0, 0, 0, 0];
	const pz: number[] = [0, 0, 0, 0];
	for (const b of model.boxes) {
		const angle = b.swing != null ? swingAngle(b.swing, walkPhase, model.armRaise) : 0;
		const ca = Math.cos(angle);
		const sa = Math.sin(angle);
		const pivotY = b.y + b.h;
		const pivotZ = b.z + b.d / 2;
		for (const face of BOX_FACES) {
			const r = b.uv[face.key];
			for (let i = 0; i < 4; i++) {
				const c = face.corners[i];
				const x = c[0] === 1 ? b.x + b.w : b.x;
				const y = c[1] === 1 ? b.y + b.h : b.y;
				const z = c[2] === 1 ? b.z + b.d : b.z;
				const dy = y - pivotY;
				const dz = z - pivotZ;
				px[i] = x;
				py[i] = pivotY + dy * ca - dz * sa;
				pz[i] = pivotZ + dy * sa + dz * ca;
			}
			for (const t of TRI) {
				const [uu, vv] = CORNER_UV[t];
				data[n++] = px[t];
				data[n++] = py[t];
				data[n++] = pz[t];
				data[n++] = (r.x + uu * r.w) / model.texW;
				data[n++] = (r.y + vv * r.h) / model.texH;
				data[n++] = face.shade;
			}
		}
	}
	return data;
}
