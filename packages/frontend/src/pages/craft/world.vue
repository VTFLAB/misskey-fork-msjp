<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader :actions="headerActions">
	<div class="_spacer" style="--MI_SPACER-w: 1200px; --MI_SPACER-min: 8px; --MI_SPACER-max: 16px;">
		<div v-if="world" class="_gaps_s">
			<div ref="stageEl" :class="[$style.stage, touchMode && $style.stageTouch]">
				<canvas ref="canvasEl" :class="$style.canvas"></canvas>

				<div v-if="webglError" :class="$style.overlay">
					<div :class="$style.overlayBox">{{ i18n.ts._craft.webglRequired }}</div>
				</div>
				<button v-else-if="!active && !uiOpen && !dead && !menuOpen" type="button" class="_button" :class="$style.overlay" @click="resume">
					<div :class="$style.overlayBox">
						<div :class="$style.overlayTitle"><i class="ti ti-pointer"></i> {{ touchMode ? i18n.ts._craft.tapToPlay : i18n.ts._craft.clickToPlay }}</div>
						<div :class="$style.overlayControls">{{ touchMode ? i18n.ts._craft.touchControls : i18n.ts._craft.controls }}</div>
						<div v-if="!canBuild" :class="$style.overlayNote"><i class="ti ti-eye"></i> {{ $i ? i18n.ts._craft.spectating : i18n.ts._craft.loginToBuild }}</div>
					</div>
				</button>
				<div v-else-if="menuOpen && !dead" :class="$style.overlay">
					<div :class="[$style.overlayBox, $style.menuBox]">
						<template v-if="menuView === 'main'">
							<div :class="$style.overlayTitle">{{ i18n.ts._craft.pauseMenu }}</div>
							<div :class="$style.menuList">
								<MkButton primary rounded full @click="resume"><i class="ti ti-player-play"></i> {{ i18n.ts._craft.resume }}</MkButton>
								<MkButton v-if="$i" rounded full @click="openUi('inventory')"><i class="ti ti-backpack"></i> {{ i18n.ts._craft.inventory }}</MkButton>
								<MkButton rounded full @click="menuView = 'settings'"><i class="ti ti-settings"></i> {{ i18n.ts._craft.settings }}</MkButton>
								<MkButton rounded full @click="toggleFullscreen"><i :class="fullscreen ? 'ti ti-arrows-minimize' : 'ti ti-arrows-maximize'"></i> {{ fullscreen ? i18n.ts._craft.exitFullscreen : i18n.ts._craft.fullscreen }}</MkButton>
								<MkButton rounded full @click="toggleInputMode"><i :class="touchMode ? 'ti ti-keyboard' : 'ti ti-device-mobile'"></i> {{ touchMode ? i18n.ts._craft.desktopMode : i18n.ts._craft.touchMode }}</MkButton>
								<MkButton v-if="canManage" rounded full @click="editWorld"><i class="ti ti-adjustments"></i> {{ i18n.ts._craft.editWorld }}</MkButton>
								<MkButton rounded full @click="router.push('/craft')"><i class="ti ti-arrow-left"></i> {{ i18n.ts._craft.backToWorlds }}</MkButton>
							</div>
							<div v-if="!touchMode" :class="$style.overlayControls">{{ i18n.ts._craft.pauseHint }}</div>
						</template>
						<template v-else>
							<div :class="$style.overlayTitle">{{ i18n.ts._craft.settings }}</div>
							<div :class="$style.settingsList">
								<MkSwitch v-model="settings.sound">{{ i18n.ts._craft.sound }}</MkSwitch>
								<MkRange v-model="settings.soundVolume" :min="0" :max="1" :step="0.05" :textConverter="(v) => `${Math.round(v * 100)}%`">
									<template #label>{{ i18n.ts._craft.soundVolume }}</template>
								</MkRange>
								<MkRange v-model="settings.renderDistance" :min="4" :max="12" :step="1">
									<template #label>{{ i18n.ts._craft.renderDistance }}</template>
								</MkRange>
								<MkSwitch v-model="settings.viewBobbing">{{ i18n.ts._craft.viewBobbing }}</MkSwitch>
								<MkSwitch v-model="showMinimap">{{ i18n.ts._craft.showMinimap }}</MkSwitch>
								<MkButton rounded full @click="menuView = 'main'"><i class="ti ti-arrow-left"></i> {{ i18n.ts.goBack }}</MkButton>
							</div>
						</template>
					</div>
				</div>

				<div v-if="active && !uiOpen" :class="$style.crosshair"></div>
				<div v-if="breakProgress > 0 || useProgress > 0" :class="$style.breakBar"><div :class="$style.breakBarFill" :style="{ width: `${Math.round(Math.max(breakProgress, useProgress) * 100)}%` }"></div></div>

				<div
					v-for="label in playerLabels"
					:key="label.userId"
					:class="$style.playerLabel"
					:style="{ left: `${label.x}px`, top: `${label.y}px`, opacity: label.dist > 48 ? 0.4 : 1 }"
				>
					<img v-if="label.avatarUrl" :class="$style.playerLabelAvatar" :src="label.avatarUrl" alt=""/>
					<span>{{ label.name ?? label.username }}</span>
				</div>

				<div :class="$style.hud">
					<div :class="$style.hudItem"><i class="ti ti-users"></i> {{ i18n.tsx._craft.playersCount({ n: playerCount + 1 }) }}</div>
					<div :class="$style.hudItem"><i :class="night ? 'ti ti-moon' : 'ti ti-sun'"></i> {{ night ? i18n.ts._craft.night : i18n.ts._craft.day }}</div>
					<div v-if="isHost" :class="$style.hudItem" :title="i18n.ts._craft.hostingMobs"><i class="ti ti-cpu"></i></div>
					<div v-if="!canBuild" :class="$style.hudItem"><i class="ti ti-eye"></i></div>
					<div v-if="enemyNear" :class="[$style.hudItem, $style.hudDanger]"><i class="ti ti-alert-triangle"></i> {{ i18n.ts._craft.nearbyEnemy }}</div>
					<div :class="$style.hudItem" style="font-variant-numeric: tabular-nums;">{{ positionText }}</div>
				</div>

				<div :class="$style.toasts">
					<TransitionGroup :enterFromClass="$style.toastEnterFrom" :leaveToClass="$style.toastLeaveTo" :enterActiveClass="$style.toastActive" :leaveActiveClass="$style.toastActive">
						<div v-for="t in toasts" :key="t.id" :class="[$style.toast, t.kind === 'levelUp' && $style.toastLevelUp]">
							<img v-if="t.icon" :class="$style.toastIcon" :src="t.icon" alt=""/>
							<span>{{ t.text }}</span>
						</div>
					</TransitionGroup>
				</div>

				<div :class="$style.hudRight">
					<canvas v-show="showMinimap" ref="minimapEl" :class="$style.minimap" role="img" :aria-label="i18n.ts._craft.minimap" :title="i18n.ts._craft.minimap"></canvas>
					<button v-if="!menuOpen && !dead" type="button" class="_button" :class="$style.hudButton" :title="i18n.ts._craft.pauseMenu" :aria-label="i18n.ts._craft.pauseMenu" @click="openMenu"><i class="ti ti-menu-2"></i></button>
				</div>

				<div v-if="$i" :class="$style.bottom">
					<div :class="$style.statusRows">
						<div v-if="stats.armor > 0" :class="$style.iconRow" :title="i18n.ts._craft.armor">
							<i v-for="i in 10" :key="i" class="ti ti-shield-filled" :class="$style.statIcon" :style="iconStyle(stats.armor, i, '#c8d2dc')"></i>
						</div>
						<div :class="$style.rowPair">
							<div :class="[$style.iconRow, stats.health <= 4 && $style.iconRowBlink]" :title="i18n.ts._craft.health">
								<i v-for="i in 10" :key="i" class="ti ti-heart-filled" :class="$style.statIcon" :style="iconStyle(stats.health, i, '#e8453c')"></i>
							</div>
							<div :class="[$style.iconRow, $style.iconRowRight]" :title="i18n.ts._craft.hunger">
								<i v-for="i in 10" :key="i" class="ti ti-meat" :class="$style.statIcon" :style="iconStyle(stats.hunger, 11 - i, '#e3a02a')"></i>
							</div>
						</div>
						<div v-if="stats.air < PLAYER.maxAir" :class="[$style.iconRow, $style.iconRowRight]" :title="i18n.ts._craft.air">
							<i v-for="i in 10" :key="i" class="ti ti-droplet-filled" :class="$style.statIcon" :style="iconStyle(stats.air / PLAYER.maxAir * 20, 11 - i, '#4aa3e8')"></i>
						</div>
						<div :class="$style.xpRow" :title="i18n.ts._craft.xp">
							<div :class="$style.xpBar"><div :class="$style.xpFill" :style="{ width: `${Math.round(stats.xpProgress * 100)}%` }"></div></div>
							<span v-if="stats.level > 0" :class="$style.xpLevel">{{ stats.level }}</span>
						</div>
					</div>
					<div :class="$style.hotbar">
						<XSlot
							v-for="(stack, index) in hotbar"
							:key="index"
							:stack="stack"
							:version="inventoryVersion"
							:active="index === hotbarIndex"
							:keyLabel="String(index + 1)"
							@click="engine?.selectHotbar(index)"
						/>
					</div>
					<div v-if="selectedName" :class="$style.selectedName" :style="{ color: selectedColor }">{{ selectedName }}</div>
				</div>

				<div v-if="touchMode && active && !uiOpen" :class="$style.touch">
					<div ref="touchLookEl" :class="$style.touchLook"></div>
					<div ref="touchJoystickEl" :class="$style.joystick"><div class="knob" :class="$style.joystickKnob"></div></div>
					<div :class="$style.touchButtons">
						<button ref="touchSneakEl" type="button" :class="$style.touchButton" :aria-label="i18n.ts._craft._touch.sneak" :title="i18n.ts._craft._touch.sneak"><i class="ti ti-arrow-down"></i></button>
						<button ref="touchSprintEl" type="button" :class="$style.touchButton" :aria-label="i18n.ts._craft._touch.sprint" :title="i18n.ts._craft._touch.sprint"><i class="ti ti-run"></i></button>
						<button ref="touchUseEl" type="button" :class="[$style.touchButton, $style.touchButtonLarge]" :aria-label="i18n.ts._craft._touch.use" :title="i18n.ts._craft._touch.use"><i class="ti ti-cube-plus"></i></button>
						<button ref="touchAttackEl" type="button" :class="[$style.touchButton, $style.touchButtonLarge]" :aria-label="i18n.ts._craft._touch.attack" :title="i18n.ts._craft._touch.attack"><i class="ti ti-pick"></i></button>
						<button ref="touchJumpEl" type="button" :class="[$style.touchButton, $style.touchButtonLarge]" :aria-label="i18n.ts._craft._touch.jump" :title="i18n.ts._craft._touch.jump"><i class="ti ti-arrow-big-up"></i></button>
					</div>
				</div>

				<div v-if="uiOpen && engine" :class="$style.panelOverlay">
					<div :class="$style.panel">
						<div :class="$style.panelHeader">
							<button
								v-for="tab in panelTabs"
								:key="tab.key"
								type="button"
								class="_button"
								:class="[$style.panelTab, panelTab === tab.key && $style.panelTabActive]"
								:aria-pressed="panelTab === tab.key"
								@click="panelTab = tab.key"
							><i :class="tab.icon"></i> {{ tab.label }}</button>
							<button type="button" class="_button" :class="$style.panelClose" :aria-label="i18n.ts.close" :title="`${i18n.ts.close} (${i18n.ts._craft.closeWithEsc})`" @click="closeUi"><i class="ti ti-x"></i></button>
						</div>
						<XInventoryPanel v-if="panelTab === 'inventory'" :engine="engine" :version="inventoryVersion"/>
						<XCraftingPanel v-else-if="panelTab === 'crafting' || panelTab === 'furnace'" :engine="engine" :version="inventoryVersion" :mode="panelTab"/>
						<XEnchantPanel v-else :engine="engine" :version="inventoryVersion" @changed="inventoryVersion++"/>
					</div>
				</div>

				<div v-if="sleep.sleeping && !dead" :class="[$style.overlay, $style.sleepOverlay]">
					<div :class="$style.overlayBox">
						<div :class="$style.overlayTitle"><i class="ti ti-zzz"></i> {{ i18n.ts._craft.sleeping }}</div>
						<div :class="$style.overlayControls">{{ i18n.tsx._craft.sleepingCount({ count: sleep.count, total: sleep.total, required: sleep.required }) }}</div>
						<div :class="$style.overlayControls">{{ i18n.ts._craft.wakeHint }}</div>
						<MkButton rounded style="margin: 12px auto 0;" @click="wakeUp">{{ i18n.ts._craft.wakeUp }}</MkButton>
					</div>
				</div>

				<div v-if="dead" :class="$style.overlay">
					<div :class="$style.overlayBox">
						<div :class="$style.overlayTitle" style="color: #ff7b7b;">{{ i18n.ts._craft.youDied }}</div>
						<div :class="$style.overlayControls">{{ i18n.ts._craft.deathNoteXp }}</div>
						<MkButton primary rounded style="margin: 12px auto 0;" @click="respawn">{{ i18n.ts._craft.respawn }}</MkButton>
					</div>
				</div>
			</div>

			<div :class="$style.info">
				<MkAvatar :class="$style.infoAvatar" :user="world.user"/>
				<div>
					<div><b>{{ world.name }}</b> <span v-if="!world.isPublic" :title="i18n.ts._craft.ownerOnly"><i class="ti ti-lock"></i></span></div>
					<div style="font-size: 0.85em; opacity: 0.7;"><MkUserName :user="world.user"/> · {{ i18n.tsx._craft.blocksCount({ n: world.blockCount }) }} · {{ i18n.ts._craft.seed }}: {{ world.seed }}<template v-if="$i"> · <i class="ti ti-cloud-check"></i> {{ i18n.ts._craft.savedToServer }}</template></div>
				</div>
			</div>
		</div>
		<MkLoading v-else/>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, onMounted, onUnmounted, reactive, ref, shallowRef, useTemplateRef, watch, nextTick } from 'vue';
