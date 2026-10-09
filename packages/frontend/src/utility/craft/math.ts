/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export type Mat4 = Float32Array;

export function mat4Identity(): Mat4 {
	const m = new Float32Array(16);
	m[0] = 1; m[5] = 1; m[10] = 1; m[15] = 1;
	return m;
}

export function mat4Perspective(fovY: number, aspect: number, near: number, far: number): Mat4 {
	const f = 1 / Math.tan(fovY / 2);
	const m = new Float32Array(16);
	m[0] = f / aspect;
	m[5] = f;
	m[10] = (far + near) / (near - far);
	m[11] = -1;
	m[14] = (2 * far * near) / (near - far);
	return m;
}

/** yaw (y 軸回り) と pitch (x 軸回り) のカメラから view 行列を作る */
export function mat4View(eyeX: number, eyeY: number, eyeZ: number, yaw: number, pitch: number): Mat4 {
	const cy = Math.cos(yaw), sy = Math.sin(yaw);
	const cp = Math.cos(pitch), sp = Math.sin(pitch);
	// 回転 (pitch → yaw の逆) を列優先で組む
	const m = new Float32Array(16);
	m[0] = cy; m[4] = 0; m[8] = -sy;
	m[1] = sy * sp; m[5] = cp; m[9] = cy * sp;
	m[2] = sy * cp; m[6] = -sp; m[10] = cy * cp;
	m[12] = -(m[0] * eyeX + m[4] * eyeY + m[8] * eyeZ);
	m[13] = -(m[1] * eyeX + m[5] * eyeY + m[9] * eyeZ);
	m[14] = -(m[2] * eyeX + m[6] * eyeY + m[10] * eyeZ);
	m[15] = 1;
	return m;
}

export function mat4Multiply(a: Mat4, b: Mat4): Mat4 {
	const out = new Float32Array(16);
	for (let c = 0; c < 4; c++) {
		for (let r = 0; r < 4; r++) {
			out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
		}
	}
	return out;
}

export function mat4Translate(x: number, y: number, z: number): Mat4 {
	const m = mat4Identity();
	m[12] = x; m[13] = y; m[14] = z;
	return m;
}

export function mat4TranslateScale(x: number, y: number, z: number, sx: number, sy: number, sz: number): Mat4 {
	const m = new Float32Array(16);
	m[0] = sx; m[5] = sy; m[10] = sz; m[15] = 1;
	m[12] = x; m[13] = y; m[14] = z;
	return m;
}

/** 視線方向の単位ベクトル (yaw=0 で -z 方向) */
export function lookDir(yaw: number, pitch: number): [number, number, number] {
	const cp = Math.cos(pitch);
	return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
}

/** ワールド座標を正規化デバイス座標へ。カメラの後ろなら null */
export function project(vp: Mat4, x: number, y: number, z: number): { x: number; y: number; depth: number } | null {
	const cx = vp[0] * x + vp[4] * y + vp[8] * z + vp[12];
	const cy = vp[1] * x + vp[5] * y + vp[9] * z + vp[13];
	const cz = vp[2] * x + vp[6] * y + vp[10] * z + vp[14];
	const cw = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
	if (cw <= 0.0001) return null;
	return { x: cx / cw, y: cy / cw, depth: cz / cw };
}
