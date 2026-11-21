<!--
SPDX-FileCopyrightText: misskey-bsky-integration fork
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div ref="rootEl" :class="$style.root">
	<canvas
		ref="canvasEl"
		:class="$style.canvas"
		tabindex="0"
		role="application"
		:aria-label="i18n.ts._radio.globeDescription"
		@pointerdown="onPointerDown"
		@pointermove="onPointerMove"
		@pointerup="onPointerUp"
		@pointercancel="onPointerCancel"
		@wheel="onWheel"
		@keydown="onKeydown"
	></canvas>
	<div :class="$style.crosshair"></div>
</div>
</template>

<script lang="ts" setup>
// ラジオウィジェットの地球儀 (bsky-fork 独自)。Radio Garden の地点を緑の点で描き、回して止まったときに
// 中央の照準に最も近い地点を選ぶ。
// 負荷を抑えるため、描くのは回しているあいだ (ドラッグ、慣性、移動のアニメーション) と大きさが変わったときだけで、
// 止まっているときは何もしない。点は大きさと奥行きで 6 組に分け、組ごとに 1 回だけ塗る。
import { onBeforeUnmount, onMounted, useTemplateRef, watch } from 'vue';
import type { RadioPlaces } from '@/utility/radio-garden.js';
import { i18n } from '@/i18n.js';

const props = defineProps<{
	places: RadioPlaces | null;
	selectedIndex: number | null;
	playingIndex: number | null;
}>();

const emit = defineEmits<{
	(ev: 'settle', index: number | null): void;
}>();

const rootEl = useTemplateRef('rootEl');
const canvasEl = useTemplateRef('canvasEl');

const DEG = Math.PI / 180;
const MAX_LAT = 80 * DEG;
const MIN_ZOOM = 1;
const MAX_ZOOM = 24;
// 止まったとき、中央からこの距離 (CSS px) 以内の地点を選ぶ
const SETTLE_RADIUS_PX = 22;
const TAP_RADIUS_PX = 16;
const FRICTION = 0.92;
const SNAP_MS = 350;
const reducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// 表示の状態。描くたびに変わるので reactive にしない
const view = {
	lon: 139.69 * DEG,
	lat: 35.69 * DEG,
	zoom: 1.4,
	vLon: 0,
	vLat: 0,
};
let snap: { fromLon: number; fromLat: number; toLon: number; toLat: number; start: number } | null = null;
let raf = 0;
let lastFrameAt = 0;
let dpr = 1;

// 地点ごとの画面上の位置 (描いた時点のもの)。visible が 0 の点は裏側か画面の外
let projected: { x: Float32Array; y: Float32Array; visible: Uint8Array } | null = null;

function clampLat(lat: number): number {
	return Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
}

function wrapLon(lon: number): number {
	return Math.atan2(Math.sin(lon), Math.cos(lon));
}

function radius(width: number, height: number): number {
	return Math.min(width, height) * 0.44 * view.zoom;
}

function requestDraw(): void {
	if (raf !== 0) return;
	raf = window.requestAnimationFrame(frame);
}

function frame(now: number): void {
	raf = 0;
	const dt = lastFrameAt === 0 ? 16.7 : Math.min(64, now - lastFrameAt);
	lastFrameAt = now;
	let moving = false;

	if (snap != null) {
		const t = Math.min(1, (now - snap.start) / SNAP_MS);
		const eased = 1 - Math.pow(1 - t, 3);
		view.lon = snap.fromLon + wrapLon(snap.toLon - snap.fromLon) * eased;
		view.lat = snap.fromLat + (snap.toLat - snap.fromLat) * eased;
		if (t < 1) {
			moving = true;
		} else {
			snap = null;
		}
	} else if (dragging == null && (Math.abs(view.vLon) > 0.00005 || Math.abs(view.vLat) > 0.00005)) {
		const k = dt / 16.7;
		view.lon = wrapLon(view.lon + view.vLon * k);
		view.lat = clampLat(view.lat + view.vLat * k);
		const f = Math.pow(FRICTION, k);
		view.vLon *= f;
		view.vLat *= f;
		if (Math.abs(view.vLon) > 0.00005 || Math.abs(view.vLat) > 0.00005) {
			moving = true;
		} else {
			view.vLon = 0;
			view.vLat = 0;
			settle();
		}
	}

	draw();
	if (moving) {
		requestDraw();
	} else {
		lastFrameAt = 0;
	}
}

// 地球儀は配信映像と同じく常に暗い配色で描く (テーマに合わせると点が見えなくなる)
const COLOR_DOT = 'rgba(64, 232, 120, 0.95)';
const COLOR_DOT_LIMB = 'rgba(64, 232, 120, 0.4)';
const COLOR_GRID = 'rgba(120, 200, 150, 0.08)';

