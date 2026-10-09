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
						<div :class="$style.overlayTitle">{{ i18n.ts._craft.pauseMenu }}</div>
						<div :class="$style.menuList">
							<MkButton primary rounded full @click="resume"><i class="ti ti-player-play"></i> {{ i18n.ts._craft.resume }}</MkButton>
							<MkButton v-if="$i" rounded full @click="openUi('inventory')"><i class="ti ti-backpack"></i> {{ i18n.ts._craft.inventory }}</MkButton>
							<MkButton rounded full @click="toggleFullscreen"><i :class="fullscreen ? 'ti ti-arrows-minimize' : 'ti ti-arrows-maximize'"></i> {{ fullscreen ? i18n.ts._craft.exitFullscreen : i18n.ts._craft.fullscreen }}</MkButton>
							<MkButton rounded full @click="toggleInputMode"><i :class="touchMode ? 'ti ti-keyboard' : 'ti ti-device-mobile'"></i> {{ touchMode ? i18n.ts._craft.desktopMode : i18n.ts._craft.touchMode }}</MkButton>
							<MkButton rounded full @click="showMinimap = !showMinimap"><i :class="showMinimap ? 'ti ti-checkbox' : 'ti ti-square'"></i> {{ i18n.ts._craft.showMinimap }}</MkButton>
							<MkButton v-if="canManage" rounded full @click="editWorld"><i class="ti ti-settings"></i> {{ i18n.ts._craft.editWorld }}</MkButton>
							<MkButton rounded full @click="router.push('/craft')"><i class="ti ti-arrow-left"></i> {{ i18n.ts._craft.backToWorlds }}</MkButton>
						</div>
						<div v-if="!touchMode" :class="$style.overlayControls">{{ i18n.ts._craft.pauseHint }}</div>
					</div>
				</div>

				<div v-if="active && !uiOpen" :class="$style.crosshair"></div>
				<div v-if="breakProgress > 0" :class="$style.breakBar"><div :class="$style.breakBarFill" :style="{ width: `${Math.round(breakProgress * 100)}%` }"></div></div>

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

				<div :class="$style.hudRight">
					<canvas v-show="showMinimap" ref="minimapEl" :class="$style.minimap" role="img" :aria-label="i18n.ts._craft.minimap" :title="i18n.ts._craft.minimap"></canvas>
					<button v-if="!menuOpen && !dead" type="button" class="_button" :class="$style.hudButton" :title="i18n.ts._craft.pauseMenu" :aria-label="i18n.ts._craft.pauseMenu" @click="openMenu"><i class="ti ti-menu-2"></i></button>
				</div>

				<div v-if="$i" :class="$style.bottom">
					<div :class="$style.stats">
						<div :class="$style.stat" :title="i18n.ts._craft.health">
							<i class="ti ti-heart-filled" style="color: #e8453c;"></i>
							<div :class="$style.statBar"><div :class="$style.statFill" style="background: #e8453c;" :style="{ width: `${stats.health / PLAYER.maxHealth * 100}%` }"></div></div>
							<span :class="$style.statValue">{{ Math.ceil(stats.health) }}</span>
						</div>
						<div :class="$style.stat" :title="i18n.ts._craft.hunger">
							<i class="ti ti-meat" style="color: #e3a02a;"></i>
							<div :class="$style.statBar"><div :class="$style.statFill" style="background: #e3a02a;" :style="{ width: `${stats.hunger / PLAYER.maxHunger * 100}%` }"></div></div>
							<span :class="$style.statValue">{{ Math.ceil(stats.hunger) }}</span>
						</div>
						<div v-if="stats.air < PLAYER.maxAir" :class="$style.stat" :title="i18n.ts._craft.air">
							<i class="ti ti-droplet" style="color: #4aa3e8;"></i>
							<div :class="$style.statBar"><div :class="$style.statFill" style="background: #4aa3e8;" :style="{ width: `${stats.air / PLAYER.maxAir * 100}%` }"></div></div>
						</div>
					</div>
					<div :class="$style.hotbar">
						<button
							v-for="(stack, index) in hotbar"
							:key="index"
							type="button"
							class="_button"
							:class="[$style.slot, index === hotbarIndex && $style.slotActive]"
							:title="stack ? itemName(stack.id) : undefined"
							:aria-pressed="index === hotbarIndex"
							@click="engine?.selectHotbar(index)"
						>
							<img v-if="stack" :class="$style.slotIcon" :src="itemIcon(stack.id)" alt=""/>
							<span v-if="stack && stack.count > 1" :class="$style.slotCount">{{ stack.count }}</span>
							<span :class="$style.slotKey">{{ index + 1 }}</span>
						</button>
					</div>
					<div v-if="selectedName" :class="$style.selectedName">{{ selectedName }}</div>
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

				<div v-if="uiOpen" :class="$style.panelOverlay">
					<div :class="$style.panel">
						<div :class="$style.panelHeader">
							<button type="button" class="_button" :class="[$style.panelTab, panelTab === 'inventory' && $style.panelTabActive]" :aria-pressed="panelTab === 'inventory'" @click="panelTab = 'inventory'">{{ i18n.ts._craft.inventory }}</button>
							<button type="button" class="_button" :class="[$style.panelTab, panelTab === 'crafting' && $style.panelTabActive]" :aria-pressed="panelTab === 'crafting'" @click="panelTab = 'crafting'">{{ i18n.ts._craft.crafting }}</button>
							<button type="button" class="_button" :class="$style.panelClose" :aria-label="i18n.ts.close" :title="i18n.ts.close" @click="closeUi"><i class="ti ti-x"></i></button>
						</div>
						<div v-if="panelTab === 'inventory'" :class="$style.inventory">
							<div :class="$style.invGrid">
								<button
									v-for="(stack, index) in invMain"
									:key="index"
									type="button"
									class="_button"
									:class="[$style.slot, pickedSlot === index + 9 && $style.slotPicked]"
									:title="stack ? itemName(stack.id) : undefined"
									@click="clickSlot(index + 9)"
								>
									<img v-if="stack" :class="$style.slotIcon" :src="itemIcon(stack.id)" alt=""/>
									<span v-if="stack && stack.count > 1" :class="$style.slotCount">{{ stack.count }}</span>
								</button>
							</div>
							<div :class="$style.invGrid" style="margin-top: 10px;">
								<button
									v-for="(stack, index) in hotbar"
									:key="index"
									type="button"
									class="_button"
									:class="[$style.slot, pickedSlot === index && $style.slotPicked, index === hotbarIndex && $style.slotActive]"
									:title="stack ? itemName(stack.id) : undefined"
									@click="clickSlot(index)"
								>
									<img v-if="stack" :class="$style.slotIcon" :src="itemIcon(stack.id)" alt=""/>
									<span v-if="stack && stack.count > 1" :class="$style.slotCount">{{ stack.count }}</span>
									<span :class="$style.slotKey">{{ index + 1 }}</span>
								</button>
							</div>
							<div v-if="pickedName" :class="$style.selectedName" style="margin-top: 8px;">{{ pickedName }}</div>
						</div>
						<div v-else :class="$style.craftingList">
							<div v-if="!nearTable" :class="$style.craftingNote"><i class="ti ti-info-circle"></i> {{ i18n.ts._craft.craftingTableRequired }}</div>
							<div v-for="entry in recipes" :key="entry.recipe.key" :class="[$style.recipe, !entry.craftable && $style.recipeDisabled]">
								<img :class="$style.recipeIcon" :src="itemIcon(entry.recipe.result.id)" alt=""/>
								<div :class="$style.recipeBody">
									<div :class="$style.recipeName">{{ itemName(entry.recipe.result.id) }}<span v-if="entry.recipe.result.count > 1"> x{{ entry.recipe.result.count }}</span><i v-if="entry.recipe.needsTable" class="ti ti-tool" style="margin-left: 6px; opacity: 0.6;" :title="i18n.ts._craft.craftingTableRequired"></i></div>
									<div :class="$style.recipeIngredients">
										<span v-for="ing in entry.recipe.ingredients" :key="ing.id" :class="$style.recipeIngredient">
											<img :class="$style.recipeIngredientIcon" :src="itemIcon(ing.id)" alt=""/>
											{{ itemName(ing.id) }} x{{ ing.count }}
										</span>
									</div>
								</div>
								<MkButton :disabled="!entry.craftable" small primary @click="doCraft(entry.recipe)">{{ i18n.ts._craft.craftButton }}</MkButton>
							</div>
						</div>
					</div>
				</div>

				<div v-if="dead" :class="$style.overlay">
					<div :class="$style.overlayBox">
						<div :class="$style.overlayTitle" style="color: #ff7b7b;">{{ i18n.ts._craft.youDied }}</div>
						<div :class="$style.overlayControls">{{ i18n.ts._craft.deathNote }}</div>
						<MkButton primary rounded style="margin: 12px auto 0;" @click="respawn">{{ i18n.ts._craft.respawn }}</MkButton>
					</div>
				</div>
			</div>

			<div :class="$style.info">
				<MkAvatar :class="$style.infoAvatar" :user="world.user"/>
				<div>
					<div><b>{{ world.name }}</b> <span v-if="!world.isPublic" :title="i18n.ts._craft.ownerOnly"><i class="ti ti-lock"></i></span></div>
					<div style="font-size: 0.85em; opacity: 0.7;"><MkUserName :user="world.user"/> · {{ i18n.tsx._craft.blocksCount({ n: world.blockCount }) }} · {{ i18n.ts._craft.seed }}: {{ world.seed }}</div>
				</div>
			</div>
		</div>
		<MkLoading v-else/>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, onMounted, onUnmounted, ref, shallowRef, useTemplateRef, watch, nextTick } from 'vue';
