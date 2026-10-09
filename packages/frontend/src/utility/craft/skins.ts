/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { boxUvLayout, modelFor } from './models.js';
import type { BoxUv, EntityKind, UvRect } from './models.js';

/**
 * エンティティのテクスチャを canvas で手続き的に描く。
 * 人型は Minecraft の 64x64 スキン配置 (models.ts の boxUvLayout と同じ)。
 */

type Rgb = [number, number, number];

function rand(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
		return s / 4294967296;
	};
}

function css(c: Rgb, d = 0): string {
	const f = (v: number) => Math.max(0, Math.min(255, Math.round(v + d)));
	return `rgb(${f(c[0])},${f(c[1])},${f(c[2])})`;
}

function scale(c: Rgb, k: number): Rgb {
	return [Math.min(255, c[0] * k), Math.min(255, c[1] * k), Math.min(255, c[2] * k)];
}

function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
	const canvas = window.document.createElement('canvas');
	canvas.width = w;
	canvas.height = h;
	return { canvas, ctx: canvas.getContext('2d')! };
}

/** 矩形の全画素を、座標から決まる色で塗る */
function fillRect(ctx: CanvasRenderingContext2D, r: UvRect, color: (x: number, y: number) => string): void {
	for (let y = 0; y < r.h; y++) {
		for (let x = 0; x < r.w; x++) {
			ctx.fillStyle = color(x, y);
			ctx.fillRect(r.x + x, r.y + y, 1, 1);
		}
	}
}

function dot(ctx: CanvasRenderingContext2D, r: UvRect, x: number, y: number, color: string, w = 1, h = 1): void {
	ctx.fillStyle = color;
	ctx.fillRect(r.x + x, r.y + y, w, h);
}

const FACE_KEYS: (keyof BoxUv)[] = ['top', 'bottom', 'right', 'front', 'left', 'back'];

// ----- 人型 (プレイヤー・ゾンビ) -----

type HumanoidPalette = {
	skin: Rgb;
	hair: Rgb;
	/** 前髪・側頭部の髪の行数 */
	hairRows: number;
	shirt: Rgb;
	/** 袖の行数 (腕の上から) */
	sleeveRows: number;
	pants: Rgb;
	shoes: Rgb;
	eyeWhite: string;
	eyePupil: string;
	mouth: string;
	/** ズボンの行数 (脚の上から)。残りは靴 */
	pantsRows: number;
};

type HumanoidBox = { name: 'head' | 'body' | 'rightArm' | 'leftArm' | 'rightLeg' | 'leftLeg'; layout: BoxUv };

const HUMANOID_BOXES: HumanoidBox[] = [
	{ name: 'head', layout: boxUvLayout(0, 0, 8, 8, 8) },
	{ name: 'body', layout: boxUvLayout(16, 16, 8, 12, 4) },
	{ name: 'rightArm', layout: boxUvLayout(40, 16, 4, 12, 4) },
	{ name: 'leftArm', layout: boxUvLayout(32, 48, 4, 12, 4) },
	{ name: 'rightLeg', layout: boxUvLayout(0, 16, 4, 12, 4) },
	{ name: 'leftLeg', layout: boxUvLayout(16, 48, 4, 12, 4) },
];

