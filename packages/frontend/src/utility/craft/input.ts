/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { emptyInput } from './types.js';
import type { InputState } from './types.js';

export type InputMode = 'desktop' | 'touch';

export type TouchElements = {
	joystick: HTMLElement;
	look: HTMLElement;
	jump: HTMLElement;
	attack: HTMLElement;
	use: HTMLElement;
	sneak: HTMLElement;
	sprint: HTMLElement;
};

const MOUSE_SENS = 0.0022;
const TOUCH_SENS = 0.005;
const STICK_RADIUS = 40;
const STICK_DEAD = 0.3;
const STICK_SPRINT = 0.85;
const DOUBLE_TAP_MS = 300;
const TAP_MAX_MS = 200;
const LONG_PRESS_MS = 350;
const MOVE_SLOP = 8;

export class InputController {
	public readonly state: InputState = emptyInput();
	public mode: InputMode;

	private canvas: HTMLCanvasElement;
	private stage: HTMLElement;
	private touchActive = false;
	private lastActive = false;
	private lastFullscreen = false;
	private activeListeners: ((active: boolean) => void)[] = [];
	private fullscreenListeners: ((fullscreen: boolean) => void)[] = [];
	private readonly out: InputState = emptyInput();

	private lastWDown = 0;
	private sprintKey = false;

	// 攻撃の押下元。どれか 1 つでも true なら attack
	private attackMouse = false;
	private attackLook = false;
	private attackButton = false;

	// 使用 (右クリック / 使うボタン) の押下元
	private useMouse = false;
	private useButton = false;

	// タッチ
	private sneakToggle = false;
	private sprintToggle = false;
	private sprintStick = false;
	private jumpButton = false;

	private globalAbort = new AbortController();
	private touchAbort: AbortController | null = null;

	constructor(opts: { canvas: HTMLCanvasElement; stage: HTMLElement }) {
		this.canvas = opts.canvas;
		this.stage = opts.stage;
		this.mode = (navigator.maxTouchPoints > 0 && window.matchMedia('(pointer: coarse)').matches) ? 'touch' : 'desktop';

		const sig = { signal: this.globalAbort.signal };
		window.addEventListener('keydown', this.onKey, { capture: true, ...sig });
		window.addEventListener('keyup', this.onKey, { capture: true, ...sig });
		window.addEventListener('mousemove', this.onMouseMove, sig);
		window.addEventListener('mouseup', this.onMouseUp, sig);
		window.addEventListener('blur', () => this.clearHeld(), sig);
		this.canvas.addEventListener('mousedown', this.onMouseDown, sig);
		this.canvas.addEventListener('contextmenu', (ev) => ev.preventDefault(), sig);
		this.canvas.addEventListener('wheel', this.onWheel, { passive: false, ...sig });
		window.document.addEventListener('pointerlockchange', this.onPointerLockChange, sig);
		window.document.addEventListener('fullscreenchange', this.onFullscreenChange, sig);
	}

	public get active(): boolean {
		if (this.mode === 'touch') return this.touchActive;
		return window.document.pointerLockElement === this.canvas;
	}

	public get isFullscreen(): boolean {
		return window.document.fullscreenElement != null;
	}

	public setMode(mode: InputMode): void {
		if (this.mode === mode) return;
		if (this.mode === 'desktop' && window.document.pointerLockElement === this.canvas) {
			window.document.exitPointerLock();
		}
		this.mode = mode;
		this.touchActive = false;
		this.clearHeld();
		this.emitActive();
	}

	public start(): void {
		if (this.mode === 'touch') {
			this.touchActive = true;
			this.emitActive();
			return;
		}
		try {
			const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
			if (p && typeof p.catch === 'function') p.catch(() => {});
		} catch {
			// ignore
		}
	}

	public stop(): void {
		if (this.mode === 'touch') {
			this.touchActive = false;
			this.clearHeld();
			this.emitActive();
			return;
		}
		if (window.document.pointerLockElement === this.canvas) {
			window.document.exitPointerLock();
		}
		this.clearHeld();
	}

	public on(event: 'activeChange', fn: (active: boolean) => void): void;
	public on(event: 'fullscreenChange', fn: (fullscreen: boolean) => void): void;
	public on(event: 'activeChange' | 'fullscreenChange', fn: (v: boolean) => void): void {
		if (event === 'activeChange') this.activeListeners.push(fn);
		else this.fullscreenListeners.push(fn);
	}