function draw(): void {
	const canvas = canvasEl.value;
	if (canvas == null) return;
	const ctx = canvas.getContext('2d');
	if (ctx == null) return;
	const w = canvas.width;
	const h = canvas.height;
	const cx = w / 2;
	const cy = h / 2;
	const R = radius(w, h);
	ctx.clearRect(0, 0, w, h);

	const sea = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.05, cx, cy, R);
	sea.addColorStop(0, '#12261a');
	sea.addColorStop(1, '#030806');
	ctx.beginPath();
	ctx.arc(cx, cy, R, 0, Math.PI * 2);
	ctx.fillStyle = sea;
	ctx.fill();
	ctx.lineWidth = 1.5 * dpr;
	ctx.strokeStyle = 'rgba(64, 232, 120, 0.18)';
	ctx.stroke();

	const sinL = Math.sin(view.lon);
	const cosL = Math.cos(view.lon);
	const sinP = Math.sin(view.lat);
	const cosP = Math.cos(view.lat);

	// 経線と緯線 (30 度ごと)。拡大すると線が散らかるので、引いたときだけ
	if (view.zoom < 4) {
		ctx.beginPath();
		const line = (pts: [number, number][]) => {
			let pen = false;
			for (const [lonDeg, latDeg] of pts) {
				const l = lonDeg * DEG;
				const p = latDeg * DEG;
				const x = Math.cos(p) * Math.sin(l);
				const y = Math.sin(p);
				const z = Math.cos(p) * Math.cos(l);
				const x1 = x * cosL - z * sinL;
				const z1 = x * sinL + z * cosL;
				const y2 = y * cosP - z1 * sinP;
				const z2 = y * sinP + z1 * cosP;
				if (z2 <= 0) {
					pen = false;
					continue;
				}
				const sx = cx + x1 * R;
				const sy = cy - y2 * R;
				if (pen) {
					ctx.lineTo(sx, sy);
				} else {
					ctx.moveTo(sx, sy);
					pen = true;
				}
			}
		};
		for (let lonDeg = -180; lonDeg < 180; lonDeg += 30) {
			const pts: [number, number][] = [];
			for (let latDeg = -90; latDeg <= 90; latDeg += 6) pts.push([lonDeg, latDeg]);
			line(pts);
		}
		for (let latDeg = -60; latDeg <= 60; latDeg += 30) {
			const pts: [number, number][] = [];
			for (let lonDeg = -180; lonDeg <= 180; lonDeg += 6) pts.push([lonDeg, latDeg]);
			line(pts);
		}
		ctx.lineWidth = dpr;
		ctx.strokeStyle = COLOR_GRID;
		ctx.stroke();
	}

	const places = props.places;
	if (places == null) {
		projected = null;
		return;
	}

	let proj = projected;
	if (proj == null || proj.x.length !== places.count) {
		proj = { x: new Float32Array(places.count), y: new Float32Array(places.count), visible: new Uint8Array(places.count) };
		projected = proj;
	}

	// 点の大きさ: 局の数で 3 段階。拡大したら少しだけ大きくする
	const scale = dpr * Math.min(2.2, 1 + (view.zoom - 1) * 0.12);
	const sizes = [1.1 * scale, 1.7 * scale, 2.6 * scale];
	const front = [new Path2D(), new Path2D(), new Path2D()];
	const limb = [new Path2D(), new Path2D(), new Path2D()];
	const { x: X, y: Y, z: Z } = places;
	for (let i = 0; i < places.count; i++) {
		const x1 = X[i] * cosL - Z[i] * sinL;
		const z1 = X[i] * sinL + Z[i] * cosL;
		const y2 = Y[i] * cosP - z1 * sinP;
		const z2 = Y[i] * sinP + z1 * cosP;
		if (z2 <= 0) {
			proj.visible[i] = 0;
			continue;
		}
		const sx = cx + x1 * R;
		const sy = cy - y2 * R;
		if (sx < -8 || sx > w + 8 || sy < -8 || sy > h + 8) {
			proj.visible[i] = 0;
			continue;
		}
		proj.visible[i] = 1;
		proj.x[i] = sx;
		proj.y[i] = sy;
		const n = places.sizes[i];
		const b = n >= 20 ? 2 : n >= 4 ? 1 : 0;
		const r = sizes[b];
		const path = z2 < 0.3 ? limb[b] : front[b];
		if (b === 2) {
			path.moveTo(sx + r, sy);
			path.arc(sx, sy, r, 0, Math.PI * 2);
		} else {
			path.rect(sx - r, sy - r, r * 2, r * 2);
		}
	}
	ctx.fillStyle = COLOR_DOT_LIMB;
	for (const p of limb) ctx.fill(p);
	ctx.fillStyle = COLOR_DOT;
	for (const p of front) ctx.fill(p);

	const ring = (index: number | null, color: string, r: number) => {
		if (index == null || index >= places.count || proj.visible[index] !== 1) return;
		ctx.beginPath();
		ctx.arc(proj.x[index], proj.y[index], r * dpr, 0, Math.PI * 2);
		ctx.lineWidth = 2 * dpr;
		ctx.strokeStyle = color;
		ctx.stroke();
	};
	ring(props.playingIndex, COLOR_DOT, 8);
	ring(props.selectedIndex, 'rgba(255, 255, 255, 0.9)', 5);
}

