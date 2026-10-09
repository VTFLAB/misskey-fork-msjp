/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { ATLAS_TILE_COUNT, BLOCK, BLOCK_DEFS, WORLD, isBlockItem } from './constants.js';
import { getAtlasCanvas } from './atlas.js';
import { itemIconCanvas } from './icons.js';
import { buildChunkMesh, crackTile, VERTEX_FLOATS } from './mesher.js';
import { buildModelVertices, modelFor, modelVertexFloats } from './models.js';
import { MAX_PARTICLES, ParticleSystem } from './particles.js';
import { SkinCache } from './skins.js';
import { mat4Identity, mat4Multiply, mat4Perspective, mat4RotateX, mat4RotateY, mat4RotateZ, mat4Scale, mat4Translate, mat4TranslateScale, mat4View } from './math.js';
import type { EntityDraw, EntityKind, ModelAnim, ModelDef } from './models.js';
import type { Mat4 } from './math.js';
import type { CraftWorld } from './world.js';

type Rgb = [number, number, number];

const VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec3 a_pos;
layout(location = 1) in vec2 a_uv;
layout(location = 2) in float a_sky;
layout(location = 3) in float a_block;
layout(location = 4) in vec3 a_tint;
uniform mat4 u_viewProj;
uniform mat4 u_model;
uniform vec2 u_uvOffset;
out vec2 v_uv;
out float v_sky;
out float v_block;
out vec3 v_tint;
out float v_dist;
void main() {
	vec4 world = u_model * vec4(a_pos, 1.0);
	gl_Position = u_viewProj * world;
	v_uv = a_uv + u_uvOffset;
	v_sky = a_sky;
	v_block = a_block;
	v_tint = a_tint;
	v_dist = gl_Position.w;
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
in float v_sky;
in float v_block;
in vec3 v_tint;
in float v_dist;
uniform sampler2D u_atlas;
uniform vec3 u_fogColor;
uniform float u_fogNear;
uniform float u_fogFar;
uniform int u_mode; // 0: textured, 1: flat color (u_color), 2: vertex color
uniform vec4 u_color;
uniform float u_alphaCut;
uniform float u_daylight;
uniform vec3 u_tint;
uniform float u_entityLight;
uniform float u_alpha;
uniform float u_flash;
out vec4 outColor;
void main() {
	vec4 c;
	if (u_mode == 1) {
		c = u_color;
	} else {
		float dayCurve = mix(0.08, 1.0, u_daylight);
		// 松明などの明かりは少し暖色にする
		vec3 l = max(vec3(v_sky * dayCurve), v_block * vec3(1.0, 0.92, 0.78));
		l = max(l, vec3(0.03));
		if (u_mode == 2) {
			c = vec4(v_tint, 1.0);
		} else {
			c = texture(u_atlas, v_uv);
			if (c.a < u_alphaCut) discard;
			c.rgb *= v_tint;
		}
		c.rgb *= l * u_tint * u_entityLight;
		c.rgb = mix(c.rgb, vec3(1.0), u_flash);
		c.a *= u_alpha;
	}
	float fog = clamp((v_dist - u_fogNear) / (u_fogFar - u_fogNear), 0.0, 1.0);
	outColor = vec4(mix(c.rgb, u_fogColor, fog), c.a);
}`;

// 空の天体 (太陽・月の板、星の点) 用の単純なシェーダー
const SKY_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec3 a_pos;
uniform mat4 u_vp;
uniform mat4 u_model;
uniform vec3 u_center;
uniform vec3 u_right;
uniform vec3 u_up;
uniform int u_kind; // 0: 四角, 1: 中心から薄れる光, 2: 星の点
uniform float u_pointSize;
out vec2 v_p;
void main() {
	vec3 p;
	if (u_kind == 2) {
		p = (u_model * vec4(a_pos, 1.0)).xyz;
		gl_PointSize = u_pointSize;
		v_p = vec2(0.0);
	} else {
		p = u_center + a_pos.x * u_right + a_pos.y * u_up;
		v_p = a_pos.xy;
	}
	gl_Position = u_vp * vec4(p, 1.0);
}`;

const SKY_FRAG = `#version 300 es
precision highp float;
precision highp int;
in vec2 v_p;
uniform vec4 u_color;
uniform int u_kind;
out vec4 outColor;
void main() {
	float a = u_color.a;
	if (u_kind == 1) {
		float d = clamp(1.0 - length(v_p), 0.0, 1.0);
		a *= d * d;
	}
	outColor = vec4(u_color.rgb, a);
}`;

type ChunkGpu = {
	vaoOpaque: WebGLVertexArrayObject;
	bufOpaque: WebGLBuffer;
	countOpaque: number;
	vaoTrans: WebGLVertexArrayObject;
	bufTrans: WebGLBuffer;
	countTrans: number;
	cx: number;
	cz: number;
};

type EntityGpu = {
	model: ModelDef;
	vao: WebGLVertexArrayObject;
	buf: WebGLBuffer;
	scratch: Float32Array;
	count: number;
};

type Gpu = { vao: WebGLVertexArrayObject; buf: WebGLBuffer; count: number };

export type HandOpts = { itemId: number | null; swing: number; eating: number; bobX: number; bobY: number };

export type RenderOpts = {
	eyeX: number; eyeY: number; eyeZ: number; yaw: number; pitch: number;
	/** 視野角 (度)。省略時 70 */
	fovDeg?: number;
	/** 被ダメージで画面を傾ける角度 (ラジアン) */
	roll?: number;
	/** 視点のゆれ。ビュー空間での目の位置のずれ (ブロック) */
	bobX?: number; bobY?: number;
	target: { x: number; y: number; z: number } | null;
	breakProgress: number;
	/** 0.12 (真夜中) .. 1 (昼) */
	daylight: number;
	/** 0..1 の一日の時刻 (constants.ts の timeOfDay) */
	timeOfDay?: number;
	underwater: boolean;
	entities: EntityDraw[];
	hand?: HandOpts | null;
	/** 目の位置の明るさ 0..1 (手持ちの明るさ) */
	light?: number;
};

export const SKY_COLOR: Rgb = [0.55, 0.75, 0.95];
const NIGHT_COLOR: Rgb = [0.03, 0.04, 0.1];
const SUNSET_COLOR: Rgb = [0.98, 0.52, 0.28];
const WATER_COLOR: Rgb = [0.1, 0.26, 0.5];
const WATER_TINT: Rgb = [0.7, 0.88, 1.0];
const HURT_TINT: Rgb = [1.0, 0.35, 0.35];
const SKIN_COLOR: Rgb = [0.78, 0.56, 0.42];
const FOLIAGE_TINT: Rgb = [0.5, 0.78, 0.36];
const WHITE: Rgb = [1, 1, 1];

/** 1 フレームで chunk のメッシュ生成に使ってよい時間 (ms)。最初の 1 つは必ず作る */
const MESH_TIME_BUDGET_MS = 6;
const EVICT_INTERVAL_MS = 2000;
const STAR_COUNT = 300;
/** 空の傾き (太陽の軌道を真上から少しずらす) */
const SKY_TILT = 0.3;

// 立方体 (0..1) の面。順は +x, -x, +y, -y, +z, -z。tile は [top, side, bottom] の添字
const CUBE_FACES: { c: number[][]; shade: number; tile: 0 | 1 | 2 }[] = [
	{ c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], shade: 0.6, tile: 1 },
	{ c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], shade: 0.6, tile: 1 },
	{ c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], shade: 1.0, tile: 0 },
	{ c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], shade: 0.5, tile: 2 },
	{ c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], shade: 0.8, tile: 1 },
	{ c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], shade: 0.8, tile: 1 },
];
const CUBE_UV: [number, number][] = [[0, 1], [1, 1], [1, 0], [0, 0]];