	public async toggleFullscreen(): Promise<void> {
		const doc = window.document;
		const orientation = screen.orientation as (ScreenOrientation & { lock?: (o: string) => Promise<void> }) | undefined;
		try {
			if (doc.fullscreenElement) {
				await doc.exitFullscreen();
				if (this.mode === 'touch') {
					try { orientation?.unlock(); } catch { /* ignore */ }
				}
			} else {
				await this.stage.requestFullscreen();
				if (this.mode === 'touch' && orientation?.lock) {
					try { await orientation.lock('landscape'); } catch { /* ignore */ }
				}
			}
		} catch {
			// フルスクリーン非対応・拒否は無視する
		}
	}

	/** 現在の入力のコピーを返し、エッジ値をリセットする */
	public consumeFrame(): InputState {
		const s = this.state;
		const o = this.out;
		o.forward = s.forward; o.back = s.back; o.left = s.left; o.right = s.right;
		o.jump = s.jump; o.sneak = s.sneak; o.sprint = s.sprint;
		o.lookDX = s.lookDX; o.lookDY = s.lookDY;
		o.attack = s.attack; o.usePressed = s.usePressed; o.use = s.use;
		o.hotbarDelta = s.hotbarDelta; o.hotbarSelect = s.hotbarSelect;
		o.togglePressed = s.togglePressed;
		o.fullscreenPressed = s.fullscreenPressed;
		o.dropPressed = s.dropPressed;
		s.lookDX = 0; s.lookDY = 0;
		s.hotbarDelta = 0; s.hotbarSelect = null;
		s.usePressed = false; s.togglePressed = false; s.fullscreenPressed = false; s.dropPressed = false;
		return o;
	}

	public dispose(): void {
		this.globalAbort.abort();
		this.touchAbort?.abort();
		this.touchAbort = null;
		this.activeListeners = [];
		this.fullscreenListeners = [];
		this.clearHeld();
	}

	// ---- 内部 ----

	private emitActive(): void {
		const a = this.active;
		if (a === this.lastActive) return;
		this.lastActive = a;
		for (const fn of this.activeListeners) fn(a);
	}

	private clearHeld(): void {
		const s = this.state;
		s.forward = s.back = s.left = s.right = false;
		s.jump = s.sneak = s.sprint = false;
		s.attack = false;
		s.use = false;
		this.attackMouse = this.attackLook = this.attackButton = false;
		this.useMouse = this.useButton = false;
		this.sprintKey = false;
		this.sneakToggle = this.sprintToggle = this.sprintStick = false;
		this.jumpButton = false;
		this.sneakEl?.classList.remove('active');
		this.sprintEl?.classList.remove('active');
		s.lookDX = 0; s.lookDY = 0;
		s.usePressed = false; s.togglePressed = false; s.dropPressed = false;
		s.hotbarDelta = 0; s.hotbarSelect = null;
	}

	private syncAttack(): void {
		this.state.attack = this.attackMouse || this.attackLook || this.attackButton;
	}

	private syncUse(): void {
		this.state.use = this.useMouse || this.useButton;
	}

	private syncTouchFlags(): void {
		this.state.sprint = this.sprintToggle || this.sprintStick;
		this.state.sneak = this.sneakToggle;
		this.state.jump = this.jumpButton;
	}

	private onPointerLockChange = (): void => {
		if (this.mode !== 'desktop') return;
		if (!this.active) this.clearHeld();
		this.emitActive();
	};

	private onFullscreenChange = (): void => {
		const f = this.isFullscreen;
		if (f === this.lastFullscreen) return;
		this.lastFullscreen = f;
		for (const fn of this.fullscreenListeners) fn(f);
	};

