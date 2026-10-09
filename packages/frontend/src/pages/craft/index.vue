<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader>
	<div class="_spacer" style="--MI_SPACER-w: 800px;">
		<div class="_gaps">
			<div :class="$style.hero">
				<i class="ti ti-cube" :class="$style.heroIcon"></i>
				<div :class="$style.heroTitle">{{ i18n.ts._craft.craft }}</div>
				<div :class="$style.heroDescription">{{ i18n.ts._craft.description }}</div>
			</div>

			<div class="_panel _gaps" style="padding: 16px;">
				<div class="_buttonsCenter">
					<MkButton primary gradate rounded @click="createWorld"><i class="ti ti-plus"></i> {{ i18n.ts._craft.createWorld }}</MkButton>
				</div>
				<div style="font-size: 90%; opacity: 0.7; text-align: center;"><i class="ti ti-keyboard"></i> {{ i18n.ts._craft.keyboardRequired }}</div>
			</div>

			<MkFolder v-if="$i" :defaultOpen="true">
				<template #label>{{ i18n.ts._craft.myWorlds }}</template>
				<MkPagination :paginator="myWorldsPaginator">
					<template #empty>
						<div class="_fullinfo">
							<div>{{ i18n.ts._craft.noWorlds }}</div>
						</div>
					</template>
					<template #default="{ items }">
						<div :class="$style.worlds">
							<MkA v-for="world in items" :key="world.id" v-panel :class="$style.world" :to="`/craft/w/${world.id}`">
								<div :class="$style.worldName">{{ world.name }}</div>
								<div :class="$style.worldMeta">
									<MkAvatar :class="$style.worldAvatar" :user="world.user"/>
									<span><MkUserName :user="world.user"/></span>
									<span v-if="!world.isPublic" :title="i18n.ts._craft.ownerOnly"><i class="ti ti-lock"></i></span>
									<span style="margin-left: auto;">{{ i18n.tsx._craft.blocksCount({ n: world.blockCount }) }}</span>
								</div>
								<div :class="$style.worldFooter">
									<MkTime :time="world.createdAt" style="opacity: 0.7;"/>
								</div>
							</MkA>
						</div>
					</template>
				</MkPagination>
			</MkFolder>

			<MkFolder :defaultOpen="true">
				<template #label>{{ i18n.ts._craft.publicWorlds }}</template>
				<MkPagination :paginator="publicWorldsPaginator">
					<template #empty>
						<div class="_fullinfo">
							<div>{{ i18n.ts._craft.noWorlds }}</div>
						</div>
					</template>
					<template #default="{ items }">
						<div :class="$style.worlds">
							<MkA v-for="world in items" :key="world.id" v-panel :class="$style.world" :to="`/craft/w/${world.id}`">
								<div :class="$style.worldName">{{ world.name }}</div>
								<div :class="$style.worldMeta">
									<MkAvatar :class="$style.worldAvatar" :user="world.user"/>
									<span><MkUserName :user="world.user"/></span>
									<span style="margin-left: auto;">{{ i18n.tsx._craft.blocksCount({ n: world.blockCount }) }}</span>
								</div>
								<div :class="$style.worldFooter">
									<MkTime :time="world.createdAt" style="opacity: 0.7;"/>
								</div>
							</MkA>
						</div>
					</template>
				</MkPagination>
			</MkFolder>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { markRaw } from 'vue';
import { definePage } from '@/page.js';
import MkButton from '@/components/MkButton.vue';
import MkFolder from '@/components/MkFolder.vue';
import MkPagination from '@/components/MkPagination.vue';
import { i18n } from '@/i18n.js';
import { $i } from '@/i.js';
import { useRouter } from '@/router.js';
import * as os from '@/os.js';
import { pleaseLogin } from '@/utility/please-login.js';
import { Paginator } from '@/utility/paginator.js';

const router = useRouter();

const myWorldsPaginator = markRaw(new Paginator('craft/worlds', {
	limit: 10,
	params: {
		my: true,
	},
}));

const publicWorldsPaginator = markRaw(new Paginator('craft/worlds', {
	limit: 10,
}));

async function createWorld() {
	const isLoggedIn = await pleaseLogin();
	if (!isLoggedIn) return;

	const { canceled, result } = await os.form(i18n.ts._craft.createWorld, {
		name: {
			type: 'string',
			label: i18n.ts._craft.worldName,
			default: '',
		},
		seed: {
			type: 'number',
			label: i18n.ts._craft.seed,
			description: i18n.ts._craft.seedDescription,
			required: false,
			default: null,
		},
		isPublic: {
			type: 'boolean',
			label: i18n.ts._craft.anyoneCanBuild,
			description: i18n.ts._craft.anyoneCanBuildDescription,
			default: true,
		},
	});
	if (canceled) return;

	const seed = result.seed == null || Number.isNaN(result.seed) ? null : Math.max(0, Math.min(2147483647, Math.floor(result.seed)));
	const world = await os.apiWithDialog('craft/create', {
		name: result.name,
		seed,
		isPublic: result.isPublic,
	});

	router.push('/craft/w/:worldId', {
		params: {
			worldId: world.id,
		},
	});
}

definePage(() => ({
	title: i18n.ts._craft.craft,
	icon: 'ti ti-cube',
}));
</script>

<style lang="scss" module>
.hero {
	padding: 32px 24px;
	border-radius: var(--MI-radius);
	background: linear-gradient(160deg, #6cae3e 0%, #3b6fd8 100%);
	color: #fff;
	text-align: center;
}

.heroIcon {
	font-size: 48px;
}

.heroTitle {
	margin-top: 8px;
	font-size: 1.6em;
	font-weight: bold;
}

.heroDescription {
	margin-top: 4px;
	opacity: 0.9;
}

.worlds {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
	gap: 12px;
}

.world {
	display: block;
	padding: 14px;
	border-radius: var(--MI-radius);
	color: inherit;
	text-decoration: none;

	&:hover {
		text-decoration: none;
		outline: 2px solid var(--MI_THEME-accent);
		outline-offset: -2px;
	}
}

.worldName {
	font-weight: bold;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.worldMeta {
	display: flex;
	align-items: center;
	gap: 6px;
	margin-top: 8px;
	font-size: 0.9em;
}

.worldAvatar {
	width: 22px;
	height: 22px;
}

.worldFooter {
	margin-top: 8px;
	font-size: 0.85em;
}
</style>