import * as Misskey from 'misskey-js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { definePage } from '@/page.js';
import { useStream } from '@/stream.js';
import { i18n } from '@/i18n.js';
import { $i } from '@/i.js';
import { useRouter } from '@/router.js';
import * as os from '@/os.js';
import MkButton from '@/components/MkButton.vue';
import MkSwitch from '@/components/MkSwitch.vue';
import MkRange from '@/components/MkRange.vue';
import { CraftEngine } from '@/utility/craft/engine.js';
import type { EngineState, EngineToast, PanelKind } from '@/utility/craft/engine.js';
import { PLAYER, WORLD, isNight, setWorldTimeOffset } from '@/utility/craft/constants.js';
import type { ItemStack, MobSnapshot, PlayerStats } from '@/utility/craft/types.js';
import { itemIcon } from '@/utility/craft/icons.js';
import XSlot from './craft.item-slot.vue';
import XInventoryPanel from './craft.inventory-panel.vue';
import XCraftingPanel from './craft.crafting-panel.vue';
import XEnchantPanel from './craft.enchant-panel.vue';
import { itemName, mobName, rarityColor, stackRarity } from './names.js';

const props = defineProps<{
	worldId: string;
}>();

const router = useRouter();

type PanelTab = 'inventory' | PanelKind;