	private onKey = (ev: KeyboardEvent): void => {
		if (this.mode !== 'desktop' || !this.active) return;
		const code = ev.code;
		if (code === 'Escape' || code === 'F11' || code === 'F12' || ev.metaKey) return;
		ev.preventDefault();
		ev.stopImmediatePropagation();
		const down = ev.type === 'keydown';
		const s = this.state;
		switch (code) {
			case 'KeyW':
			case 'ArrowUp':
				if (down && !ev.repeat) {
					const now = performance.now();
					if (now - this.lastWDown < DOUBLE_TAP_MS) this.sprintKey = true;
					this.lastWDown = now;
				}
				if (!down) this.sprintKey = false;
				s.forward = down;
				s.sprint = this.sprintKey;
				break;
			case 'KeyS':
			case 'ArrowDown':
				s.back = down;
				break;
			case 'KeyA':
			case 'ArrowLeft':
				s.left = down;
				break;
			case 'KeyD':
			case 'ArrowRight':
				s.right = down;
				break;
			case 'Space':
				s.jump = down;
				break;
			case 'ShiftLeft':
			case 'ShiftRight':
				s.sneak = down;
				break;
			case 'KeyE':
				if (down && !ev.repeat) s.togglePressed = true;
				break;
			case 'KeyF':
				if (down && !ev.repeat) s.fullscreenPressed = true;
				break;
			case 'KeyQ':
				if (down && !ev.repeat) s.dropPressed = true;
				break;
			default: {
				if (down && /^Digit[1-9]$/.test(code)) {
					s.hotbarSelect = Number(code.slice(5)) - 1;
				}
			}
		}
	};

	private onMouseMove = (ev: MouseEvent): void => {
		if (this.mode !== 'desktop' || !this.active) return;
		this.state.lookDX -= ev.movementX * MOUSE_SENS;
		this.state.lookDY -= ev.movementY * MOUSE_SENS;
	};

	private onMouseDown = (ev: MouseEvent): void => {
		if (this.mode !== 'desktop') return;
		if (!this.active) {
			if (ev.button === 0) this.start();
			return;
		}
		if (ev.button === 0) {
			this.attackMouse = true;
			this.syncAttack();
		} else if (ev.button === 2) {
			this.state.usePressed = true;
			this.useMouse = true;
			this.syncUse();
		}
		ev.preventDefault();
	};

	private onMouseUp = (ev: MouseEvent): void => {
		if (ev.button === 0 && this.attackMouse) {
			this.attackMouse = false;
			this.syncAttack();
		}
		if (ev.button === 2 && this.useMouse) {
			this.useMouse = false;
			this.syncUse();
		}
	};

	private onWheel = (ev: WheelEvent): void => {
		if (this.mode !== 'desktop' || !this.active) return;
		ev.preventDefault();
		this.state.hotbarDelta += Math.sign(ev.deltaY);
	};

	// ---- タッチ ----

	private sneakEl: HTMLElement | null = null;
	private sprintEl: HTMLElement | null = null;

