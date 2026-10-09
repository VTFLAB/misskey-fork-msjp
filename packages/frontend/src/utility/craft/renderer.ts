/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { WORLD } from './constants.js';
import { buildAtlas } from './atlas.js';
import { buildChunkMesh, VERTEX_FLOATS } from './mesher.js';
import { mat4Identity, mat4Multiply, mat4Perspective, mat4TranslateScale, mat4View } from './math.js';
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
out vec4 outColor;
void main() {
	vec4 c;
	if (u_mode == 1) {
		c = u_color * vec4(vec3(v_light), 1.0);
	} else {
		c = texture(u_atlas, v_uv);
		if (c.a < u_alphaCut) discard;
		c.rgb *= v_light;
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

export type RemotePlayerDraw = {
	x: number;
	y: number;
	z: number;
	yaw: number;
	color: [number, number, number];
};

export const SKY_COLOR: [number, number, number] = [0.55, 0.75, 0.95];

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
	private chunks = new Map<string, ChunkGpu>();
	private cubeVao: WebGLVertexArrayObject;
	private cubeCount: number;
	private outlineVao: WebGLVertexArrayObject;
	private outlineCount: number;
	public viewProj: Mat4 = mat4Identity();
	public renderDistance = 8; // chunks

	constructor(private canvas: HTMLCanvasElement, private world: CraftWorld) {
		const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
		if (gl == null) throw new Error('WebGL2 is not available');
		this.gl = gl;
		this.program = this.createProgram(VERT, FRAG);
		gl.useProgram(this.program);
		this.uViewProj = gl.getUniformLocation(this.program, 'u_viewProj')!;
		this.uModel = gl.getUniformLocation(this.program, 'u_model')!;
		this.uMode = gl.getUniformLocation(this.program, 'u_mode')!;
		this.uColor = gl.getUniformLocation(this.program, 'u_color')!;
		this.uAlphaCut = gl.getUniformLocation(this.program, 'u_alphaCut')!;
		this.uFogNear = gl.getUniformLocation(this.program, 'u_fogNear')!;
		this.uFogFar = gl.getUniformLocation(this.program, 'u_fogFar')!;
		gl.uniform3f(gl.getUniformLocation(this.program, 'u_fogColor'), SKY_COLOR[0], SKY_COLOR[1], SKY_COLOR[2]);
		gl.uniform1i(gl.getUniformLocation(this.program, 'u_atlas'), 0);

		const atlas = buildAtlas();
		const tex = gl.createTexture()!;
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, tex);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

		gl.enable(gl.DEPTH_TEST);
		gl.enable(gl.CULL_FACE);
		gl.cullFace(gl.BACK);

		const cube = this.makeCube();
		this.cubeVao = cube.vao;
		this.cubeCount = cube.count;
		const outline = this.makeOutline();
		this.outlineVao = outline.vao;
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

	private makeVao(data: Float32Array, buffer?: WebGLBuffer): { vao: WebGLVertexArrayObject; buf: WebGLBuffer } {
		const gl = this.gl;
		const vao = gl.createVertexArray()!;
		const buf = buffer ?? gl.createBuffer()!;
		gl.bindVertexArray(vao);
		gl.bindBuffer(gl.ARRAY_BUFFER, buf);
		gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
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
	private makeCube(): { vao: WebGLVertexArrayObject; count: number } {
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
		const { vao } = this.makeVao(new Float32Array(out));
		return { vao, count: out.length / VERTEX_FLOATS };
	}

	private makeOutline(): { vao: WebGLVertexArrayObject; count: number } {
		const e = 0.003;
		const a = -e, b = 1 + e;
		const p = [[a, a, a], [b, a, a], [b, a, b], [a, a, b], [a, b, a], [b, b, a], [b, b, b], [a, b, b]];
		const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
		const out: number[] = [];
		for (const [s, t] of edges) {
			out.push(...p[s], 0, 0, 1, ...p[t], 0, 0, 1);
		}
		const { vao } = this.makeVao(new Float32Array(out));
		return { vao, count: out.length / VERTEX_FLOATS };
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

	/**
	 * プレイヤー周辺の chunk を用意し、dirty な chunk を作り直す。
	 * 1 フレームあたりの新規メッシュ数を抑えて、初回ロードで固まらないようにする。
	 */
	public updateChunks(px: number, pz: number, budget = 4, rebuildBudget = 8): void {
		const pcx = Math.floor(px / WORLD.chunkSize);
		const pcz = Math.floor(pz / WORLD.chunkSize);
		let built = 0;
		let rebuilt = 0;
		for (const key of this.world.dirty) {
			if (!this.chunks.has(key)) {
				// GPU 上に無い chunk は、近づいた時に下の近い順ループが最新の内容で作る
				this.world.dirty.delete(key);
				continue;
			}
			if (rebuilt >= rebuildBudget) break;
			const [cx, cz] = key.split(',').map(Number);
			this.world.dirty.delete(key);
			this.uploadChunk(cx, cz);
			rebuilt++;
		}
		// 近い順に未生成 chunk を作る
		for (let r = 0; r <= this.renderDistance && built < budget; r++) {
			for (let dz = -r; dz <= r && built < budget; dz++) {
				for (let dx = -r; dx <= r && built < budget; dx++) {
					if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
					const cx = pcx + dx;
					const cz = pcz + dz;
					if (cx < WORLD.minX / WORLD.chunkSize || cx > WORLD.maxX / WORLD.chunkSize) continue;
					if (cz < WORLD.minZ / WORLD.chunkSize || cz > WORLD.maxZ / WORLD.chunkSize) continue;
					const key = `${cx},${cz}`;
					if (this.chunks.has(key)) continue;
					this.uploadChunk(cx, cz);
					built++;
				}
			}
		}
	}

	public get pendingChunks(): boolean {
		return this.world.dirty.size > 0;
	}

	public render(opts: {
		eyeX: number; eyeY: number; eyeZ: number; yaw: number; pitch: number;
		target: { x: number; y: number; z: number } | null;
		players: RemotePlayerDraw[];
	}): void {
		const gl = this.gl;
		if (!this.resize()) return;
		gl.viewport(0, 0, this.canvas.width, this.canvas.height);
		gl.clearColor(SKY_COLOR[0], SKY_COLOR[1], SKY_COLOR[2], 1);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

		const aspect = this.canvas.width / this.canvas.height;
		const proj = mat4Perspective(70 * Math.PI / 180, aspect, 0.1, 400);
		const view = mat4View(opts.eyeX, opts.eyeY, opts.eyeZ, opts.yaw, opts.pitch);
		this.viewProj = mat4Multiply(proj, view);

		gl.useProgram(this.program);
		gl.uniformMatrix4fv(this.uViewProj, false, this.viewProj);
		gl.uniformMatrix4fv(this.uModel, false, mat4Identity());
		const far = this.renderDistance * WORLD.chunkSize;
		gl.uniform1f(this.uFogNear, far * 0.6);
		gl.uniform1f(this.uFogFar, far * 0.95);

		const pcx = Math.floor(opts.eyeX / WORLD.chunkSize);
		const pcz = Math.floor(opts.eyeZ / WORLD.chunkSize);
		const visible: ChunkGpu[] = [];
		for (const chunk of this.chunks.values()) {
			if (Math.abs(chunk.cx - pcx) > this.renderDistance || Math.abs(chunk.cz - pcz) > this.renderDistance) continue;
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

		// 他プレイヤー (体と頭の 2 箱)
		gl.uniform1i(this.uMode, 1);
		gl.bindVertexArray(this.cubeVao);
		for (const p of opts.players) {
			gl.uniform4f(this.uColor, p.color[0], p.color[1], p.color[2], 1);
			gl.uniformMatrix4fv(this.uModel, false, mat4TranslateScale(p.x - 0.3, p.y, p.z - 0.3, 0.6, 1.3, 0.6));
			gl.drawArrays(gl.TRIANGLES, 0, this.cubeCount);
			gl.uniform4f(this.uColor, p.color[0] * 0.8 + 0.2, p.color[1] * 0.8 + 0.2, p.color[2] * 0.8 + 0.2, 1);
			gl.uniformMatrix4fv(this.uModel, false, mat4TranslateScale(p.x - 0.25, p.y + 1.3, p.z - 0.25, 0.5, 0.5, 0.5));
			gl.drawArrays(gl.TRIANGLES, 0, this.cubeCount);
		}

		// 注視ブロックの枠線
		if (opts.target) {
			gl.uniform4f(this.uColor, 0.05, 0.05, 0.05, 1);
			gl.uniformMatrix4fv(this.uModel, false, mat4TranslateScale(opts.target.x, opts.target.y, opts.target.z, 1, 1, 1));
			gl.bindVertexArray(this.outlineVao);
			gl.drawArrays(gl.LINES, 0, this.outlineCount);
		}
		gl.uniformMatrix4fv(this.uModel, false, mat4Identity());

		// 半透明 (水・ガラス)
		gl.uniform1i(this.uMode, 0);
		gl.uniform1f(this.uAlphaCut, 0.01);
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
		gl.bindVertexArray(null);
	}

	public dispose(): void {
		const gl = this.gl;
		for (const chunk of this.chunks.values()) {
			gl.deleteBuffer(chunk.bufOpaque);
			gl.deleteBuffer(chunk.bufTrans);
			gl.deleteVertexArray(chunk.vaoOpaque);
			gl.deleteVertexArray(chunk.vaoTrans);
		}
		this.chunks.clear();
		gl.deleteProgram(this.program);
		const ext = gl.getExtension('WEBGL_lose_context');
		if (ext) ext.loseContext();
	}
}