const world = ref<Misskey.entities.CraftWorld | null>(null);
const stageEl = useTemplateRef('stageEl');
const canvasEl = useTemplateRef('canvasEl');
const minimapEl = useTemplateRef('minimapEl');
const touchJoystickEl = useTemplateRef('touchJoystickEl');
const touchLookEl = useTemplateRef('touchLookEl');
const touchJumpEl = useTemplateRef('touchJumpEl');
const touchAttackEl = useTemplateRef('touchAttackEl');
const touchUseEl = useTemplateRef('touchUseEl');
const touchSneakEl = useTemplateRef('touchSneakEl');
const touchSprintEl = useTemplateRef('touchSprintEl');
const engine = shallowRef<CraftEngine | null>(null);
const connection = shallowRef<Misskey.IChannelConnection<Misskey.Channels['craftWorld']> | null>(null);

const active = ref(false);
const uiOpen = ref(false);
const menuOpen = ref(false);
const menuView = ref<'main' | 'settings'>('main');
const showMinimap = ref(true);
let started = false;
const dead = ref(false);
const panelTab = ref<PanelTab>('inventory');
const fullscreen = ref(false);
const touchMode = ref(false);
const isHost = ref(false);
const night = ref(isNight());
const enemyNear = ref(false);
const hotbarIndex = ref(0);
const playerCount = ref(0);
const positionText = ref('');
const breakProgress = ref(0);
const useProgress = ref(0);
const webglError = ref(false);
const stats = ref<PlayerStats>({ health: PLAYER.maxHealth, hunger: PLAYER.maxHunger, saturation: 5, air: PLAYER.maxAir, armor: 0, level: 0, xpProgress: 0, totalXp: 0 });
const inventoryVersion = ref(0);
const playerLabels = ref<{ userId: string; username: string; name: string | null; avatarUrl: string | null; x: number; y: number; dist: number }[]>([]);
const toasts = ref<{ id: number; kind: EngineToast['kind']; text: string; icon: string | null }[]>([]);
const sleep = ref({ sleeping: false, count: 0, total: 1, required: 1 });
let toastSeq = 0;
const toastTimers = new Set<number>();
let hudTimer: number | null = null;
let saveTimer: number | null = null;
let starting = false;
let lastSavedJson = '';