/** 単位立方体 (0..1) の頂点。uv はアトラスのタイルに合わせる。faceTint が null を返す面は白 */
function cubeVerts(tiles: [number, number, number], faceTint: (face: number) => Rgb | null): Float32Array {
	const tileW = 1 / ATLAS_TILE_COUNT;
	const out = new Float32Array(36 * VERTEX_FLOATS);
	let n = 0;
	CUBE_FACES.forEach((f, fi) => {
		const u0 = tiles[f.tile] * tileW;
		const t = faceTint(fi) ?? WHITE;
		for (const i of [0, 1, 2, 0, 2, 3]) {
			const p = f.c[i];
			const [u, v] = CUBE_UV[i];
			out[n++] = p[0]; out[n++] = p[1]; out[n++] = p[2];
			out[n++] = u0 + u * tileW; out[n++] = v;
			out[n++] = f.shade; out[n++] = 0;
			out[n++] = t[0]; out[n++] = t[1]; out[n++] = t[2];
		}
	});
	return out;
}

export class CraftRenderer {
	private gl: WebGL2RenderingContext;
	private program: WebGLProgram;
	private uViewProj: WebGLUniformLocation;
	private uModel: WebGLUniformLocation;
	private uMode: WebGLUniformLocation;
	private uColor: WebGLUniformLocation;
	private uAlphaCut: WebGLUniformLocation;
	private uFogNear: WebGLUniformLocation;
	private uFogFar: WebGLUniformLocation;
	private uFogColor: WebGLUniformLocation;
	private uDaylight: WebGLUniformLocation;
	private uTint: WebGLUniformLocation;
	private uEntityLight: WebGLUniformLocation;
	private uAlpha: WebGLUniformLocation;
	private uFlash: WebGLUniformLocation;
	private uUvOffset: WebGLUniformLocation;
	private skyProgram: WebGLProgram;
	private sky: {
		vp: WebGLUniformLocation; model: WebGLUniformLocation; center: WebGLUniformLocation; right: WebGLUniformLocation;
		up: WebGLUniformLocation; kind: WebGLUniformLocation; pointSize: WebGLUniformLocation; color: WebGLUniformLocation;
	};
	private skyQuad: Gpu;
	private starGpu: Gpu;
	private chunks = new Map<string, ChunkGpu>();
	private atlasTex: WebGLTexture;
	private skins: SkinCache;
	private entityGpu = new Map<EntityKind, EntityGpu>();
	private anim: ModelAnim = { walkPhase: 0 };
	private cube: Gpu;
	private outline: Gpu;
	private particleGpu: Gpu;
	private particleScratch = new Float32Array(MAX_PARTICLES * 6 * VERTEX_FLOATS);
	private hand: Gpu;
	private handKey = -2;
	private handMode: 'cube' | 'quad' | 'arm' = 'arm';
	private handTex = new Map<number, WebGLTexture>();
	private armGpu: Gpu;
	private lastEvict = 0;
	private planes = new Float32Array(24);
	public viewProj: Mat4 = mat4Identity();
	public renderDistance: number = WORLD.renderDistance; // chunks
	public particles: ParticleSystem;

	constructor(private canvas: HTMLCanvasElement, private world: CraftWorld) {
		const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
		if (gl == null) throw new Error('WebGL2 is not available');
		this.gl = gl;
		this.program = this.createProgram(VERT, FRAG);
		gl.useProgram(this.program);
		const loc = (name: string) => gl.getUniformLocation(this.program, name)!;
		this.uViewProj = loc('u_viewProj');
		this.uModel = loc('u_model');
		this.uMode = loc('u_mode');
		this.uColor = loc('u_color');
		this.uAlphaCut = loc('u_alphaCut');
		this.uFogNear = loc('u_fogNear');
		this.uFogFar = loc('u_fogFar');
		this.uFogColor = loc('u_fogColor');
		this.uDaylight = loc('u_daylight');
		this.uTint = loc('u_tint');
		this.uEntityLight = loc('u_entityLight');
		this.uAlpha = loc('u_alpha');
		this.uFlash = loc('u_flash');
		this.uUvOffset = loc('u_uvOffset');
		gl.uniform1i(loc('u_atlas'), 0);

		this.skyProgram = this.createProgram(SKY_VERT, SKY_FRAG);
		const sloc = (name: string) => gl.getUniformLocation(this.skyProgram, name)!;
		this.sky = {
			vp: sloc('u_vp'), model: sloc('u_model'), center: sloc('u_center'), right: sloc('u_right'),
			up: sloc('u_up'), kind: sloc('u_kind'), pointSize: sloc('u_pointSize'), color: sloc('u_color'),
		};

		const atlas = getAtlasCanvas();
		const tex = gl.createTexture()!;
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, tex);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		this.atlasTex = tex;