import * as Misskey from 'misskey-js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { definePage } from '@/page.js';
import { useStream } from '@/stream.js';
import { i18n } from '@/i18n.js';
import { $i } from '@/i.js';
import { useRouter } from '@/router.js';
import * as os from '@/os.js';
import MkButton from '@/components/MkButton.vue';
import { CraftEngine } from '@/utility/craft/engine.js';
import type { EngineState } from '@/utility/craft/engine.js';
import { ITEM_DEFS, PLAYER, isNight } from '@/utility/craft/constants.js';
import type { Recipe } from '@/utility/craft/constants.js';
import type { ItemStack, MobSnapshot, PlayerStats } from '@/utility/craft/types.js';
import { itemIcon } from '@/utility/craft/icons.js';

const props = defineProps<{
	worldId: string;
}>();

const router = useRouter();

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
const showMinimap = ref(true);
let started = false;
const dead = ref(false);
const panelTab = ref<'inventory' | 'crafting'>('inventory');
const fullscreen = ref(false);
const touchMode = ref(false);
const isHost = ref(false);
const night = ref(isNight());
const enemyNear = ref(false);
const hotbarIndex = ref(0);
const playerCount = ref(0);
const positionText = ref('');
const breakProgress = ref(0);
const webglError = ref(false);
const stats = ref<PlayerStats>({ health: PLAYER.maxHealth, hunger: PLAYER.maxHunger, air: PLAYER.maxAir });
const inventoryVersion = ref(0);
const pickedSlot = ref<number | null>(null);
const nearTable = ref(false);
const playerLabels = ref<{ userId: string; username: string; name: string | null; avatarUrl: string | null; x: number; y: number; dist: number }[]>([]);
let hudTimer: number | null = null;
let saveTimer: number | null = null;
let starting = false;

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