const SETTINGS_KEY = 'craft:settings';
const settings = reactive(loadSettings());

const panelTabs = computed<{ key: PanelTab; label: string; icon: string }[]>(() => [
	{ key: 'inventory', label: i18n.ts._craft.inventory, icon: 'ti ti-backpack' },
	{ key: 'crafting', label: i18n.ts._craft.crafting, icon: 'ti ti-tool' },
	{ key: 'furnace', label: i18n.ts._craft.furnace, icon: 'ti ti-flame' },
	{ key: 'enchanting', label: i18n.ts._craft.enchanting, icon: 'ti ti-wand' },
]);

const canBuild = computed(() => {
	if (world.value == null || $i == null) return false;
	return world.value.isPublic || world.value.userId === $i.id;
});

const canManage = computed(() => {
	if (world.value == null || $i == null) return false;
	return world.value.userId === $i.id || $i.isModerator || $i.isAdmin;
});

const hotbar = computed<ItemStack[]>(() => {
	void inventoryVersion.value;
	return engine.value ? engine.value.player.inventory.slots.slice(0, PLAYER.hotbarSize) : new Array<ItemStack>(PLAYER.hotbarSize).fill(null);
});

const selectedStack = computed(() => hotbar.value[hotbarIndex.value] ?? null);
const selectedName = computed(() => selectedStack.value ? itemName(selectedStack.value.id) : null);
const selectedColor = computed(() => {
	const r = stackRarity(selectedStack.value);
	return r === 'common' ? '#fff' : rarityColor(r);
});

/** 10 個のアイコンで 0..20 の値を表す。i 番目 (1..10) の塗り方 */
function iconStyle(value: number, i: number, color: string): Record<string, string> {
	const full = value >= i * 2;
	const half = !full && value >= i * 2 - 1;
	return {
		color,
		opacity: full ? '1' : half ? '0.55' : '0.18',
	};
}

function loadSettings(): { sound: boolean; soundVolume: number; renderDistance: number; viewBobbing: boolean } {
	const defaults = { sound: true, soundVolume: 0.6, renderDistance: WORLD.renderDistance as number, viewBobbing: true };
	try {
		const raw = window.localStorage.getItem(SETTINGS_KEY);
		if (raw == null) return defaults;
		const parsed = JSON.parse(raw) as Partial<typeof defaults>;
		return { ...defaults, ...parsed };
	} catch {
		return defaults;
	}
}

function applySettings() {
	try {
		window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
	} catch {
		// ignore
	}
	engine.value?.updateSettings({
		soundVolume: settings.soundVolume,
		muted: !settings.sound,
		renderDistance: settings.renderDistance,
		viewBobbing: settings.viewBobbing,
	});
}

function stateKey(): string {
	return `craft:state:${props.worldId}:${$i?.id ?? 'guest'}`;
}

function loadLocalState(): { state: EngineState; savedAt: number } | null {
	try {
		const raw = window.localStorage.getItem(stateKey());
		if (raw == null) return null;
		const parsed = JSON.parse(raw) as { state?: EngineState; savedAt?: number } & Partial<EngineState>;
		// 旧形式 (state を直接保存) にも対応する
		const state = parsed.state ?? (parsed as EngineState);
		if (typeof state !== 'object' || typeof state.pos?.x !== 'number') return null;
		return { state, savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : 0 };
	} catch {
		return null;
	}
}

async function loadState(): Promise<EngineState | null> {
	const local = loadLocalState();
	if ($i == null) return local?.state ?? null;
	try {
		const res = await misskeyApi('craft/state', { worldId: props.worldId });
		if (res.state != null && typeof (res.state as unknown as EngineState).pos?.x === 'number') {
			const serverAt = res.updatedAt ? new Date(res.updatedAt).getTime() : 0;
			if (local == null || serverAt >= local.savedAt) return res.state as unknown as EngineState;
		}
	} catch (err) {
		console.error(err);
	}
	return local?.state ?? null;
}

function saveState(force = false) {
	if (engine.value == null || $i == null) return;
	// 死んでいる間も保存する (レベルは死んだ時点で失っているので、リロードで逃れられない)
	const state = engine.value.exportState();
	const json = JSON.stringify(state);
	if (!force && json === lastSavedJson) return;
	const savedAt = Date.now();
	try {
		window.localStorage.setItem(stateKey(), JSON.stringify({ state, savedAt }));
	} catch {
		// 容量不足などは無視
	}
	misskeyApi('craft/save-state', { worldId: props.worldId, state: state as unknown as Record<string, unknown> }).then(() => {
		lastSavedJson = json;
	}).catch(err => console.error(err));
}

async function load() {
	world.value = await misskeyApi('craft/show', { worldId: props.worldId });
}

function pushToast(t: EngineToast) {
	let text = '';
	let icon: string | null = null;
	switch (t.kind) {
		case 'pickup':
			text = i18n.tsx._craft.pickedUp({ name: itemName(t.id), n: t.count });
			icon = itemIcon(t.id);
			break;
		case 'kill':
			text = i18n.tsx._craft.killed({ name: mobName(t.mobType), xp: t.xp });
			break;
		case 'levelUp':
			text = i18n.tsx._craft.levelUp({ level: i18n.tsx._craft.levelsCount({ n: t.level }) });
			break;
		case 'spawnSet':
			text = i18n.ts._craft.spawnPointSet;
			break;
		case 'itemBroke':
			text = `${itemName(t.id)} ×`;
			icon = itemIcon(t.id);
			break;
		case 'inventoryFull':
			text = i18n.ts._craft.gachaInventoryFull;
			break;
		case 'cannotSleepNow':
			text = i18n.ts._craft.cannotSleepNow;
			break;
		case 'morning':
			text = i18n.ts._craft.morning;
			break;
	}
	// 同じ拾得は 1 行にまとめる
	const last = toasts.value[toasts.value.length - 1];
	if (t.kind === 'pickup' && last?.kind === 'pickup' && last.icon === icon) {
		toasts.value.pop();
	}
	const id = ++toastSeq;
	toasts.value.push({ id, kind: t.kind, text, icon });
	if (toasts.value.length > 5) toasts.value.shift();
	const timer = window.setTimeout(() => {
		toastTimers.delete(timer);
		toasts.value = toasts.value.filter(x => x.id !== id);
	}, 3000);
	toastTimers.add(timer);
}