		this.skins = new SkinCache(gl);
		this.particles = new ParticleSystem(world);

		gl.enable(gl.DEPTH_TEST);
		gl.enable(gl.CULL_FACE);
		gl.cullFace(gl.BACK);

		this.cube = this.wrapGpu(cubeVerts([0, 0, 0], () => null));
		this.outline = this.makeOutline();
		this.armGpu = this.wrapGpu(cubeVerts([0, 0, 0], () => SKIN_COLOR));
		this.hand = this.wrapGpu(cubeVerts([0, 0, 0], () => null), gl.DYNAMIC_DRAW);
		this.particleGpu = this.wrapGpu(this.particleScratch, gl.DYNAMIC_DRAW, 0);
		this.skyQuad = this.makeSkyBuffer(new Float32Array([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0]), 4);
		this.starGpu = this.makeSkyBuffer(this.makeStars(), STAR_COUNT);
	}

	private createProgram(vs: string, fs: string): WebGLProgram {
		const gl = this.gl;
		const compile = (type: number, src: string) => {
			const sh = gl.createShader(type)!;
			gl.shaderSource(sh, src);
			gl.compileShader(sh);
			if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
				throw new Error(gl.getShaderInfoLog(sh) ?? 'shader compile error');
			}
			return sh;
		};
		const program = gl.createProgram()!;
		gl.attachShader(program, compile(gl.VERTEX_SHADER, vs));
		gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fs));
		gl.linkProgram(program);
		if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
			throw new Error(gl.getProgramInfoLog(program) ?? 'program link error');
		}
		return program;
	}

	private makeVao(data: Float32Array, usage: number = this.gl.STATIC_DRAW): { vao: WebGLVertexArrayObject; buf: WebGLBuffer } {
		const gl = this.gl;
		const vao = gl.createVertexArray()!;
		const buf = gl.createBuffer()!;
		gl.bindVertexArray(vao);
		gl.bindBuffer(gl.ARRAY_BUFFER, buf);
		gl.bufferData(gl.ARRAY_BUFFER, data, usage);
		const stride = VERTEX_FLOATS * 4;
		gl.enableVertexAttribArray(0);
		gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
		gl.enableVertexAttribArray(1);
		gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 12);
		gl.enableVertexAttribArray(2);
		gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 20);
		gl.enableVertexAttribArray(3);
		gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 24);
		gl.enableVertexAttribArray(4);
		gl.vertexAttribPointer(4, 3, gl.FLOAT, false, stride, 28);
		gl.bindVertexArray(null);
		return { vao, buf };
	}

	private wrapGpu(data: Float32Array, usage?: number, count?: number): Gpu {
		const { vao, buf } = this.makeVao(data, usage);
		return { vao, buf, count: count ?? data.length / VERTEX_FLOATS };
	}

	private makeOutline(): Gpu {
		const eps = 0.003;
		const a = -eps, b = 1 + eps;
		const p = [[a, a, a], [b, a, a], [b, a, b], [a, a, b], [a, b, a], [b, b, a], [b, b, b], [a, b, b]];
		const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
		const out: number[] = [];
		for (const [s, t] of edges) {
			out.push(...p[s], 0, 0, 1, 0, 1, 1, 1, ...p[t], 0, 0, 1, 0, 1, 1, 1);
		}
		return this.wrapGpu(new Float32Array(out));
	}

	private makeSkyBuffer(data: Float32Array, count: number): Gpu {
		const gl = this.gl;
		const vao = gl.createVertexArray()!;
		const buf = gl.createBuffer()!;
		gl.bindVertexArray(vao);
		gl.bindBuffer(gl.ARRAY_BUFFER, buf);
		gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
		gl.enableVertexAttribArray(0);
		gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
		gl.bindVertexArray(null);
		return { vao, buf, count };
	}

	/** 球面上に一様に散らした星の方向 (単位ベクトル)。毎回同じ配置になるよう固定シードで作る */
	private makeStars(): Float32Array {
		const out = new Float32Array(STAR_COUNT * 3);
		let s = 20261009;
		const r = () => {
			s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
			return s / 4294967296;
		};
		for (let i = 0; i < STAR_COUNT; i++) {
			const y = r() * 2 - 1;
			const a = r() * Math.PI * 2;
			const q = Math.sqrt(1 - y * y);
			out[i * 3] = Math.cos(a) * q;
			out[i * 3 + 1] = y;
			out[i * 3 + 2] = Math.sin(a) * q;
		}
		return out;
	}

	public resize(): boolean {
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		const w = Math.floor(this.canvas.clientWidth * dpr);
		const h = Math.floor(this.canvas.clientHeight * dpr);
		if (w === 0 || h === 0) return false;
		if (this.canvas.width !== w || this.canvas.height !== h) {
			this.canvas.width = w;
			this.canvas.height = h;
		}
		return true;
	}

	private uploadChunk(cx: number, cz: number): void {
		const key = `${cx},${cz}`;
		const mesh = buildChunkMesh(this.world, cx, cz);
		if (mesh == null) return;
		const gl = this.gl;
		const existing = this.chunks.get(key);
		if (existing) {
			gl.bindBuffer(gl.ARRAY_BUFFER, existing.bufOpaque);
			gl.bufferData(gl.ARRAY_BUFFER, mesh.opaque, gl.STATIC_DRAW);
			gl.bindBuffer(gl.ARRAY_BUFFER, existing.bufTrans);
			gl.bufferData(gl.ARRAY_BUFFER, mesh.translucent, gl.STATIC_DRAW);
			existing.countOpaque = mesh.opaque.length / VERTEX_FLOATS;
			existing.countTrans = mesh.translucent.length / VERTEX_FLOATS;
			return;
		}
		const o = this.makeVao(mesh.opaque);
		const t = this.makeVao(mesh.translucent);
		this.chunks.set(key, {
			vaoOpaque: o.vao, bufOpaque: o.buf, countOpaque: mesh.opaque.length / VERTEX_FLOATS,
			vaoTrans: t.vao, bufTrans: t.buf, countTrans: mesh.translucent.length / VERTEX_FLOATS,
			cx, cz,
		});
	}

	private freeChunk(key: string): void {
		const chunk = this.chunks.get(key);
		if (chunk == null) return;
		const gl = this.gl;
		gl.deleteBuffer(chunk.bufOpaque);
		gl.deleteBuffer(chunk.bufTrans);
		gl.deleteVertexArray(chunk.vaoOpaque);
		gl.deleteVertexArray(chunk.vaoTrans);
		this.chunks.delete(key);
	}

	/**
	 * プレイヤー周辺の chunk を用意し、dirty な chunk を作り直し、遠い chunk を捨てる。
	 * 1 フレームあたりの新規メッシュ数と時間を抑えて、初回ロードで固まらないようにする。
	 */
	public updateChunks(px: number, pz: number, budget = 4, rebuildBudget = 8): void {
		const t0 = performance.now();
		const pcx = Math.floor(px / WORLD.chunkSize);
		const pcz = Math.floor(pz / WORLD.chunkSize);

		// 遠い GPU メッシュを捨てる
		const limit = this.renderDistance + 2;
		for (const [key, chunk] of this.chunks) {
			if (Math.abs(chunk.cx - pcx) > limit || Math.abs(chunk.cz - pcz) > limit) this.freeChunk(key);
		}
		// 一定間隔でワールド側のブロックデータも捨てる
		if (t0 - this.lastEvict > EVICT_INTERVAL_MS) {
			this.lastEvict = t0;
			for (const key of this.world.evictFar(pcx, pcz)) this.freeChunk(key);
		}

		let rebuilt = 0;
		for (const key of this.world.dirty) {
			if (!this.chunks.has(key)) {
				// GPU 上に無い chunk は、近づいた時に下の近い順ループが最新の内容で作る
				this.world.dirty.delete(key);
				continue;
			}
			if (rebuilt >= rebuildBudget) break;
			if (rebuilt > 0 && performance.now() - t0 > MESH_TIME_BUDGET_MS) break;
			const [cx, cz] = key.split(',').map(Number);
			this.world.dirty.delete(key);
			this.uploadChunk(cx, cz);
			rebuilt++;
		}

		// 近い順に未生成 chunk を作る
		let built = 0;
		const maxC = Math.floor(WORLD.maxCoord / WORLD.chunkSize);
		for (let r = 0; r <= this.renderDistance && built < budget; r++) {
			for (let dz = -r; dz <= r && built < budget; dz++) {
				for (let dx = -r; dx <= r && built < budget; dx++) {
					if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
					const cx = pcx + dx;
					const cz = pcz + dz;
					if (Math.abs(cx) > maxC || Math.abs(cz) > maxC) continue;
					if (this.chunks.has(`${cx},${cz}`)) continue;
					if (built > 0 && performance.now() - t0 > MESH_TIME_BUDGET_MS) return;
					this.uploadChunk(cx, cz);
					built++;
				}
			}
		}
	}

	public get pendingChunks(): boolean {
		return this.world.dirty.size > 0;
	}

	public preloadSkin(url: string | null): void {
		this.skins.get(url);
	}

	/** viewProj の 6 平面を取り出す (正規化済み、内側が正) */
	private extractPlanes(m: Mat4): void {
		const pl = this.planes;
		const set = (i: number, a: number, b: number, c: number, d: number) => {
			const len = Math.hypot(a, b, c) || 1;
			pl[i * 4] = a / len; pl[i * 4 + 1] = b / len; pl[i * 4 + 2] = c / len; pl[i * 4 + 3] = d / len;
		};
		// 行 r の成分は m[r], m[4 + r], m[8 + r], m[12 + r]
		set(0, m[3] + m[0], m[7] + m[4], m[11] + m[8], m[15] + m[12]);
		set(1, m[3] - m[0], m[7] - m[4], m[11] - m[8], m[15] - m[12]);
		set(2, m[3] + m[1], m[7] + m[5], m[11] + m[9], m[15] + m[13]);
		set(3, m[3] - m[1], m[7] - m[5], m[11] - m[9], m[15] - m[13]);
		set(4, m[3] + m[2], m[7] + m[6], m[11] + m[10], m[15] + m[14]);
		set(5, m[3] - m[2], m[7] - m[6], m[11] - m[10], m[15] - m[14]);
	}

	private chunkInFrustum(chunk: ChunkGpu): boolean {
		const half = WORLD.chunkSize / 2;
		const cx = chunk.cx * WORLD.chunkSize + half;
		const cy = WORLD.sizeY / 2;
		const cz = chunk.cz * WORLD.chunkSize + half;
		const radius = Math.hypot(half, WORLD.sizeY / 2, half);
		const pl = this.planes;
		for (let i = 0; i < 6; i++) {
			if (pl[i * 4] * cx + pl[i * 4 + 1] * cy + pl[i * 4 + 2] * cz + pl[i * 4 + 3] < -radius) return false;
		}
		return true;
	}

	private getEntityGpu(kind: EntityKind): EntityGpu {
		let g = this.entityGpu.get(kind);
		if (g == null) {
			const gl = this.gl;
			const model = modelFor(kind);
			const scratch = new Float32Array(modelVertexFloats(model));
			const { vao, buf } = this.makeVao(scratch, gl.DYNAMIC_DRAW);
			g = { model, vao, buf, scratch, count: scratch.length / VERTEX_FLOATS };
			this.entityGpu.set(kind, g);
		}
		return g;
	}

	private drawEntities(entities: EntityDraw[], daylight: number, tint: Rgb, now: number): void {
		if (entities.length === 0) return;
		const gl = this.gl;
		gl.uniform1i(this.uMode, 0);
		gl.uniform1f(this.uAlphaCut, 0.5);
		// 夜でも姿が分かるように、エンティティは昼夜の暗さを弱める
		gl.uniform1f(this.uDaylight, Math.max(daylight, 0.4));
		const anim = this.anim;
		for (const ent of entities) {
			const g = this.getEntityGpu(ent.kind);
			const isArrow = ent.kind === 'arrow';
			anim.walkPhase = ent.walkPhase ?? 0;
			anim.headPitch = isArrow ? 0 : (ent.pitch ?? 0);
			anim.headYaw = ent.headYaw ?? 0;
			anim.deathT = ent.deathT ?? 0;
			anim.swell = ent.swell ?? 0;
			buildModelVertices(g.model, anim, g.scratch);
			gl.bindVertexArray(g.vao);
			gl.bindBuffer(gl.ARRAY_BUFFER, g.buf);
			gl.bufferSubData(gl.ARRAY_BUFFER, 0, g.scratch);
			gl.bindTexture(gl.TEXTURE_2D, this.skins.textureFor(ent.kind, ent.skinUrl ?? null));
			const t = ent.hurt ? HURT_TINT : tint;
			gl.uniform3f(this.uTint, t[0], t[1], t[2]);
			gl.uniform1f(this.uEntityLight, Math.max(0.05, Math.min(1, ent.light ?? 1)));
			const flash = (ent.swell ?? 0) > 0 && Math.sin(now * 30) > 0 ? 0.6 : 0;
			gl.uniform1f(this.uFlash, flash);
			const dying = (ent.deathT ?? 0) > 0;
			if (dying) {
				gl.enable(gl.BLEND);
				gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
				gl.uniform1f(this.uAlpha, Math.max(0, 1 - ent.deathT! * 0.9));
			} else {
				gl.disable(gl.BLEND);
				gl.uniform1f(this.uAlpha, 1);
			}
			let m = mat4Multiply(mat4Translate(ent.x, ent.y, ent.z), mat4RotateY(ent.yaw));
			if (isArrow && ent.pitch) m = mat4Multiply(m, mat4RotateX(ent.pitch));
			if (ent.scale != null && ent.scale !== 1) m = mat4Multiply(m, mat4Scale(ent.scale, ent.scale, ent.scale));
			gl.uniformMatrix4fv(this.uModel, false, m);
			gl.drawArrays(gl.TRIANGLES, 0, g.count);
		}
		gl.disable(gl.BLEND);
		gl.uniform1f(this.uAlpha, 1);
		gl.uniform1f(this.uFlash, 0);
		gl.uniform1f(this.uEntityLight, 1);
		gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
		gl.uniformMatrix4fv(this.uModel, false, mat4Identity());
	}

	/** 太陽・月・星。カメラ位置を原点にして、深度を使わずに最初に描く */
	private drawSky(proj: Mat4, view0: Mat4, roll: number, daylight: number, tod: number): void {
		const gl = this.gl;
		const vp = mat4Multiply(proj, mat4Multiply(mat4RotateZ(roll), view0));
		const D = Math.max(60, Math.min(this.renderDistance * WORLD.chunkSize * 0.8, 300));
		const angle = (tod - 0.25) * Math.PI * 2;
		const rot = mat4Multiply(mat4RotateZ(SKY_TILT), mat4RotateX(angle));
		const sun: Rgb = [rot[4], rot[5], rot[6]];
		const s = this.sky;
		gl.useProgram(this.skyProgram);
		gl.uniformMatrix4fv(s.vp, false, vp);
		gl.disable(gl.DEPTH_TEST);
		gl.disable(gl.CULL_FACE);
		gl.depthMask(false);
		gl.enable(gl.BLEND);

		// 星: 昼が薄れるにつれて現れる
		const starA = Math.max(0, Math.min(1, (0.6 - daylight) / 0.4));
		if (starA > 0.01) {
			gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
			gl.uniform1i(s.kind, 2);
			gl.uniformMatrix4fv(s.model, false, mat4Multiply(rot, mat4Scale(D, D, D)));
			gl.uniform1f(s.pointSize, Math.max(1.5, 2 * Math.min(window.devicePixelRatio || 1, 2)));
			gl.uniform4f(s.color, 0.95, 0.95, 1, starA * 0.9);
			gl.bindVertexArray(this.starGpu.vao);
			gl.drawArrays(gl.POINTS, 0, this.starGpu.count);
		}

		gl.bindVertexArray(this.skyQuad.vao);
		const body = (dir: Rgb, size: number, core: Rgb, glow: Rgb, glowA: number) => {
			// 地平線の下では消す
			const fade = Math.max(0, Math.min(1, (dir[1] + 0.12) / 0.2));
			if (fade <= 0) return;
			const ref: Rgb = Math.abs(dir[1]) < 0.99 ? [0, 1, 0] : [1, 0, 0];
			let rx = ref[1] * dir[2] - ref[2] * dir[1];
			let ry = ref[2] * dir[0] - ref[0] * dir[2];
			let rz = ref[0] * dir[1] - ref[1] * dir[0];
			const rl = Math.hypot(rx, ry, rz) || 1;
			rx /= rl; ry /= rl; rz /= rl;
			const ux = dir[1] * rz - dir[2] * ry;
			const uy = dir[2] * rx - dir[0] * rz;
			const uz = dir[0] * ry - dir[1] * rx;
			gl.uniform3f(s.center, dir[0] * D, dir[1] * D, dir[2] * D);
			// 光の暈
			gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
			gl.uniform1i(s.kind, 1);
			const gs = size * 3.2;
			gl.uniform3f(s.right, rx * gs, ry * gs, rz * gs);
			gl.uniform3f(s.up, ux * gs, uy * gs, uz * gs);
			gl.uniform4f(s.color, glow[0], glow[1], glow[2], glowA * fade);
			gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
			// 本体の四角
			gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
			gl.uniform1i(s.kind, 0);
			gl.uniform3f(s.right, rx * size, ry * size, rz * size);
			gl.uniform3f(s.up, ux * size, uy * size, uz * size);
			gl.uniform4f(s.color, core[0], core[1], core[2], fade);
			gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
		};
		body(sun, D * 0.075, [1, 0.93, 0.62], [1, 0.75, 0.35], 0.55);
		body([-sun[0], -sun[1], -sun[2]], D * 0.055, [0.88, 0.9, 0.95], [0.55, 0.65, 1], 0.28);

		gl.bindVertexArray(null);
		gl.depthMask(true);
		gl.disable(gl.BLEND);
		gl.enable(gl.DEPTH_TEST);
		gl.enable(gl.CULL_FACE);
		gl.useProgram(this.program);
	}

	/** 空の色 (霧の色)。昼の空色と夜の濃紺を混ぜ、昼と夜の境で夕焼けの橙を重ねる */
	private skyColor(daylight: number): Rgb {
		const t = Math.max(0, Math.min(1, (daylight - 0.12) / 0.88));
		const base: Rgb = [
			NIGHT_COLOR[0] + (SKY_COLOR[0] - NIGHT_COLOR[0]) * t,
			NIGHT_COLOR[1] + (SKY_COLOR[1] - NIGHT_COLOR[1]) * t,
			NIGHT_COLOR[2] + (SKY_COLOR[2] - NIGHT_COLOR[2]) * t,
		];
		const w = daylight > 0.3 && daylight < 0.9 ? Math.max(0, 1 - Math.abs(daylight - 0.6) / 0.3) * 0.6 : 0;
		return [
			base[0] + (SUNSET_COLOR[0] - base[0]) * w,
			base[1] + (SUNSET_COLOR[1] - base[1]) * w,
			base[2] + (SUNSET_COLOR[2] - base[2]) * w,
		];
	}

	/** 破壊の進み具合のひび割れ: 注視ブロックを少し膨らませた立方体にひびのタイルを貼る */
	private drawCrack(target: { x: number; y: number; z: number }, progress: number): void {
		const gl = this.gl;
		const tile = crackTile(progress);
		gl.uniform1i(this.uMode, 0);
		gl.uniform1f(this.uAlphaCut, 0.02);
		gl.uniform1f(this.uDaylight, 1);
		gl.uniform2f(this.uUvOffset, tile / ATLAS_TILE_COUNT, 0);
		gl.enable(gl.BLEND);
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
		gl.depthMask(false);
		gl.uniformMatrix4fv(this.uModel, false, mat4TranslateScale(target.x - 0.002, target.y - 0.002, target.z - 0.002, 1.004, 1.004, 1.004));
		gl.bindVertexArray(this.cube.vao);
		gl.drawArrays(gl.TRIANGLES, 0, this.cube.count);
		gl.uniform2f(this.uUvOffset, 0, 0);
		gl.uniformMatrix4fv(this.uModel, false, mat4Identity());
		gl.depthMask(true);
		gl.disable(gl.BLEND);
	}

	/** パーティクル: ビュー行列の right / up を使うカメラ向きの四角 */
	private drawParticles(view: Mat4, daylight: number): void {
		const list = this.particles.list;
		const count = Math.min(list.length, MAX_PARTICLES);
		if (count === 0) return;
		const gl = this.gl;
		const rx = view[0], ry = view[4], rz = view[8];
		const ux = view[1], uy = view[5], uz = view[9];
		const d = this.particleScratch;
		let n = 0;
		for (let i = 0; i < count; i++) {
			const p = list[i];
			// 寿命の終わりに向けて縮む
			const h = p.size * 0.5 * Math.min(1, 0.3 + (p.life / p.maxLife) * 1.4);
			const ax = (-rx - ux) * h, ay = (-ry - uy) * h, az = (-rz - uz) * h;
			const bx = (rx - ux) * h, by = (ry - uy) * h, bz = (rz - uz) * h;
			const cx = (rx + ux) * h, cy = (ry + uy) * h, cz = (rz + uz) * h;
			const dx = (-rx + ux) * h, dy = (-ry + uy) * h, dz = (-rz + uz) * h;
			const corners = [ax, ay, az, bx, by, bz, cx, cy, cz, ax, ay, az, cx, cy, cz, dx, dy, dz];
			for (let k = 0; k < 18; k += 3) {
				d[n++] = p.x + corners[k]; d[n++] = p.y + corners[k + 1]; d[n++] = p.z + corners[k + 2];
				d[n++] = 0; d[n++] = 0;
				d[n++] = p.sky; d[n++] = p.block;
				d[n++] = p.r; d[n++] = p.g; d[n++] = p.b;
			}
		}
		gl.uniform1i(this.uMode, 2);
		gl.uniform1f(this.uDaylight, daylight);
		gl.disable(gl.CULL_FACE);
		gl.bindVertexArray(this.particleGpu.vao);
		gl.bindBuffer(gl.ARRAY_BUFFER, this.particleGpu.buf);
		gl.bufferSubData(gl.ARRAY_BUFFER, 0, d, 0, n);
		gl.drawArrays(gl.TRIANGLES, 0, count * 6);
		gl.enable(gl.CULL_FACE);
	}

	private handTexture(id: number): WebGLTexture {
		let tex = this.handTex.get(id);
		if (tex == null) {
			const gl = this.gl;
			tex = gl.createTexture()!;
			gl.bindTexture(gl.TEXTURE_2D, tex);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, itemIconCanvas(id));
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
			this.handTex.set(id, tex);
		}
		return tex;
	}

	/** 手に持つ物の頂点を、持ち物が変わったときだけ作り直す */
	private prepareHand(itemId: number | null): void {
		const key = itemId ?? -1;
		if (key === this.handKey) return;
		this.handKey = key;
		const gl = this.gl;
		if (itemId == null) {
			this.handMode = 'arm';
			return;
		}
		const def = BLOCK_DEFS[itemId];
		if (isBlockItem(itemId) && def != null && def.shape === 'cube') {
			this.handMode = 'cube';
			const foliage = itemId === BLOCK.leaves;
			const grass = itemId === BLOCK.grass;
			const data = cubeVerts(def.tiles, face => foliage || (grass && face === 2) ? FOLIAGE_TINT : null);
			gl.bindBuffer(gl.ARRAY_BUFFER, this.hand.buf);
			gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
			this.hand.count = 36;
		} else {
			this.handMode = 'quad';
			// 板 (-0.5..0.5)。texture は 0..1 をそのまま使うので u_uvOffset は 0
			const q: number[] = [];
			const c = [[-0.5, -0.5, 0, 0, 1], [0.5, -0.5, 0, 1, 1], [0.5, 0.5, 0, 1, 0], [-0.5, 0.5, 0, 0, 0]];
			for (const i of [0, 1, 2, 0, 2, 3]) q.push(c[i][0], c[i][1], c[i][2], c[i][3], c[i][4], 1, 0, 1, 1, 1);
			gl.bindBuffer(gl.ARRAY_BUFFER, this.hand.buf);
			gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(q), gl.DYNAMIC_DRAW);
			this.hand.count = 6;
		}
	}

	/** 画面右下の手と持ち物。深度を消して専用の投影で描く */
	private drawHand(hand: HandOpts, aspect: number, light: number, tint: Rgb, now: number): void {
		const gl = this.gl;
		this.prepareHand(hand.itemId);
		gl.clear(gl.DEPTH_BUFFER_BIT);
		gl.uniformMatrix4fv(this.uViewProj, false, mat4Perspective(70 * Math.PI / 180, aspect, 0.05, 10));
		gl.uniform1f(this.uFogNear, 1e6);
		gl.uniform1f(this.uFogFar, 1e6 + 1);
		gl.uniform3f(this.uTint, tint[0], tint[1], tint[2]);
		gl.uniform1f(this.uDaylight, 1);
		gl.uniform1f(this.uEntityLight, Math.max(0.15, Math.min(1, light)));
		gl.uniform1f(this.uAlphaCut, 0.5);
		gl.disable(gl.BLEND);

		const sw = Math.max(0, Math.min(1, hand.swing));
		const sq = Math.sqrt(sw);
		const eat = Math.max(0, Math.min(1, hand.eating));
		const eatK = Math.min(1, eat * 4);
		const sPi = Math.sin(sq * Math.PI);
		const tx = 0.6 + hand.bobX - 0.4 * sPi - 0.3 * eatK;
		let ty = -0.58 + hand.bobY + 0.2 * Math.sin(sq * Math.PI * 2) + 0.2 * eatK;
		const tz = -0.95 - 0.2 * Math.sin(sw * Math.PI) + 0.1 * eatK;
		if (eat > 0) ty += Math.abs(Math.sin(now * 14)) * 0.035;
		let r = mat4Multiply(mat4RotateY(0.75 - Math.sin(sw * sw * Math.PI) * 0.35), mat4Multiply(mat4RotateZ(-sPi * 0.35), mat4RotateX(-sPi * 1.2 + (eat > 0 ? -0.5 * eatK : 0))));
		let m: Mat4;
		if (this.handMode === 'cube') {
			m = mat4Multiply(mat4Translate(tx, ty, tz), mat4Multiply(r, mat4Multiply(mat4Scale(0.4, 0.4, 0.4), mat4Translate(-0.5, -0.5, -0.5))));
			gl.uniform1i(this.uMode, 0);
			gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
			gl.uniform2f(this.uUvOffset, 0, 0);
			gl.uniformMatrix4fv(this.uModel, false, m);
			gl.bindVertexArray(this.hand.vao);
			gl.drawArrays(gl.TRIANGLES, 0, this.hand.count);
		} else if (this.handMode === 'quad') {
			r = mat4Multiply(r, mat4Multiply(mat4RotateY(-0.5), mat4RotateZ(0.35)));
			m = mat4Multiply(mat4Translate(tx - 0.05, ty + 0.1, tz), mat4Multiply(r, mat4Scale(0.75, 0.75, 0.75)));
			gl.uniform1i(this.uMode, 0);
			gl.bindTexture(gl.TEXTURE_2D, this.handTexture(hand.itemId!));
			gl.uniform2f(this.uUvOffset, 0, 0);
			gl.uniformMatrix4fv(this.uModel, false, m);
			gl.disable(gl.CULL_FACE);
			gl.enable(gl.BLEND);
			gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
			gl.bindVertexArray(this.hand.vao);
			gl.drawArrays(gl.TRIANGLES, 0, this.hand.count);
			gl.disable(gl.BLEND);
			gl.enable(gl.CULL_FACE);
			gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
		} else {
			// 素手: 肌色の腕
			r = mat4Multiply(mat4RotateY(0.2), mat4Multiply(mat4RotateZ(-sPi * 0.3), mat4RotateX(-0.5 - sPi * 1.0)));
			m = mat4Multiply(mat4Translate(tx + 0.1, ty - 0.1, tz), mat4Multiply(r, mat4Multiply(mat4Scale(0.22, 0.22, 0.85), mat4Translate(-0.5, -0.5, -1))));
			gl.uniform1i(this.uMode, 2);
			gl.uniformMatrix4fv(this.uModel, false, m);
			gl.bindVertexArray(this.armGpu.vao);
			gl.drawArrays(gl.TRIANGLES, 0, this.armGpu.count);
		}
		gl.uniformMatrix4fv(this.uModel, false, mat4Identity());
		gl.uniform1f(this.uEntityLight, 1);
	}

	public render(opts: RenderOpts): void {
		const gl = this.gl;
		if (!this.resize()) return;
		gl.viewport(0, 0, this.canvas.width, this.canvas.height);
		const now = performance.now() / 1000;
		const tod = opts.timeOfDay ?? 0.25;

		// 空・霧の色。水中は青
		const t = Math.max(0, Math.min(1, (opts.daylight - 0.12) / 0.88));
		const fogColor: Rgb = opts.underwater
			? [WATER_COLOR[0] * (0.25 + 0.75 * t), WATER_COLOR[1] * (0.25 + 0.75 * t), WATER_COLOR[2] * (0.35 + 0.65 * t)]
			: this.skyColor(opts.daylight);
		gl.clearColor(fogColor[0], fogColor[1], fogColor[2], 1);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

		const aspect = this.canvas.width / this.canvas.height;
		const proj = mat4Perspective((opts.fovDeg ?? 70) * Math.PI / 180, aspect, 0.1, 400);
		const roll = opts.roll ?? 0;
		const view0 = mat4View(opts.eyeX, opts.eyeY, opts.eyeZ, opts.yaw, opts.pitch);
		// 揺れは目の位置のずれ (ビュー空間) なので、ワールドを逆向きにずらす。傾きは視線まわり
		const adjust = mat4Multiply(mat4Translate(-(opts.bobX ?? 0), -(opts.bobY ?? 0), 0), mat4RotateZ(roll));
		const view = mat4Multiply(adjust, view0);
		this.viewProj = mat4Multiply(proj, view);
		this.extractPlanes(this.viewProj);

		if (!opts.underwater) {
			this.drawSky(proj, mat4View(0, 0, 0, opts.yaw, opts.pitch), roll, opts.daylight, tod);
		}

		gl.useProgram(this.program);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
		gl.uniformMatrix4fv(this.uViewProj, false, this.viewProj);
		gl.uniformMatrix4fv(this.uModel, false, mat4Identity());
		gl.uniform2f(this.uUvOffset, 0, 0);
		gl.uniform1f(this.uEntityLight, 1);
		gl.uniform1f(this.uAlpha, 1);
		gl.uniform1f(this.uFlash, 0);
		gl.uniform3f(this.uFogColor, fogColor[0], fogColor[1], fogColor[2]);
		const farDist = this.renderDistance * WORLD.chunkSize;
		if (opts.underwater) {
			gl.uniform1f(this.uFogNear, 1);
			gl.uniform1f(this.uFogFar, 22);
		} else {
			gl.uniform1f(this.uFogNear, farDist * 0.6);
			gl.uniform1f(this.uFogFar, farDist * 0.95);
		}
		const tint: Rgb = opts.underwater ? WATER_TINT : WHITE;
		gl.uniform3f(this.uTint, tint[0], tint[1], tint[2]);
		gl.uniform1f(this.uDaylight, opts.daylight);

		const pcx = Math.floor(opts.eyeX / WORLD.chunkSize);
		const pcz = Math.floor(opts.eyeZ / WORLD.chunkSize);
		const visible: ChunkGpu[] = [];
		for (const chunk of this.chunks.values()) {
			if (Math.abs(chunk.cx - pcx) > this.renderDistance || Math.abs(chunk.cz - pcz) > this.renderDistance) continue;
			if (!this.chunkInFrustum(chunk)) continue;
			visible.push(chunk);
		}

		// 不透明
		gl.uniform1i(this.uMode, 0);
		gl.uniform1f(this.uAlphaCut, 0.5);
		gl.depthMask(true);
		gl.disable(gl.BLEND);
		for (const chunk of visible) {
			if (chunk.countOpaque === 0) continue;
			gl.bindVertexArray(chunk.vaoOpaque);
			gl.drawArrays(gl.TRIANGLES, 0, chunk.countOpaque);
		}

		// エンティティ
		this.drawEntities(opts.entities, opts.daylight, tint, now);

		// 注視ブロックの枠線。破壊が進むほど濃く、太く (線を重ねて) 見せる
		if (opts.target) {
			const p = Math.max(0, Math.min(1, opts.breakProgress));
			gl.uniform1i(this.uMode, 1);
			gl.uniform4f(this.uColor, 0.05 * (1 - p), 0.05 * (1 - p), 0.05 * (1 - p), 1);
			gl.bindVertexArray(this.outline.vao);
			const layers = 1 + Math.floor(p * 3);
			for (let i = 0; i < layers; i++) {
				const grow = 1 + i * 0.004;
				const off = -i * 0.002;
				gl.uniformMatrix4fv(this.uModel, false, mat4TranslateScale(opts.target.x + off, opts.target.y + off, opts.target.z + off, grow, grow, grow));
				gl.drawArrays(gl.LINES, 0, this.outline.count);
			}
			gl.uniformMatrix4fv(this.uModel, false, mat4Identity());
			if (opts.breakProgress > 0) this.drawCrack(opts.target, p);
		}

		// パーティクル
		gl.uniform3f(this.uTint, tint[0], tint[1], tint[2]);
		this.drawParticles(view, opts.daylight);

		// 半透明 (水・ガラス)
		gl.uniform1i(this.uMode, 0);
		gl.uniform1f(this.uAlphaCut, 0.01);
		gl.uniform1f(this.uDaylight, opts.daylight);
		gl.uniform3f(this.uTint, tint[0], tint[1], tint[2]);
		gl.enable(gl.BLEND);
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
		gl.depthMask(false);
		gl.disable(gl.CULL_FACE);
		for (const chunk of visible) {
			if (chunk.countTrans === 0) continue;
			gl.bindVertexArray(chunk.vaoTrans);
			gl.drawArrays(gl.TRIANGLES, 0, chunk.countTrans);
		}
		gl.enable(gl.CULL_FACE);
		gl.depthMask(true);
		gl.disable(gl.BLEND);

		// 手持ち
		if (opts.hand) {
			this.drawHand(opts.hand, aspect, opts.light ?? 1, tint, now);
		}

		gl.bindVertexArray(null);
	}

	public dispose(): void {
		const gl = this.gl;
		for (const key of [...this.chunks.keys()]) this.freeChunk(key);
		for (const g of this.entityGpu.values()) {
			gl.deleteBuffer(g.buf);
			gl.deleteVertexArray(g.vao);
		}
		this.entityGpu.clear();
		for (const g of [this.cube, this.outline, this.particleGpu, this.hand, this.armGpu, this.skyQuad, this.starGpu]) {
			gl.deleteBuffer(g.buf);
			gl.deleteVertexArray(g.vao);
		}
		for (const tex of this.handTex.values()) gl.deleteTexture(tex);
		this.handTex.clear();
		this.particles.clear();
		this.skins.dispose();
		gl.deleteTexture(this.atlasTex);
		gl.deleteProgram(this.program);
		gl.deleteProgram(this.skyProgram);
		const ext = gl.getExtension('WEBGL_lose_context');
		if (ext) ext.loseContext();
	}
}