const invMain = computed<ItemStack[]>(() => {
	void inventoryVersion.value;
	return engine.value ? engine.value.player.inventory.slots.slice(PLAYER.hotbarSize) : [];
});

const recipes = computed<{ recipe: Recipe; craftable: boolean }[]>(() => {
	void inventoryVersion.value;
	void nearTable.value;
	return engine.value ? engine.value.recipes() : [];
});

const selectedName = computed(() => {
	const stack = hotbar.value[hotbarIndex.value];
	return stack ? itemName(stack.id) : null;
});

const pickedName = computed(() => {
	if (pickedSlot.value == null || engine.value == null) return null;
	const stack = engine.value.player.inventory.slots[pickedSlot.value];
	return stack ? itemName(stack.id) : null;
});

function itemName(id: number): string {
	const def = ITEM_DEFS[id];
	if (def == null) return '';
	if (def.kind === 'block') {
		return (i18n.ts._craft._blocks as Record<string, string>)[def.key] ?? def.key;
	}
	return (i18n.ts._craft._items as Record<string, string>)[def.key] ?? def.key;
}

function stateKey(): string {
	return `craft:state:${props.worldId}:${$i?.id ?? 'guest'}`;
}

function loadState(): EngineState | null {
	try {
		const raw = window.localStorage.getItem(stateKey());
		if (raw == null) return null;
		const parsed = JSON.parse(raw) as EngineState;
		if (typeof parsed !== 'object' || typeof parsed.pos?.x !== 'number') return null;
		return parsed;
	} catch {
		return null;
	}
}

function saveState() {
	if (engine.value == null || $i == null || engine.value.player.isDead) return;
	try {
		window.localStorage.setItem(stateKey(), JSON.stringify(engine.value.exportState()));
	} catch {
		// 容量不足などは無視
	}
}