async function startEngine() {
	if (starting || engine.value != null || world.value == null || canvasEl.value == null || stageEl.value == null) return;
	starting = true;
	try {
		let e: CraftEngine;
		try {
			e = new CraftEngine(canvasEl.value, stageEl.value, world.value.seed);
		} catch (err) {
			console.error(err);
			webglError.value = true;
			return;
		}
		e.localUserId = $i?.id ?? null;
		e.canBuild = canBuild.value;
		e.worldOwnerId = world.value.userId;
		e.worldIsPublic = world.value.isPublic;
		touchMode.value = e.inputMode === 'touch';

		e.on('activeChange', (v) => {
			active.value = v;
			// 操作をやめた (Esc など) らポーズメニューを出す
			if (!v && started && !uiOpen.value && !dead.value) {
				menuOpen.value = true;
				menuView.value = 'main';
			}
		});
		e.on('fullscreenChange', (v) => { fullscreen.value = v; });
		e.on('hostChange', (v) => { isHost.value = v; });
		e.on('hotbarChange', (v) => { hotbarIndex.value = v; });
		e.on('inventoryChange', () => { inventoryVersion.value++; });
		e.on('statsChange', (s) => { stats.value = s; });
		e.on('playersChange', () => { playerCount.value = e.remotePlayers.size; });
		e.on('toast', pushToast);
		e.on('sleep', (sleeping) => {
			connection.value?.send('sleep', { sleeping });
		});
		e.on('skipNight', () => {
			connection.value?.send('skipNight', {});
		});
		e.on('sleepChange', (st) => { sleep.value = st; });
		setWorldTimeOffset(world.value.timeOffset ?? 0);
		e.on('died', () => {
			dead.value = true;
			uiOpen.value = false;
			e.uiOpen = true;
			e.stopPlaying();
		});
		e.on('toggleInventory', () => {
			if (uiOpen.value) closeUi(); else openUi('inventory');
		});
		e.on('openPanel', (panel) => openUi(panel));
		e.on('setBlock', (x, y, z, type) => {
			connection.value?.send('setBlock', { x, y, z, type });
		});
		e.on('move', (x, y, z, yaw, pitch) => {
			if ($i == null) return;
			connection.value?.send('move', { x, y, z, yaw, pitch });
		});
		e.on('mobs', (snapshot) => {
			connection.value?.send('mobs', { t: snapshot.t, mobs: snapshot.mobs });
		});
		e.on('mobHit', (hit) => {
			connection.value?.send('mobHit', { id: hit.id, damage: hit.damage, kx: hit.kx, kz: hit.kz });
		});

		// 取得中の変更を取りこぼさないよう、先に購読してから差分を取得する
		connect(e);
		let state: EngineState | null = null;
		try {
			[state] = await Promise.all([loadState(), loadBlocks(e)]);
		} catch (err) {
			console.error(err);
			e.dispose();
			os.alert({ type: 'error', text: i18n.ts.somethingHappened });
			return;
		}
		if (unmounted) {
			e.dispose();
			return;
		}

		e.start(state);
		engine.value = e;
		applySettings();
		e.attachMinimap(showMinimap.value ? (minimapEl.value ?? null) : null);
		inventoryVersion.value++;
		hotbarIndex.value = e.player.hotbarIndex;
		stats.value = e.player.exportStats();
		lastSavedJson = JSON.stringify(e.exportState());
		bindTouch();

		hudTimer = window.setInterval(() => {
			const p = e.player;
			positionText.value = `X ${Math.floor(p.pos.x)}  Y ${Math.floor(p.pos.y)}  Z ${Math.floor(p.pos.z)}`;
			playerCount.value = e.remotePlayers.size;
			breakProgress.value = e.breakProgressValue;
			useProgress.value = e.useProgress;
			night.value = isNight();
			const near = e.nearestHostileDistance();
			enemyNear.value = near != null && near < 12;
			playerLabels.value = e.remotePlayerScreenPositions().map(pos => {
				const rp = e.remotePlayers.get(pos.userId)!;
				return { ...pos, username: rp.username, name: rp.name, avatarUrl: rp.avatarUrl };
			});
		}, 100);
		saveTimer = window.setInterval(() => saveState(false), 15000);
	} finally {
		starting = false;
	}
}

let blocksLoaded = false;
let unmounted = false;
let bufferedBlocks: { x: number; y: number; z: number; type: number; userId: string | null }[] = [];

async function loadBlocks(e: CraftEngine): Promise<Map<string, number>> {
	blocksLoaded = false;
	const blocks = await misskeyApi('craft/blocks', { worldId: props.worldId });
	e.world.applyFlat(blocks.blocks);
	const map = new Map<string, number>();
	const flat = blocks.blocks;
	for (let i = 0; i + 3 < flat.length; i += 4) map.set(`${flat[i]},${flat[i + 1]},${flat[i + 2]}`, flat[i + 3]);
	for (const b of bufferedBlocks) {
		e.applyRemoteBlock(b.x, b.y, b.z, b.type, b.userId);
		map.set(`${b.x},${b.y},${b.z}`, b.type);
	}
	bufferedBlocks = [];
	blocksLoaded = true;
	return map;
}