function paintHumanoid(p: HumanoidPalette, seed: number): HTMLCanvasElement {
	const { canvas, ctx } = makeCanvas(64, 64);
	const r = rand(seed);
	const noisy = (c: Rgb, amount: number) => () => css(c, (r() - 0.5) * amount);

	for (const b of HUMANOID_BOXES) {
		const L = b.layout;
		switch (b.name) {
			case 'head': {
				for (const k of FACE_KEYS) fillRect(ctx, L[k], noisy(p.skin, 10));
				// 髪: 上面と後頭部は全部、側面と前面は上から hairRows 行
				fillRect(ctx, L.top, noisy(p.hair, 14));
				fillRect(ctx, L.back, noisy(p.hair, 14));
				for (const k of ['right', 'left', 'front'] as const) {
					fillRect(ctx, { ...L[k], h: p.hairRows }, noisy(p.hair, 14));
				}
				// 側面の後頭部寄り 3 列は髪を少し長くする (右面は u=0 が後ろ、左面は u=7 が後ろ)
				fillRect(ctx, { x: L.right.x, y: L.right.y, w: 3, h: p.hairRows + 2 }, noisy(p.hair, 14));
				fillRect(ctx, { x: L.left.x + 5, y: L.left.y, w: 3, h: p.hairRows + 2 }, noisy(p.hair, 14));
				scaleBottom(ctx, L.bottom, 0.8);
				// 目と口 (正面)
				const f = L.front;
				dot(ctx, f, 1, 4, p.eyeWhite, 1, 1);
				dot(ctx, f, 2, 4, p.eyePupil, 1, 1);
				dot(ctx, f, 5, 4, p.eyePupil, 1, 1);
				dot(ctx, f, 6, 4, p.eyeWhite, 1, 1);
				dot(ctx, f, 3, 6, p.mouth, 2, 1);
				break;
			}
			case 'body': {
				for (const k of FACE_KEYS) fillRect(ctx, L[k], noisy(p.shirt, 10));
				scaleBottom(ctx, L.bottom, 0.75);
				break;
			}
			case 'rightArm':
			case 'leftArm': {
				for (const k of FACE_KEYS) fillRect(ctx, L[k], noisy(p.skin, 10));
				fillRect(ctx, L.top, noisy(p.shirt, 10));
				for (const k of ['right', 'front', 'left', 'back'] as const) {
					fillRect(ctx, { ...L[k], h: p.sleeveRows }, noisy(p.shirt, 10));
				}
				break;
			}
			case 'rightLeg':
			case 'leftLeg': {
				for (const k of FACE_KEYS) fillRect(ctx, L[k], noisy(p.pants, 10));
				for (const k of ['right', 'front', 'left', 'back'] as const) {
					const rc = L[k];
					fillRect(ctx, { x: rc.x, y: rc.y + p.pantsRows, w: rc.w, h: rc.h - p.pantsRows }, noisy(p.shoes, 10));
				}
				fillRect(ctx, L.bottom, noisy(p.shoes, 10));
				break;
			}
		}
	}
	return canvas;
}

/** 下面を暗くして陰影をつける */
function scaleBottom(ctx: CanvasRenderingContext2D, r: UvRect, k: number): void {
	const img = ctx.getImageData(r.x, r.y, r.w, r.h);
	for (let i = 0; i < img.data.length; i += 4) {
		img.data[i] *= k; img.data[i + 1] *= k; img.data[i + 2] *= k;
	}
	ctx.putImageData(img, r.x, r.y);
}

/** Steve 風の標準スキン (64x64) */
export function buildDefaultSkin(): HTMLCanvasElement {
	return paintHumanoid({
		skin: [198, 142, 108],
		hair: [74, 51, 32],
		hairRows: 2,
		shirt: [0, 168, 168],
		sleeveRows: 4,
		pants: [58, 58, 154],
		shoes: [84, 62, 44],
		eyeWhite: '#f2f2f2',
		eyePupil: '#3a3a9a',
		mouth: '#8a4a3a',
		pantsRows: 9,
	}, 4242);
}

/**
 * ユーザーがダウンロードして描き換えるための 64x64 のひな型。
 * 部位ごとに色を変え、各面に 1px の濃い縁を付ける。有効なスキンとしてそのまま使える。
 */
export function buildSkinTemplate(): HTMLCanvasElement {
	const { canvas, ctx } = makeCanvas(64, 64);
	const tints: Record<HumanoidBox['name'], Rgb> = {
		head: [242, 201, 160],
		body: [127, 208, 232],
		rightArm: [240, 143, 143],
		leftArm: [143, 168, 240],
		rightLeg: [159, 224, 143],
		leftLeg: [232, 224, 143],
	};
	const shade: Record<keyof BoxUv, number> = { top: 1.1, bottom: 0.8, right: 0.92, front: 1.0, left: 0.92, back: 0.86 };
	for (const b of HUMANOID_BOXES) {
		for (const k of FACE_KEYS) {
			const rc = b.layout[k];
			const base = scale(tints[b.name], shade[k]);
			const edge = scale(tints[b.name], 0.55);
			fillRect(ctx, rc, (x, y) => (x === 0 || y === 0 || x === rc.w - 1 || y === rc.h - 1) ? css(edge) : css(base));
		}
	}
	// 正面が分かるように、頭と胴の正面に白い印を付ける
	dot(ctx, HUMANOID_BOXES[0].layout.front, 1, 1, '#ffffff', 2, 2);
	dot(ctx, HUMANOID_BOXES[1].layout.front, 1, 1, '#ffffff', 2, 2);
	return canvas;
}