// 画面上の (px, py) に最も近い点。maxDistPx は CSS px
function pickNearest(px: number, py: number, maxDistPx: number): number | null {
	const proj = projected;
	if (proj == null) return null;
	const max = maxDistPx * dpr;
	let best: number | null = null;
	let bestDist = max * max;
	for (let i = 0; i < proj.visible.length; i++) {
		if (proj.visible[i] !== 1) continue;
		const dx = proj.x[i] - px;
		const dy = proj.y[i] - py;
		const d = dx * dx + dy * dy;
		if (d < bestDist) {
			bestDist = d;
			best = i;
		}
	}
	return best;
}

function settle(): void {
	const canvas = canvasEl.value;
	if (canvas == null) return;
	const index = pickNearest(canvas.width / 2, canvas.height / 2, SETTLE_RADIUS_PX);
	if (index != null) focusPlace(index, true);
	emit('settle', index);
}

function focusPlace(index: number, animate: boolean): void {
	const places = props.places;
	if (places == null || index >= places.count) return;
	const toLon = places.lon[index] * DEG;
	const toLat = clampLat(places.lat[index] * DEG);
	view.vLon = 0;
	view.vLat = 0;
	if (!animate || reducedMotion) {
		snap = null;
		view.lon = toLon;
		view.lat = toLat;
		requestDraw();
		return;
	}
	snap = { fromLon: view.lon, fromLat: view.lat, toLon, toLat, start: performance.now() };
	requestDraw();
}

function zoomBy(factor: number): void {
	view.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, view.zoom * factor));
	requestDraw();
}

// ---- 操作 ----

const pointers = new Map<number, { x: number; y: number }>();
let dragging: { startX: number; startY: number; startAt: number; moved: boolean; samples: { t: number; lon: number; lat: number }[] } | null = null;
let pinchDistance: number | null = null;

function canvasPoint(ev: PointerEvent | WheelEvent): { x: number; y: number } {
	const rect = canvasEl.value?.getBoundingClientRect();
	if (rect == null) return { x: 0, y: 0 };
	return { x: (ev.clientX - rect.left) * dpr, y: (ev.clientY - rect.top) * dpr };
}

function onPointerDown(ev: PointerEvent): void {
	if (ev.button !== 0 && ev.pointerType === 'mouse') return;
	canvasEl.value?.setPointerCapture(ev.pointerId);
	canvasEl.value?.focus({ preventScroll: true });
	const p = canvasPoint(ev);
	pointers.set(ev.pointerId, p);
	snap = null;
	view.vLon = 0;
	view.vLat = 0;
	if (pointers.size === 1) {
		dragging = { startX: p.x, startY: p.y, startAt: performance.now(), moved: false, samples: [{ t: performance.now(), lon: view.lon, lat: view.lat }] };
	} else if (pointers.size === 2) {
		const [a, b] = [...pointers.values()];
		pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
		if (dragging != null) dragging.moved = true;
	}
}

function onPointerMove(ev: PointerEvent): void {
	const prev = pointers.get(ev.pointerId);
	if (prev == null) return;
	const p = canvasPoint(ev);
	pointers.set(ev.pointerId, p);

	if (pointers.size >= 2) {
		const [a, b] = [...pointers.values()];
		const d = Math.hypot(a.x - b.x, a.y - b.y);
		if (pinchDistance != null && pinchDistance > 0) zoomBy(d / pinchDistance);
		pinchDistance = d;
		return;
	}
	const canvas = canvasEl.value;
	if (dragging == null || canvas == null) return;
	const R = radius(canvas.width, canvas.height);
	view.lon = wrapLon(view.lon - (p.x - prev.x) / R);
	view.lat = clampLat(view.lat + (p.y - prev.y) / R);
	if (Math.hypot(p.x - dragging.startX, p.y - dragging.startY) > 4 * dpr) dragging.moved = true;
	const now = performance.now();
	dragging.samples.push({ t: now, lon: view.lon, lat: view.lat });
	while (dragging.samples.length > 2 && now - dragging.samples[0].t > 100) dragging.samples.shift();
	requestDraw();
}