function onReconnected() {
	const e = engine.value;
	if (e == null) return;
	// 切断中に送った編集は届いたか分からないので、取り直した差分と比べて確定・取消する
	e.beginResync();
	loadBlocks(e).then(map => e.finishResync(map)).catch(err => console.error(err));
}

function connect(e: CraftEngine) {
	const stream = useStream();
	const c = stream.useChannel('craftWorld', { worldId: props.worldId });
	c.on('blockUpdated', (payload) => {
		if (!blocksLoaded) {
			bufferedBlocks.push(payload);
			return;
		}
		e.applyRemoteBlock(payload.x, payload.y, payload.z, payload.type, payload.userId);
	});
	c.on('setBlockRejected', (payload) => {
		e.revertLocalEdit(payload.x, payload.y, payload.z);
	});
	c.on('playerMoved', (payload) => {
		if ($i != null && payload.userId === $i.id) return;
		e.applyRemotePlayer(payload);
	});
	c.on('playerLeft', (payload) => {
		e.removeRemotePlayer(payload.userId);
	});
	c.on('mobsUpdated', (payload) => {
		e.applyRemoteMobs({ hostId: payload.hostId, t: payload.t, mobs: payload.mobs as MobSnapshot['mobs'] });
	});
	c.on('mobHit', (payload) => {
		e.applyRemoteMobHit(payload.userId, { id: payload.id, damage: payload.damage, kx: payload.kx, kz: payload.kz });
	});
	c.on('playerSleeping', (payload) => {
		e.applyRemoteSleeping(payload.userId, payload.sleeping);
	});
	c.on('timeOffsetUpdated', (payload) => {
		e.applyTimeOffset(payload.timeOffset);
	});
	c.on('worldUpdated', (payload) => {
		if (world.value == null) return;
		world.value = { ...world.value, name: payload.name, isPublic: payload.isPublic };
		if (engine.value) engine.value.worldIsPublic = payload.isPublic;
	});
	c.on('worldDeleted', () => {
		os.alert({
			type: 'info',
			text: i18n.ts._craft.worldDeleted,
		});
		router.push('/craft');
	});
	stream.on('_connected_', onReconnected);
	connection.value = c;
}

function bindTouch() {
	const e = engine.value;
	if (e == null) return;
	if (touchJoystickEl.value && touchLookEl.value && touchJumpEl.value && touchAttackEl.value && touchUseEl.value && touchSneakEl.value && touchSprintEl.value) {
		e.bindTouchControls({
			joystick: touchJoystickEl.value,
			look: touchLookEl.value,
			jump: touchJumpEl.value,
			attack: touchAttackEl.value,
			use: touchUseEl.value,
			sneak: touchSneakEl.value,
			sprint: touchSprintEl.value,
		});
	}
}

function resume() {
	menuOpen.value = false;
	started = true;
	engine.value?.startPlaying();
}

function openMenu() {
	const e = engine.value;
	if (e == null) return;
	menuOpen.value = true;
	menuView.value = 'main';
	e.stopPlaying();
}

function toggleFullscreen() {
	engine.value?.toggleFullscreen();
}

function toggleInputMode() {
	const e = engine.value;
	if (e == null) return;
	e.setInputMode(e.inputMode === 'touch' ? 'desktop' : 'touch');
	touchMode.value = e.inputMode === 'touch';
}

function openUi(tab: PanelTab) {
	const e = engine.value;
	if (e == null || $i == null) return;
	menuOpen.value = false;
	panelTab.value = tab;
	uiOpen.value = true;
	e.uiOpen = true;
	inventoryVersion.value++;
	e.stopPlaying();
}

function closeUi() {
	const e = engine.value;
	uiOpen.value = false;
	if (e == null) return;
	e.uiOpen = false;
	saveState(false);
	if (!dead.value) e.startPlaying();
}

function wakeUp() {
	engine.value?.setSleeping(false);
}

function respawn() {
	const e = engine.value;
	if (e == null) return;
	dead.value = false;
	menuOpen.value = false;
	e.uiOpen = false;
	e.respawn();
	saveState(true);
	e.startPlaying();
}

async function editWorld() {
	if (world.value == null) return;
	const { canceled, result } = await os.form(i18n.ts._craft.editWorld, {
		name: {
			type: 'string',
			label: i18n.ts._craft.worldName,
			default: world.value.name,
		},
		isPublic: {
			type: 'boolean',
			label: i18n.ts._craft.anyoneCanBuild,
			description: i18n.ts._craft.anyoneCanBuildDescription,
			default: world.value.isPublic,
		},
	});
	if (canceled) return;
	world.value = await os.apiWithDialog('craft/update', {
		worldId: props.worldId,
		name: result.name,
		isPublic: result.isPublic,
	});
}

async function deleteWorld() {
	if (world.value == null) return;
	const { canceled } = await os.confirm({
		type: 'warning',
		text: i18n.tsx._craft.deleteConfirm({ name: world.value.name }),
	});
	if (canceled) return;
	await os.apiWithDialog('craft/delete', { worldId: props.worldId });
	router.push('/craft');
}

function share() {
	if (world.value == null) return;
	os.post({
		initialText: `${i18n.ts._craft.craft}: ${world.value.name}\n${window.location.origin}/craft/w/${props.worldId}`,
	});
}

const headerActions = computed(() => {
	const actions: { icon: string; text: string; handler: () => void }[] = [{
		icon: 'ti ti-share',
		text: i18n.ts.share,
		handler: share,
	}];
	if (canManage.value) {
		actions.push({
			icon: 'ti ti-settings',
			text: i18n.ts._craft.editWorld,
			handler: editWorld,
		});
		actions.push({
			icon: 'ti ti-trash',
			text: i18n.ts.delete,
			handler: deleteWorld,
		});
	}
	return actions;
});

