<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader :actions="headerActions">
	<div class="_spacer" style="--MI_SPACER-w: 1200px; --MI_SPACER-min: 8px; --MI_SPACER-max: 16px;">
		<div v-if="world" class="_gaps_s">
			<div :class="$style.stage">
				<canvas ref="canvasEl" :class="$style.canvas"></canvas>

				<div v-if="webglError" :class="$style.overlay">
					<div :class="$style.overlayBox">{{ i18n.ts._craft.webglRequired }}</div>
				</div>
				<button v-else-if="!locked" type="button" class="_button" :class="$style.overlay" @click="engine?.requestLock()">
					<div :class="$style.overlayBox">
						<div :class="$style.overlayTitle"><i class="ti ti-pointer"></i> {{ i18n.ts._craft.clickToPlay }}</div>
						<div :class="$style.overlayControls">{{ i18n.ts._craft.controls }}</div>
						<div v-if="!canBuild" :class="$style.overlayNote"><i class="ti ti-eye"></i> {{ $i ? i18n.ts._craft.spectating : i18n.ts._craft.loginToBuild }}</div>
					</div>
				</button>

				<div v-if="locked" :class="$style.crosshair"></div>

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
					<div v-if="flying" :class="$style.hudItem"><i class="ti ti-feather"></i> {{ i18n.ts._craft.flying }}</div>
					<div v-if="!canBuild" :class="$style.hudItem"><i class="ti ti-eye"></i></div>
					<div :class="$style.hudItem" style="font-variant-numeric: tabular-nums;">{{ positionText }}</div>
				</div>

				<div v-if="canBuild" :class="$style.hotbar">
					<button
						v-for="(id, index) in HOTBAR_BLOCKS"
						:key="id"
						class="_button"
						:class="[$style.hotbarSlot, index === hotbarIndex && $style.hotbarSlotActive]"
						:title="`${index + 1}: ${i18n.ts._craft._blocks[BLOCK_DEFS[id].key]}`"
						:aria-pressed="index === hotbarIndex"
						@click="engine?.selectHotbar(index)"
					>
						<span :class="$style.hotbarColor" :style="{ background: BLOCK_DEFS[id].color }"></span>
						<span :class="$style.hotbarKey">{{ index + 1 }}</span>
					</button>
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
import { computed, onMounted, onUnmounted, ref, shallowRef, useTemplateRef, watch } from 'vue';
import * as Misskey from 'misskey-js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { definePage } from '@/page.js';
import { useStream } from '@/stream.js';
import { i18n } from '@/i18n.js';
import { $i } from '@/i.js';
import { useRouter } from '@/router.js';
import * as os from '@/os.js';
import { CraftEngine } from '@/utility/craft/engine.js';
import { BLOCK_DEFS, HOTBAR_BLOCKS } from '@/utility/craft/constants.js';

const props = defineProps<{
	worldId: string;
}>();

const router = useRouter();

const world = ref<Misskey.entities.CraftWorld | null>(null);
const canvasEl = useTemplateRef('canvasEl');
const engine = shallowRef<CraftEngine | null>(null);
const connection = shallowRef<Misskey.IChannelConnection<Misskey.Channels['craftWorld']> | null>(null);
const locked = ref(false);
const flying = ref(false);
const hotbarIndex = ref(0);
const playerCount = ref(0);
const positionText = ref('');
const webglError = ref(false);
const playerLabels = ref<{ userId: string; username: string; name: string | null; avatarUrl: string | null; x: number; y: number; dist: number }[]>([]);
let hudTimer: number | null = null;
let starting = false;

const canBuild = computed(() => {
	if (world.value == null || $i == null) return false;
	return world.value.isPublic || world.value.userId === $i.id;
});

const canManage = computed(() => {
	if (world.value == null || $i == null) return false;
	return world.value.userId === $i.id || $i.isModerator || $i.isAdmin;
});

async function load() {
	world.value = await misskeyApi('craft/show', { worldId: props.worldId });
}

async function startEngine() {
	if (starting || engine.value != null || world.value == null || canvasEl.value == null) return;
	starting = true;
	try {
		let e: CraftEngine;
		try {
			e = new CraftEngine(canvasEl.value, world.value.seed);
		} catch (err) {
			console.error(err);
			webglError.value = true;
			return;
		}
		e.canBuild = canBuild.value;

		// 取得中の変更を取りこぼさないよう、先に購読してから差分を取得する
		connect(e);
		await loadBlocks(e);

		e.on('pointerLockChange', (v) => { locked.value = v; });
		e.on('flyChange', (v) => { flying.value = v; });
		e.on('hotbarChange', (v) => { hotbarIndex.value = v; });
		e.on('setBlock', (x, y, z, type) => {
			connection.value?.send('setBlock', { x, y, z, type });
		});
		e.on('move', (x, y, z, yaw, pitch) => {
			if ($i == null) return;
			connection.value?.send('move', { x, y, z, yaw, pitch });
		});

		e.start();
		engine.value = e;

		hudTimer = window.setInterval(() => {
			const p = e.player;
			positionText.value = `X ${Math.floor(p.x)}  Y ${Math.floor(p.y)}  Z ${Math.floor(p.z)}`;
			playerCount.value = e.remotePlayers.size;
			playerLabels.value = e.remotePlayerScreenPositions().map(pos => {
				const rp = e.remotePlayers.get(pos.userId)!;
				return { ...pos, username: rp.username, name: rp.name, avatarUrl: rp.avatarUrl };
			});
		}, 100);
	} finally {
		starting = false;
	}
}

let blocksLoaded = false;
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
	// 切断中の変更を取り直す
	if (engine.value) loadBlocks(engine.value);
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
	c.on('worldUpdated', (payload) => {
		if (world.value == null) return;
		world.value = { ...world.value, name: payload.name, isPublic: payload.isPublic };
	});
	stream.on('_connected_', onReconnected);
	c.on('playerMoved', (payload) => {
		if ($i != null && payload.userId === $i.id) return;
		e.applyRemotePlayer(payload);
	});
	c.on('playerLeft', (payload) => {
		e.removeRemotePlayer(payload.userId);
	});
	c.on('worldDeleted', () => {
		os.alert({
			type: 'info',
			text: i18n.ts._craft.worldDeleted,
		});
		router.push('/craft');
	});
	connection.value = c;
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

watch(canvasEl, () => {
	if (canvasEl.value != null) startEngine();
});

onMounted(async () => {
	await load();
});

onUnmounted(() => {
	if (hudTimer != null) window.clearInterval(hudTimer);
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
}

.canvas {
	display: block;
	width: 100%;
	height: 100%;
	cursor: crosshair;
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
	pointer-events: none;
}

.hudItem {
	padding: 4px 10px;
	border-radius: 999px;
	background: rgba(0, 0, 0, 0.5);
	color: #fff;
	font-size: 0.8em;
}

.hotbar {
	position: absolute;
	left: 50%;
	bottom: 10px;
	transform: translateX(-50%);
	display: flex;
	gap: 4px;
	padding: 4px;
	border-radius: 8px;
	background: rgba(0, 0, 0, 0.45);
}

.hotbarSlot {
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

.hotbarSlotActive {
	border-color: #fff;
	box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.4);
}

.hotbarColor {
	position: absolute;
	inset: 6px;
	border-radius: 4px;
	box-shadow: inset -3px -3px 0 rgba(0, 0, 0, 0.25), inset 3px 3px 0 rgba(255, 255, 255, 0.2);
}

.hotbarKey {
	position: absolute;
	right: 2px;
	bottom: 0;
	font-size: 9px;
	color: #fff;
	text-shadow: 0 0 2px #000;
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
