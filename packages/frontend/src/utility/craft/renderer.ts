/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { WORLD } from './constants.js';
import { getAtlasCanvas } from './atlas.js';
import { buildChunkMesh, VERTEX_FLOATS } from './mesher.js';
import { buildModelVertices, modelFor, modelVertexFloats } from './models.js';
import { SkinCache } from './skins.js';
import { mat4Identity, mat4Multiply, mat4Perspective, mat4TranslateScale, mat4View } from './math.js';
import type { EntityDraw, EntityKind, ModelDef } from './models.js';
import type { Mat4 } from './math.js';
import type { CraftWorld } from './world.js';

const VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec3 a_pos;
layout(location = 1) in vec2 a_uv;
layout(location = 2) in float a_light;
uniform mat4 u_viewProj;
uniform mat4 u_model;
out vec2 v_uv;
out float v_light;
out float v_dist;
void main() {
	vec4 world = u_model * vec4(a_pos, 1.0);
	gl_Position = u_viewProj * world;
	v_uv = a_uv;
	v_light = a_light;
	v_dist = gl_Position.w;
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
in float v_light;
in float v_dist;
uniform sampler2D u_atlas;
uniform vec3 u_fogColor;
uniform float u_fogNear;
uniform float u_fogFar;
uniform int u_mode; // 0: textured, 1: flat color
uniform vec4 u_color;
uniform float u_alphaCut;
uniform float u_daylight;
uniform vec3 u_tint;
out vec4 outColor;
void main() {
	vec4 c;
	if (u_mode == 1) {
		c = u_color * vec4(vec3(v_light), 1.0);
	} else {
		c = texture(u_atlas, v_uv);
		if (c.a < u_alphaCut) discard;
		// light が 1 を超える頂点は発光ブロック。昼夜で暗くしない
		float l = v_light > 1.5 ? 1.0 : v_light * u_daylight;
		c.rgb *= l * u_tint;
	}
	float fog = clamp((v_dist - u_fogNear) / (u_fogFar - u_fogNear), 0.0, 1.0);
	outColor = vec4(mix(c.rgb, u_fogColor, fog), c.a);
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

export const SKY_COLOR: [number, number, number] = [0.55, 0.75, 0.95];
const NIGHT_COLOR: [number, number, number] = [0.03, 0.04, 0.1];
const WATER_COLOR: [number, number, number] = [0.1, 0.26, 0.5];
const WATER_TINT: [number, number, number] = [0.7, 0.88, 1.0];
const HURT_TINT: [number, number, number] = [1.0, 0.35, 0.35];

/** 1 フレームで chunk のメッシュ生成に使ってよい時間 (ms)。最初の 1 つは必ず作る */
const MESH_TIME_BUDGET_MS = 6;
const EVICT_INTERVAL_MS = 2000;

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
	private chunks = new Map<string, ChunkGpu>();
	private atlasTex: WebGLTexture;
	private skins: SkinCache;
	private entityGpu = new Map<EntityKind, EntityGpu>();
	private cubeVao: WebGLVertexArrayObject;
	private cubeBuf: WebGLBuffer;
	private cubeCount: number;
	private outlineVao: WebGLVertexArrayObject;
	private outlineBuf: WebGLBuffer;
	private outlineCount: number;
	private lastEvict = 0;
	private planes = new Float32Array(24);
	public viewProj: Mat4 = mat4Identity();
	public renderDistance: number = WORLD.renderDistance; // chunks

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
		gl.uniform1i(loc('u_atlas'), 0);

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

		gl.enable(gl.DEPTH_TEST);
		gl.enable(gl.CULL_FACE);
		gl.cullFace(gl.BACK);

		const cube = this.makeCube();
		this.cubeVao = cube.vao;
		this.cubeBuf = cube.buf;
		this.cubeCount = cube.count;
		const outline = this.makeOutline();
		this.outlineVao = outline.vao;
		this.outlineBuf = outline.buf;
		this.outlineCount = outline.count;
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
		gl.bindVertexArray(null);
		return { vao, buf };
	}

	/** 単位立方体 (0..1)。flat color 描画用に面ごとの陰影を light に入れる */
	private makeCube(): { vao: WebGLVertexArrayObject; buf: WebGLBuffer; count: number } {
		const faces: { c: number[][]; l: number }[] = [
			{ c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], l: 0.8 },
			{ c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], l: 0.8 },
			{ c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], l: 1.0 },
			{ c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], l: 0.5 },
			{ c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], l: 0.7 },
			{ c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], l: 0.7 },
		];
		const out: number[] = [];
		for (const f of faces) {
			for (const i of [0, 1, 2, 0, 2, 3]) {
				out.push(f.c[i][0], f.c[i][1], f.c[i][2], 0, 0, f.l);
			}
		}
		const { vao, buf } = this.makeVao(new Float32Array(out));
		return { vao, buf, count: out.length / VERTEX_FLOATS };
	}

	private makeOutline(): { vao: WebGLVertexArrayObject; buf: WebGLBuffer; count: number } {
		const eps = 0.003;
		const a = -eps, b = 1 + eps;
		const p = [[a, a, a], [b, a, a], [b, a, b], [a, a, b], [a, b, a], [b, b, a], [b, b, b], [a, b, b]];
		const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
		const out: number[] = [];
		for (const [s, t] of edges) {
			out.push(...p[s], 0, 0, 1, ...p[t], 0, 0, 1);
		}
		const { vao, buf } = this.makeVao(new Float32Array(out));
		return { vao, buf, count: out.length / VERTEX_FLOATS };
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

	private drawEntities(entities: EntityDraw[], daylight: number, tint: [number, number, number]): void {
		if (entities.length === 0) return;
		const gl = this.gl;
		gl.uniform1i(this.uMode, 0);
		gl.uniform1f(this.uAlphaCut, 0.5);
		// 夜でも姿が分かるように、エンティティは昼夜の暗さを弱める
		gl.uniform1f(this.uDaylight, Math.max(daylight, 0.4));
		for (const ent of entities) {
			const g = this.getEntityGpu(ent.kind);
			buildModelVertices(g.model, ent.walkPhase ?? 0, g.scratch);
			gl.bindVertexArray(g.vao);
			gl.bindBuffer(gl.ARRAY_BUFFER, g.buf);
			gl.bufferSubData(gl.ARRAY_BUFFER, 0, g.scratch);
			gl.bindTexture(gl.TEXTURE_2D, this.skins.textureFor(ent.kind, ent.skinUrl ?? null));
			const t = ent.hurt ? HURT_TINT : tint;
			gl.uniform3f(this.uTint, t[0], t[1], t[2]);
			const c = Math.cos(ent.yaw), s = Math.sin(ent.yaw);
			const m = mat4Identity();
			m[0] = c; m[8] = s;
			m[2] = -s; m[10] = c;
			m[12] = ent.x; m[13] = ent.y; m[14] = ent.z;
			gl.uniformMatrix4fv(this.uModel, false, m);
			gl.drawArrays(gl.TRIANGLES, 0, g.count);
		}
		gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
		gl.uniformMatrix4fv(this.uModel, false, mat4Identity());
	}

	public render(opts: {
		eyeX: number; eyeY: number; eyeZ: number; yaw: number; pitch: number;
		target: { x: number; y: number; z: number } | null;
		breakProgress: number;
		daylight: number;
		underwater: boolean;
		entities: EntityDraw[];
	}): void {
		const gl = this.gl;
		if (!this.resize()) return;
		gl.viewport(0, 0, this.canvas.width, this.canvas.height);

		// 空・霧の色: 昼の空色と夜の濃紺を daylight で混ぜる。水中は青
		const t = Math.max(0, Math.min(1, (opts.daylight - 0.12) / 0.88));
		const fogColor: [number, number, number] = opts.underwater
			? [WATER_COLOR[0] * (0.25 + 0.75 * t), WATER_COLOR[1] * (0.25 + 0.75 * t), WATER_COLOR[2] * (0.35 + 0.65 * t)]
			: [
				NIGHT_COLOR[0] + (SKY_COLOR[0] - NIGHT_COLOR[0]) * t,
				NIGHT_COLOR[1] + (SKY_COLOR[1] - NIGHT_COLOR[1]) * t,
				NIGHT_COLOR[2] + (SKY_COLOR[2] - NIGHT_COLOR[2]) * t,
			];
		gl.clearColor(fogColor[0], fogColor[1], fogColor[2], 1);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

		const aspect = this.canvas.width / this.canvas.height;
		const proj = mat4Perspective(70 * Math.PI / 180, aspect, 0.1, 400);
		const view = mat4View(opts.eyeX, opts.eyeY, opts.eyeZ, opts.yaw, opts.pitch);
		this.viewProj = mat4Multiply(proj, view);
		this.extractPlanes(this.viewProj);

		gl.useProgram(this.program);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
		gl.uniformMatrix4fv(this.uViewProj, false, this.viewProj);
		gl.uniformMatrix4fv(this.uModel, false, mat4Identity());
		gl.uniform3f(this.uFogColor, fogColor[0], fogColor[1], fogColor[2]);
		const far = this.renderDistance * WORLD.chunkSize;
		if (opts.underwater) {
			gl.uniform1f(this.uFogNear, 1);
			gl.uniform1f(this.uFogFar, 22);
		} else {
			gl.uniform1f(this.uFogNear, far * 0.6);
			gl.uniform1f(this.uFogFar, far * 0.95);
		}
		const tint = opts.underwater ? WATER_TINT : [1, 1, 1] as [number, number, number];
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
		this.drawEntities(opts.entities, opts.daylight, tint);

		// 注視ブロックの枠線。破壊が進むほど濃く、太く (線を重ねて) 見せる
		if (opts.target) {
			const p = Math.max(0, Math.min(1, opts.breakProgress));
			gl.uniform1i(this.uMode, 1);
			gl.uniform4f(this.uColor, 0.05 * (1 - p), 0.05 * (1 - p), 0.05 * (1 - p), 1);
			gl.bindVertexArray(this.outlineVao);
			const layers = 1 + Math.floor(p * 3);
			for (let i = 0; i < layers; i++) {
				const grow = 1 + i * 0.004;
				const off = -i * 0.002;
				gl.uniformMatrix4fv(this.uModel, false, mat4TranslateScale(opts.target.x + off, opts.target.y + off, opts.target.z + off, grow, grow, grow));
				gl.drawArrays(gl.LINES, 0, this.outlineCount);
			}
			gl.uniformMatrix4fv(this.uModel, false, mat4Identity());
		}

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

		// 破壊の進み具合: 注視ブロックを暗く覆う
		if (opts.target && opts.breakProgress > 0) {
			const p = Math.max(0, Math.min(1, opts.breakProgress));
			gl.uniform1i(this.uMode, 1);
			gl.uniform4f(this.uColor, 0, 0, 0, 0.1 + p * 0.5);
			gl.uniformMatrix4fv(this.uModel, false, mat4TranslateScale(opts.target.x - 0.002, opts.target.y - 0.002, opts.target.z - 0.002, 1.004, 1.004, 1.004));
			gl.bindVertexArray(this.cubeVao);
			gl.drawArrays(gl.TRIANGLES, 0, this.cubeCount);
			gl.uniformMatrix4fv(this.uModel, false, mat4Identity());
		}

		gl.depthMask(true);
		gl.disable(gl.BLEND);
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
		gl.deleteBuffer(this.cubeBuf);
		gl.deleteVertexArray(this.cubeVao);
		gl.deleteBuffer(this.outlineBuf);
		gl.deleteVertexArray(this.outlineVao);
		this.skins.dispose();
		gl.deleteTexture(this.atlasTex);
		gl.deleteProgram(this.program);
		const ext = gl.getExtension('WEBGL_lose_context');
		if (ext) ext.loseContext();
	}
}