function onPointerUp(ev: PointerEvent): void {
	if (!pointers.has(ev.pointerId)) return;
	pointers.delete(ev.pointerId);
	if (pointers.size > 0) {
		pinchDistance = null;
		return;
	}
	pinchDistance = null;
	const drag = dragging;
	dragging = null;
	if (drag == null) return;

	if (!drag.moved && performance.now() - drag.startAt < 500) {
		// タップした点へ移る
		const index = pickNearest(drag.startX, drag.startY, TAP_RADIUS_PX);
		if (index != null) {
			focusPlace(index, true);
			emit('settle', index);
		}
		return;
	}

	const first = drag.samples[0];
	const last = drag.samples[drag.samples.length - 1];
	const span = last.t - first.t;
	if (!reducedMotion && span > 0 && performance.now() - last.t < 80) {
		view.vLon = wrapLon(last.lon - first.lon) / span * 16.7;
		view.vLat = (last.lat - first.lat) / span * 16.7;
	}
	if (Math.abs(view.vLon) > 0.00005 || Math.abs(view.vLat) > 0.00005) {
		requestDraw();
	} else {
		settle();
	}
}

function onPointerCancel(ev: PointerEvent): void {
	pointers.delete(ev.pointerId);
	if (pointers.size === 0) {
		dragging = null;
		pinchDistance = null;
	}
}

// ホイールで拡大縮小するのは、地球儀を操作したあと (フォーカスがあるとき) か Ctrl を押しているときだけ。
// サイドバーをスクロールしていて地球儀の上を通っただけで、拡大されないように
function onWheel(ev: WheelEvent): void {
	if (!ev.ctrlKey && window.document.activeElement !== canvasEl.value) return;
	ev.preventDefault();
	zoomBy(Math.exp(-ev.deltaY * 0.0015));
}

let keySettleTimer: number | null = null;

function onKeydown(ev: KeyboardEvent): void {
	const step = 6 * DEG / view.zoom;
	switch (ev.key) {
		case 'ArrowLeft': view.lon = wrapLon(view.lon - step); break;
		case 'ArrowRight': view.lon = wrapLon(view.lon + step); break;
		case 'ArrowUp': view.lat = clampLat(view.lat + step); break;
		case 'ArrowDown': view.lat = clampLat(view.lat - step); break;
		case '+':
		case '=': zoomBy(1.4); break;
		case '-': zoomBy(1 / 1.4); break;
		case 'Enter': settle(); ev.preventDefault(); return;
		default: return;
	}
	ev.preventDefault();
	requestDraw();
	if (ev.key.startsWith('Arrow')) {
		if (keySettleTimer != null) window.clearTimeout(keySettleTimer);
		keySettleTimer = window.setTimeout(() => {
			keySettleTimer = null;
			settle();
		}, 400);
	}
}

// ---- 大きさ ----

let resizeObserver: ResizeObserver | null = null;

function resize(): void {
	const canvas = canvasEl.value;
	const root = rootEl.value;
	if (canvas == null || root == null) return;
	dpr = Math.min(2, window.devicePixelRatio || 1);
	const w = Math.max(1, Math.round(root.clientWidth * dpr));
	const h = Math.max(1, Math.round(root.clientHeight * dpr));
	if (canvas.width !== w || canvas.height !== h) {
		canvas.width = w;
		canvas.height = h;
	}
	requestDraw();
}

onMounted(() => {
	resize();
	resizeObserver = new ResizeObserver(() => resize());
	if (rootEl.value != null) resizeObserver.observe(rootEl.value);
});

onBeforeUnmount(() => {
	resizeObserver?.disconnect();
	if (raf !== 0) window.cancelAnimationFrame(raf);
	if (keySettleTimer != null) window.clearTimeout(keySettleTimer);
});

watch(() => [props.places, props.selectedIndex, props.playingIndex], () => requestDraw());

defineExpose({
	focusPlace,
	zoomBy,
});
</script>

<style lang="scss" module>
.root {
	position: relative;
	width: 100%;
	height: 100%;
	overflow: hidden;
}

.canvas {
	display: block;
	width: 100%;
	height: 100%;
	touch-action: none;
	cursor: grab;
	outline: none;

	&:active {
		cursor: grabbing;
	}

	&:focus-visible {
		box-shadow: inset 0 0 0 2px var(--MI_THEME-focus);
	}
}

// 中央の照準 (地球儀の上なので常に白)
.crosshair {
	position: absolute;
	top: 50%;
	left: 50%;
	width: 26px;
	height: 26px;
	margin: -13px 0 0 -13px;
	border: 2px solid rgba(255, 255, 255, 0.85);
	border-radius: 50%;
	pointer-events: none;
	box-shadow: 0 0 6px rgba(0, 0, 0, 0.6);
}
</style>