	public bindTouchControls(els: TouchElements): void {
		this.touchAbort?.abort();
		const ac = new AbortController();
		this.touchAbort = ac;
		const sig = ac.signal;
		this.sneakEl = els.sneak;
		this.sprintEl = els.sprint;
		els.sneak.classList.toggle('active', this.sneakToggle);
		els.sprint.classList.toggle('active', this.sprintToggle);

		for (const el of Object.values(els)) el.style.touchAction = 'none';
		const s = this.state;

		// ジョイスティック
		{
			const el = els.joystick;
			let pid: number | null = null;
			let ox = 0;
			let oy = 0;
			const knob = el.querySelector<HTMLElement>('.knob');
			const reset = (): void => {
				pid = null;
				s.forward = s.back = s.left = s.right = false;
				this.sprintStick = false;
				this.syncTouchFlags();
				if (knob) knob.style.transform = '';
			};
			const update = (ev: PointerEvent): void => {
				let dx = ev.clientX - ox;
				let dy = ev.clientY - oy;
				const len = Math.hypot(dx, dy);
				if (len > STICK_RADIUS) {
					dx = dx / len * STICK_RADIUS;
					dy = dy / len * STICK_RADIUS;
				}
				if (knob) knob.style.transform = `translate(${dx}px, ${dy}px)`;
				const nx = dx / STICK_RADIUS;
				const ny = dy / STICK_RADIUS;
				s.forward = ny < -STICK_DEAD;
				s.back = ny > STICK_DEAD;
				s.left = nx < -STICK_DEAD;
				s.right = nx > STICK_DEAD;
				this.sprintStick = ny < -STICK_SPRINT;
				this.syncTouchFlags();
			};
			el.addEventListener('pointerdown', (ev) => {
				if (this.mode !== 'touch' || pid != null) return;
				pid = ev.pointerId;
				ox = ev.clientX;
				oy = ev.clientY;
				try { el.setPointerCapture(ev.pointerId); } catch { /* ignore */ }
				ev.preventDefault();
			}, { signal: sig });
			el.addEventListener('pointermove', (ev) => {
				if (ev.pointerId !== pid) return;
				update(ev);
				ev.preventDefault();
			}, { signal: sig });
			const end = (ev: PointerEvent): void => {
				if (ev.pointerId === pid) reset();
			};
			el.addEventListener('pointerup', end, { signal: sig });
			el.addEventListener('pointercancel', end, { signal: sig });
			el.addEventListener('lostpointercapture', end, { signal: sig });
		}

		// 視点操作
		{
			const el = els.look;
			let pid: number | null = null;
			let lx = 0;
			let ly = 0;
			let sx = 0;
			let sy = 0;
			let t0 = 0;
			let moved = false;
			let timer: number | null = null;
			const clearTimer = (): void => {
				if (timer != null) {
					window.clearTimeout(timer);
					timer = null;
				}
			};
			const finish = (tap: boolean): void => {
				clearTimer();
				pid = null;
				if (this.attackLook) {
					this.attackLook = false;
					this.syncAttack();
				} else if (tap && !moved && performance.now() - t0 < TAP_MAX_MS) {
					s.usePressed = true;
				}
			};
			el.addEventListener('pointerdown', (ev) => {
				if (this.mode !== 'touch' || pid != null) return;
				pid = ev.pointerId;
				lx = sx = ev.clientX;
				ly = sy = ev.clientY;
				t0 = performance.now();
				moved = false;
				try { el.setPointerCapture(ev.pointerId); } catch { /* ignore */ }
				timer = window.setTimeout(() => {
					timer = null;
					if (pid != null && !moved) {
						this.attackLook = true;
						this.syncAttack();
					}
				}, LONG_PRESS_MS);
				ev.preventDefault();
			}, { signal: sig });
			el.addEventListener('pointermove', (ev) => {
				if (ev.pointerId !== pid) return;
				if (this.touchActive) {
					s.lookDX -= (ev.clientX - lx) * TOUCH_SENS;
					s.lookDY -= (ev.clientY - ly) * TOUCH_SENS;
				}
				lx = ev.clientX;
				ly = ev.clientY;
				if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) >= MOVE_SLOP) {
					moved = true;
					clearTimer();
					if (this.attackLook) {
						this.attackLook = false;
						this.syncAttack();
					}
				}
				ev.preventDefault();
			}, { signal: sig });
			el.addEventListener('pointerup', (ev) => {
				if (ev.pointerId === pid) finish(true);
			}, { signal: sig });
			const cancel = (ev: PointerEvent): void => {
				if (ev.pointerId === pid) finish(false);
			};
			el.addEventListener('pointercancel', cancel, { signal: sig });
			el.addEventListener('lostpointercapture', cancel, { signal: sig });
		}

		// 保持するボタン (jump / attack)
		const holdButton = (el: HTMLElement, set: (v: boolean) => void): void => {
			let pid: number | null = null;
			el.addEventListener('pointerdown', (ev) => {
				if (this.mode !== 'touch' || pid != null) return;
				pid = ev.pointerId;
				try { el.setPointerCapture(ev.pointerId); } catch { /* ignore */ }
				set(true);
				ev.preventDefault();
			}, { signal: sig });
			const end = (ev: PointerEvent): void => {
				if (ev.pointerId !== pid) return;
				pid = null;
				set(false);
			};
			el.addEventListener('pointerup', end, { signal: sig });
			el.addEventListener('pointercancel', end, { signal: sig });
			el.addEventListener('lostpointercapture', end, { signal: sig });
		};
		holdButton(els.jump, (v) => {
			this.jumpButton = v;
			this.syncTouchFlags();
		});
		holdButton(els.attack, (v) => {
			this.attackButton = v;
			this.syncAttack();
		});

		// エッジ / トグルのボタン
		holdButton(els.use, (v) => {
			if (v) s.usePressed = true;
			this.useButton = v;
			this.syncUse();
		});
		els.sneak.addEventListener('pointerdown', (ev) => {
			if (this.mode !== 'touch') return;
			this.sneakToggle = !this.sneakToggle;
			els.sneak.classList.toggle('active', this.sneakToggle);
			this.syncTouchFlags();
			ev.preventDefault();
		}, { signal: sig });
		els.sprint.addEventListener('pointerdown', (ev) => {
			if (this.mode !== 'touch') return;
			this.sprintToggle = !this.sprintToggle;
			els.sprint.classList.toggle('active', this.sprintToggle);
			this.syncTouchFlags();
			ev.preventDefault();
		}, { signal: sig });
	}
}