export function buildZombieSkin(): HTMLCanvasElement {
	return paintHumanoid({
		skin: [79, 143, 63],
		hair: [52, 100, 44],
		hairRows: 1,
		shirt: [30, 74, 100],
		sleeveRows: 3,
		pants: [44, 44, 106],
		shoes: [50, 50, 54],
		eyeWhite: '#101010',
		eyePupil: '#101010',
		mouth: '#2f5a28',
		pantsRows: 10,
	}, 777);
}

// ----- 四足 (狼・熊) -----

type QuadPalette = {
	base: Rgb;
	back: Rgb;
	belly: Rgb;
	muzzle: Rgb;
	nose: string;
	eye: string;
	seed: number;
	eyeCols: [number, number];
	eyeRow: number;
};

function paintQuad(kind: 'wolf' | 'bear', p: QuadPalette): HTMLCanvasElement {
	const model = modelFor(kind);
	const { canvas, ctx } = makeCanvas(model.texW, model.texH);
	const r = rand(p.seed);
	for (const b of model.boxes) {
		const body = b.name === 'body';
		for (const k of FACE_KEYS) {
			const rc = b.uv[k];
			const c = k === 'top' && body ? p.back : k === 'bottom' && body ? p.belly : b.name === 'leg' ? scale(p.base, 0.85) : p.base;
			fillRect(ctx, rc, () => css(c, (r() - 0.5) * 18));
		}
		if (b.name === 'head') {
			const f = b.uv.front;
			// 鼻先を明るく
			const mw = Math.round(f.w * 0.5);
			fillRect(ctx, { x: f.x + Math.round((f.w - mw) / 2), y: f.y + Math.round(f.h * 0.55), w: mw, h: f.h - Math.round(f.h * 0.55) }, () => css(p.muzzle, (r() - 0.5) * 12));
			dot(ctx, f, p.eyeCols[0], p.eyeRow, p.eye);
			dot(ctx, f, p.eyeCols[1], p.eyeRow, p.eye);
			dot(ctx, f, Math.floor(f.w / 2) - 1, Math.round(f.h * 0.55), p.nose, 2, 1);
		}
	}
	return canvas;
}

export function buildWolfTexture(): HTMLCanvasElement {
	return paintQuad('wolf', {
		base: [186, 186, 190],
		back: [140, 140, 146],
		belly: [226, 226, 230],
		muzzle: [226, 220, 214],
		nose: '#1c1c1c',
		eye: '#2a1a10',
		seed: 91,
		eyeCols: [1, 6],
		eyeRow: 3,
	});
}

export function buildBearTexture(): HTMLCanvasElement {
	return paintQuad('bear', {
		base: [96, 64, 38],
		back: [78, 52, 30],
		belly: [112, 78, 48],
		muzzle: [176, 140, 98],
		nose: '#141414',
		eye: '#0c0c0c',
		seed: 313,
		eyeCols: [2, 7],
		eyeRow: 3,
	});
}

// ----- GPU テクスチャのキャッシュ -----

/**
 * 旧形式の 64x32 スキンを 64x64 に広げる。左脚・左腕の領域に右脚・右腕を左右反転して写す。
 */