watch(canBuild, (v) => {
	if (engine.value) engine.value.canBuild = v;
});

watch(showMinimap, (v) => {
	engine.value?.attachMinimap(v ? (minimapEl.value ?? null) : null);
});

watch(settings, () => applySettings());

watch(canvasEl, () => {
	if (canvasEl.value != null) startEngine();
});

// タッチ操作の DOM は active のときだけ存在するので、現れるたびに結び直す
watch([active, touchMode, uiOpen], async () => {
	await nextTick();
	bindTouch();
});

function onVisibilityChange() {
	if (window.document.visibilityState === 'hidden') saveState(false);
}

// パネルやメニューを開いているときの Esc はここで閉じる。Misskey のウィンドウ (MkWindow) まで届くと
// ウィンドウごと閉じてしまうので、capture で先に受け取って伝播を止める
function onKeydownCapture(ev: KeyboardEvent) {
	if (ev.key !== 'Escape' || engine.value == null || dead.value) return;
	if (uiOpen.value) {
		ev.preventDefault();
		ev.stopImmediatePropagation();
		closeUi();
	} else if (menuOpen.value) {
		ev.preventDefault();
		ev.stopImmediatePropagation();
		if (menuView.value === 'settings') menuView.value = 'main';
		else resume();
	}
}

onMounted(async () => {
	window.document.addEventListener('visibilitychange', onVisibilityChange);
	window.addEventListener('keydown', onKeydownCapture, { capture: true });
	await load();
});

onUnmounted(() => {
	unmounted = true;
	window.document.removeEventListener('visibilitychange', onVisibilityChange);
	window.removeEventListener('keydown', onKeydownCapture, { capture: true });
	if (hudTimer != null) window.clearInterval(hudTimer);
	if (saveTimer != null) window.clearInterval(saveTimer);
	for (const t of toastTimers) window.clearTimeout(t);
	saveState(false);
	useStream().off('_connected_', onReconnected);
	connection.value?.dispose();
	connection.value = null;
	engine.value?.dispose();
	engine.value = null;
});

definePage(() => ({
	title: world.value ? `${world.value.name} | ${i18n.ts._craft.craft}` : i18n.ts._craft.craft,
	icon: 'ti ti-cube',
}));
</script>

<style lang="scss" module>
// 3D 描画の上に重ねる UI は空の色に合わせるため、テーマ変数ではなく固定色を使う
.stage {
	position: relative;
	width: 100%;
	height: min(75vh, 720px);
	min-height: 360px;
	border-radius: var(--MI-radius);
	overflow: hidden;
	background: #8dbff2;
	user-select: none;

	&:fullscreen {
		width: 100vw;
		height: 100vh;
		border-radius: 0;
	}
}

.stageTouch {
	height: min(80vh, 720px);
}

.canvas {
	display: block;
	width: 100%;
	height: 100%;
	cursor: crosshair;
	touch-action: none;
}

.overlay {
	position: absolute;
	inset: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	width: 100%;
	background: rgba(0, 0, 0, 0.35);
	cursor: pointer;
	z-index: 20;

	&:focus-visible {
		outline: 2px solid var(--MI_THEME-focus);
		outline-offset: -2px;
	}
}

.overlayBox {
	max-width: 520px;
	max-height: 92%;
	overflow: auto;
	padding: 20px 24px;
	border-radius: var(--MI-radius);
	background: rgba(0, 0, 0, 0.6);
	color: #fff;
	text-align: center;
}

.overlayTitle {
	font-size: 1.2em;
	font-weight: bold;
}

.overlayControls {
	margin-top: 10px;
	font-size: 0.85em;
	opacity: 0.85;
	line-height: 1.6;
}

.overlayNote {
	margin-top: 10px;
	font-size: 0.9em;
	color: #ffd37a;
}

.menuBox {
	width: min(92%, 360px);
}

.sleepOverlay {
	background: rgba(0, 0, 10, 0.75);
	cursor: default;
}

.menuList {
	display: flex;
	flex-direction: column;
	gap: 8px;
	margin-top: 14px;
}

.settingsList {
	display: flex;
	flex-direction: column;
	gap: 14px;
	margin-top: 14px;
	text-align: left;
}

.crosshair {
	position: absolute;
	left: 50%;
	top: 50%;
	width: 18px;
	height: 18px;
	margin: -9px 0 0 -9px;
	pointer-events: none;
	mix-blend-mode: difference;

	&::before, &::after {
		content: '';
		position: absolute;
		background: #fff;
	}

	&::before {
		left: 8px;
		top: 0;
		width: 2px;
		height: 18px;
	}

	&::after {
		left: 0;
		top: 8px;
		width: 18px;
		height: 2px;
	}
}

.breakBar {
	position: absolute;
	left: 50%;
	top: calc(50% + 16px);
	width: 60px;
	height: 5px;
	margin-left: -30px;
	border-radius: 3px;
	background: rgba(0, 0, 0, 0.5);
	pointer-events: none;
}

.breakBarFill {
	height: 100%;
	border-radius: 3px;
	background: #fff;
}

.playerLabel {
	position: absolute;
	transform: translate(-50%, -100%);
	display: flex;
	align-items: center;
	gap: 4px;
	padding: 2px 8px;
	border-radius: 999px;
	background: rgba(0, 0, 0, 0.55);
	color: #fff;
	font-size: 0.8em;
	white-space: nowrap;
	pointer-events: none;
}

.playerLabelAvatar {
	width: 16px;
	height: 16px;
	border-radius: 50%;
}

.hud {
	position: absolute;
	left: 8px;
	top: 8px;
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
	max-width: calc(100% - 160px);
	pointer-events: none;
}

.hudItem {
	padding: 4px 10px;
	border-radius: 999px;
	background: rgba(0, 0, 0, 0.5);
	color: #fff;
	font-size: 0.8em;
}