async function load() {
	world.value = await misskeyApi('craft/show', { worldId: props.worldId });
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
		touchMode.value = e.inputMode === 'touch';

		e.on('activeChange', (v) => {
			active.value = v;
			// 操作をやめた (Esc など) らポーズメニューを出す
			if (!v && started && !uiOpen.value && !dead.value) menuOpen.value = true;
		});
		e.on('fullscreenChange', (v) => { fullscreen.value = v; });
		e.on('hostChange', (v) => { isHost.value = v; });
		e.on('hotbarChange', (v) => { hotbarIndex.value = v; });
		e.on('inventoryChange', () => { inventoryVersion.value++; });
		e.on('statsChange', (s) => { stats.value = s; });
		e.on('playersChange', () => { playerCount.value = e.remotePlayers.size; });
		e.on('died', () => {
			dead.value = true;
			uiOpen.value = false;
			e.uiOpen = true;
			e.stopPlaying();
		});
		e.on('toggleInventory', () => {
			if (uiOpen.value) closeUi(); else openUi('inventory');
		});
		e.on('openCrafting', () => openUi('crafting'));
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
			connection.value?.send('mobHit', hit);
		});

		// 取得中の変更を取りこぼさないよう、先に購読してから差分を取得する
		connect(e);
		try {
			await loadBlocks(e);
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

		e.start(loadState());
		engine.value = e;
		e.attachMinimap(minimapEl.value ?? null);
		inventoryVersion.value++;
		hotbarIndex.value = e.player.hotbarIndex;
		stats.value = { ...e.player.stats };
		bindTouch();

		hudTimer = window.setInterval(() => {
			const p = e.player;
			positionText.value = `X ${Math.floor(p.pos.x)}  Y ${Math.floor(p.pos.y)}  Z ${Math.floor(p.pos.z)}`;
			playerCount.value = e.remotePlayers.size;
			breakProgress.value = e.breakProgressValue;
			night.value = isNight();
			const near = e.mobs.nearestDistance(p.pos.x, p.pos.y, p.pos.z);
			enemyNear.value = near != null && near < 12;
			nearTable.value = e.nearTable;
			playerLabels.value = e.remotePlayerScreenPositions().map(pos => {
				const rp = e.remotePlayers.get(pos.userId)!;
				return { ...pos, username: rp.username, name: rp.name, avatarUrl: rp.avatarUrl };
			});
		}, 100);
		saveTimer = window.setInterval(saveState, 10000);
	} finally {
		starting = false;
	}
}

let blocksLoaded = false;
let unmounted = false;
let bufferedBlocks: { x: number; y: number; z: number; type: number }[] = [];

async function loadBlocks(e: CraftEngine) {
	blocksLoaded = false;
	const blocks = await misskeyApi('craft/blocks', { worldId: props.worldId });
	e.world.applyFlat(blocks.blocks);
	for (const b of bufferedBlocks) e.applyRemoteBlock(b.x, b.y, b.z, b.type);
	bufferedBlocks = [];
	blocksLoaded = true;
}

function onReconnected() {
	const e = engine.value;
	if (e == null) return;
	// 切断中に送った編集は届いたか分からないので戻してから取り直す
	e.revertAllPending();
	loadBlocks(e).catch(err => console.error(err));
}