function expandLegacySkin(img: CanvasImageSource): HTMLCanvasElement {
	const { canvas, ctx } = makeCanvas(64, 64);
	ctx.drawImage(img, 0, 0);
	// 右肢の展開図 (原点 sx, sy) → 左肢 (dx, dy)。面ごとに反転し、右面と左面は入れ替える
	const mirrorLimb = (sx: number, sy: number, dx: number, dy: number) => {
		const faces: [number, number, number, number, number, number][] = [
			// 元の x, y, w, h → 先の x, y
			[4, 0, 4, 4, 4, 0], // top
			[8, 0, 4, 4, 8, 0], // bottom
			[0, 4, 4, 12, 8, 4], // 右面 → 左面
			[4, 4, 4, 12, 4, 4], // front
			[8, 4, 4, 12, 0, 4], // 左面 → 右面
			[12, 4, 4, 12, 12, 4], // back
		];
		for (const [fx, fy, fw, fh, tx, ty] of faces) {
			ctx.save();
			ctx.translate(dx + tx + fw, dy + ty);
			ctx.scale(-1, 1);
			ctx.drawImage(canvas, sx + fx, sy + fy, fw, fh, 0, 0, fw, fh);
			ctx.restore();
		}
	};
	mirrorLimb(0, 16, 16, 48);
	mirrorLimb(40, 16, 32, 48);
	return canvas;
}

function uploadTexture(gl: WebGL2RenderingContext, source: TexImageSource): WebGLTexture {
	const tex = gl.createTexture()!;
	gl.activeTexture(gl.TEXTURE0);
	gl.bindTexture(gl.TEXTURE_2D, tex);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	return tex;
}

export class SkinCache {
	private defaultTex: WebGLTexture;
	private zombieTex: WebGLTexture;
	private wolfTex: WebGLTexture;
	private bearTex: WebGLTexture;
	private loaded = new Map<string, WebGLTexture>();
	/** 読み込み中または失敗済みの url (再試行しない) */
	private attempted = new Set<string>();
	private pending = new Set<HTMLImageElement>();
	private disposed = false;

	constructor(private gl: WebGL2RenderingContext) {
		this.defaultTex = uploadTexture(gl, buildDefaultSkin());
		this.zombieTex = uploadTexture(gl, buildZombieSkin());
		this.wolfTex = uploadTexture(gl, buildWolfTexture());
		this.bearTex = uploadTexture(gl, buildBearTexture());
	}

	/** 読み込み済みならそのスキン、そうでなければ標準スキンを返す。未読み込みの url は非同期で読み込む */
	public get(url: string | null): WebGLTexture {
		if (url == null || url === '') return this.defaultTex;
		const hit = this.loaded.get(url);
		if (hit) return hit;
		if (!this.attempted.has(url) && !this.disposed) {
			this.attempted.add(url);
			this.load(url);
		}
		return this.defaultTex;
	}

	public textureFor(kind: EntityKind, skinUrl?: string | null): WebGLTexture {
		switch (kind) {
			case 'player': return this.get(skinUrl ?? null);
			case 'zombie': return this.zombieTex;
			case 'wolf': return this.wolfTex;
			case 'bear': return this.bearTex;
		}
	}

	private load(url: string): void {
		const img = new window.Image();
		img.crossOrigin = 'anonymous';
		this.pending.add(img);
		img.onload = () => {
			this.pending.delete(img);
			if (this.disposed) return;
			const w = img.naturalWidth;
			const h = img.naturalHeight;
			if (w !== 64 || (h !== 64 && h !== 32)) return;
			try {
				const source = h === 32 ? expandLegacySkin(img) : (() => {
					const { canvas, ctx } = makeCanvas(64, 64);
					ctx.drawImage(img, 0, 0);
					return canvas;
				})();
				this.loaded.set(url, uploadTexture(this.gl, source));
			} catch {
				// 読み込めない画像は標準スキンのまま
			}
		};
		img.onerror = () => {
			this.pending.delete(img);
		};
		img.src = url;
	}

	public dispose(): void {
		this.disposed = true;
		for (const img of this.pending) {
			img.onload = null;
			img.onerror = null;
		}
		this.pending.clear();
		const gl = this.gl;
		for (const t of this.loaded.values()) gl.deleteTexture(t);
		this.loaded.clear();
		gl.deleteTexture(this.defaultTex);
		gl.deleteTexture(this.zombieTex);
		gl.deleteTexture(this.wolfTex);
		gl.deleteTexture(this.bearTex);
	}
}