.hudDanger {
	background: rgba(200, 40, 40, 0.75);
}

.toasts {
	position: absolute;
	left: 8px;
	top: 48px;
	display: flex;
	flex-direction: column;
	gap: 4px;
	pointer-events: none;
	z-index: 6;
}

.toast {
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 3px 10px;
	border-radius: 999px;
	background: rgba(0, 0, 0, 0.5);
	color: #fff;
	font-size: 0.8em;
}

.toastLevelUp {
	background: rgba(120, 80, 200, 0.8);
	font-weight: bold;
}

.toastIcon {
	width: 18px;
	height: 18px;
	image-rendering: pixelated;
}

.toastActive {
	transition: opacity 0.3s, transform 0.3s;
}

.toastEnterFrom {
	opacity: 0;
	transform: translateX(-12px);
}

.toastLeaveTo {
	opacity: 0;
}

.hudRight {
	position: absolute;
	right: 8px;
	top: 8px;
	display: flex;
	flex-direction: column;
	align-items: flex-end;
	gap: 6px;
	z-index: 25;
}

.minimap {
	width: 128px;
	height: 128px;
	border-radius: 50%;
}

.hudButton {
	width: 34px;
	height: 34px;
	border-radius: 8px;
	background: rgba(0, 0, 0, 0.5);
	color: #fff;
	font-size: 16px;
	pointer-events: auto;

	&:hover {
		background: rgba(0, 0, 0, 0.7);
	}
}

.bottom {
	position: absolute;
	left: 50%;
	bottom: 8px;
	transform: translateX(-50%);
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 4px;
	pointer-events: none;
	z-index: 5;
}

.statusRows {
	display: flex;
	flex-direction: column;
	gap: 2px;
	width: 100%;
	padding: 4px 6px;
	border-radius: 8px;
	background: rgba(0, 0, 0, 0.35);
}

.rowPair {
	display: flex;
	justify-content: space-between;
	gap: 12px;
}

.iconRow {
	display: flex;
	gap: 1px;
	font-size: 14px;
	line-height: 1;
	filter: drop-shadow(0 0 1px #000);
}

.iconRowRight {
	margin-left: auto;
}

.iconRowBlink {
	animation: craft-blink 0.6s steps(2) infinite;
}

@keyframes craft-blink {
	from { opacity: 1; }
	to { opacity: 0.5; }
}

.statIcon {
	transition: opacity 0.15s;
}

.xpRow {
	position: relative;
	display: flex;
	align-items: center;
	height: 10px;
	margin-top: 2px;
}

.xpBar {
	width: 100%;
	height: 5px;
	border-radius: 3px;
	background: rgba(255, 255, 255, 0.2);
	overflow: hidden;
}

.xpFill {
	height: 100%;
	background: #7ed957;
	transition: width 0.2s;
}

.xpLevel {
	position: absolute;
	left: 50%;
	top: 50%;
	transform: translate(-50%, -55%);
	font-size: 11px;
	font-weight: bold;
	color: #7ed957;
	text-shadow: 0 0 2px #000, 0 0 2px #000;
}

.hotbar {
	display: flex;
	gap: 4px;
	padding: 4px;
	border-radius: 8px;
	background: rgba(0, 0, 0, 0.45);
	pointer-events: auto;
}

.selectedName {
	padding: 2px 10px;
	border-radius: 999px;
	background: rgba(0, 0, 0, 0.45);
	color: #fff;
	font-size: 0.8em;
}

.touch {
	position: absolute;
	inset: 0;
	pointer-events: none;
	z-index: 4;
}

.touchLook {
	position: absolute;
	right: 0;
	top: 0;
	width: 55%;
	height: 100%;
	pointer-events: auto;
	touch-action: none;
}

.joystick {
	position: absolute;
	left: 24px;
	bottom: 130px;
	width: 120px;
	height: 120px;
	border-radius: 50%;
	background: rgba(255, 255, 255, 0.15);
	border: 2px solid rgba(255, 255, 255, 0.4);
	pointer-events: auto;
	touch-action: none;
}

.joystickKnob {
	position: absolute;
	left: 50%;
	top: 50%;
	width: 50px;
	height: 50px;
	margin: -25px 0 0 -25px;
	border-radius: 50%;
	background: rgba(255, 255, 255, 0.6);
	pointer-events: none;
}

.touchButtons {
	position: absolute;
	right: 16px;
	bottom: 130px;
	display: grid;
	grid-template-columns: repeat(3, 56px);
	gap: 8px;
	pointer-events: auto;
}

.touchButton {
	width: 56px;
	height: 56px;
	border-radius: 50%;
	border: 2px solid rgba(255, 255, 255, 0.4);
	background: rgba(0, 0, 0, 0.4);
	color: #fff;
	font-size: 22px;
	touch-action: none;

	&:global(.active) {
		background: rgba(255, 255, 255, 0.5);
		color: #000;
	}
}

.touchButtonLarge {
	width: 64px;
	height: 64px;
}

.panelOverlay {
	position: absolute;
	inset: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	background: rgba(0, 0, 0, 0.45);
	z-index: 30;
}

.panel {
	width: min(94%, 560px);
	max-height: 92%;
	overflow: auto;
	padding: 12px;
	border-radius: var(--MI-radius);
	background: rgba(20, 20, 24, 0.95);
	color: #fff;
}

.panelHeader {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 6px;
	margin-bottom: 10px;
}

.panelTab {
	padding: 6px 12px;
	border-radius: 999px;
	background: rgba(255, 255, 255, 0.1);
	color: #fff;
	font-size: 0.9em;
}

.panelTabActive {
	background: rgba(255, 255, 255, 0.3);
}

.panelClose {
	margin-left: auto;
	width: 32px;
	height: 32px;
	border-radius: 50%;
	color: #fff;
}

.info {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 8px 4px;
}

.infoAvatar {
	width: 36px;
	height: 36px;
}
</style>