function connect(e: CraftEngine) {
	const stream = useStream();
	const c = stream.useChannel('craftWorld', { worldId: props.worldId });
	c.on('blockUpdated', (payload) => {
		if (!blocksLoaded) {
			bufferedBlocks.push(payload);
			return;
		}
		e.applyRemoteBlock(payload.x, payload.y, payload.z, payload.type);
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
	c.on('worldUpdated', (payload) => {
		if (world.value == null) return;
		world.value = { ...world.value, name: payload.name, isPublic: payload.isPublic };
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

function openUi(tab: 'inventory' | 'crafting') {
	const e = engine.value;
	if (e == null || $i == null) return;
	menuOpen.value = false;
	panelTab.value = tab;
	uiOpen.value = true;
	pickedSlot.value = null;
	e.uiOpen = true;
	nearTable.value = e.nearTable;
	inventoryVersion.value++;
	e.stopPlaying();
}

function closeUi() {
	const e = engine.value;
	uiOpen.value = false;
	pickedSlot.value = null;
	if (e == null) return;
	e.uiOpen = false;
	saveState();
	if (!dead.value) e.startPlaying();
}

function clickSlot(index: number) {
	const e = engine.value;
	if (e == null) return;
	if (pickedSlot.value == null) {
		if (e.player.inventory.slots[index] != null) pickedSlot.value = index;
		return;
	}
	if (pickedSlot.value !== index) e.moveItem(pickedSlot.value, index);
	pickedSlot.value = null;
}

function doCraft(recipe: Recipe) {
	engine.value?.craftRecipe(recipe);
}

function respawn() {
	const e = engine.value;
	if (e == null) return;
	dead.value = false;
	menuOpen.value = false;
	e.uiOpen = false;
	e.respawn();
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

watch(canvasEl, () => {
	if (canvasEl.value != null) startEngine();
});

// タッチ操作の DOM は active のときだけ存在するので、現れるたびに結び直す
watch([active, touchMode, uiOpen], async () => {
	await nextTick();
	bindTouch();
});

function onVisibilityChange() {
	if (window.document.visibilityState === 'hidden') saveState();
}

onMounted(async () => {
	window.document.addEventListener('visibilitychange', onVisibilityChange);
	await load();
});

onUnmounted(() => {
	unmounted = true;
	window.document.removeEventListener('visibilitychange', onVisibilityChange);
	if (hudTimer != null) window.clearInterval(hudTimer);
	if (saveTimer != null) window.clearInterval(saveTimer);
	saveState();
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

.menuList {
	display: flex;
	flex-direction: column;
	gap: 8px;
	margin-top: 14px;
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

.stats {
	display: flex;
	gap: 10px;
	padding: 4px 10px;
	border-radius: 999px;
	background: rgba(0, 0, 0, 0.45);
	color: #fff;
	font-size: 0.8em;
}

.stat {
	display: flex;
	align-items: center;
	gap: 4px;
}

.statBar {
	width: 70px;
	height: 6px;
	border-radius: 3px;
	background: rgba(255, 255, 255, 0.2);
	overflow: hidden;
}

.statFill {
	height: 100%;
	transition: width 0.2s;
}

.statValue {
	min-width: 1.5em;
	text-align: right;
	font-variant-numeric: tabular-nums;
}

.hotbar {
	display: flex;
	gap: 4px;
	padding: 4px;
	border-radius: 8px;
	background: rgba(0, 0, 0, 0.45);
	pointer-events: auto;
}

.slot {
	position: relative;
	width: 40px;
	height: 40px;
	border-radius: 6px;
	border: 2px solid rgba(255, 255, 255, 0.25);
	background: rgba(0, 0, 0, 0.3);
	cursor: pointer;

	&:hover {
		border-color: rgba(255, 255, 255, 0.6);
	}
}

.slotActive {
	border-color: #fff;
	box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.4);
}

.slotPicked {
	border-color: #ffd37a;
	box-shadow: 0 0 0 2px rgba(255, 211, 122, 0.6);
}

.slotIcon {
	position: absolute;
	inset: 4px;
	width: calc(100% - 8px);
	height: calc(100% - 8px);
	image-rendering: pixelated;
	pointer-events: none;
}

.slotCount {
	position: absolute;
	right: 3px;
	bottom: 1px;
	font-size: 11px;
	font-weight: bold;
	color: #fff;
	text-shadow: 0 0 2px #000, 0 0 2px #000;
}

.slotKey {
	position: absolute;
	left: 3px;
	top: 0;
	font-size: 9px;
	color: rgba(255, 255, 255, 0.7);
	text-shadow: 0 0 2px #000;
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
	bottom: 110px;
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
	bottom: 110px;
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
	width: min(92%, 520px);
	max-height: 90%;
	overflow: auto;
	padding: 12px;
	border-radius: var(--MI-radius);
	background: rgba(20, 20, 24, 0.95);
	color: #fff;
}

.panelHeader {
	display: flex;
	align-items: center;
	gap: 6px;
	margin-bottom: 10px;
}

.panelTab {
	padding: 6px 14px;
	border-radius: 999px;
	background: rgba(255, 255, 255, 0.1);
	color: #fff;
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

.inventory {
	display: flex;
	flex-direction: column;
	align-items: center;
}

.invGrid {
	display: grid;
	grid-template-columns: repeat(9, 40px);
	gap: 4px;
}

.craftingList {
	display: flex;
	flex-direction: column;
	gap: 6px;
}

.craftingNote {
	padding: 6px 10px;
	border-radius: 6px;
	background: rgba(255, 211, 122, 0.15);
	color: #ffd37a;
	font-size: 0.85em;
}

.recipe {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 6px 8px;
	border-radius: 8px;
	background: rgba(255, 255, 255, 0.07);
}

.recipeDisabled {
	opacity: 0.55;
}

.recipeIcon {
	width: 36px;
	height: 36px;
	image-rendering: pixelated;
}

.recipeBody {
	flex: 1;
	min-width: 0;
}

.recipeName {
	font-weight: bold;
	font-size: 0.9em;
}

.recipeIngredients {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
	margin-top: 2px;
	font-size: 0.8em;
	opacity: 0.85;
}

.recipeIngredient {
	display: inline-flex;
	align-items: center;
	gap: 3px;
}

.recipeIngredientIcon {
	width: 16px;
	height: 16px;
	image-rendering: pixelated;
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
