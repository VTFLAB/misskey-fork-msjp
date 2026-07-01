<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader :actions="headerActions" :tabs="headerTabs">
	<div class="_spacer" style="--MI_SPACER-w: 900px;">
		<div class="_gaps">
			<MkInfo>{{ i18n.ts._updateInfo.description }}</MkInfo>

			<MkLoading v-if="loading"/>

			<template v-else>
				<MkFolder v-for="updateInfo in updateInfos" :key="updateInfo.id ?? updateInfo._id" :defaultOpen="updateInfo.id == null">
					<template #label>{{ updateInfo.title }}</template>
					<template #icon><i class="ti ti-speakerphone"></i></template>
					<template #caption>{{ updateInfo.text }}</template>
					<template #footer>
						<div class="_buttons">
							<MkButton rounded primary @click="save(updateInfo)"><i class="ti ti-device-floppy"></i> {{ i18n.ts.save }}</MkButton>
							<MkButton v-if="updateInfo.id != null" rounded danger @click="del(updateInfo)"><i class="ti ti-trash"></i> {{ i18n.ts.delete }}</MkButton>
						</div>
					</template>

					<div class="_gaps">
						<MkInput v-model="updateInfo.title">
							<template #label>{{ i18n.ts.title }}</template>
						</MkInput>
						<MkTextarea v-model="updateInfo.text" mfmAutocomplete :mfmPreview="true">
							<template #label>{{ i18n.ts.text }}</template>
						</MkTextarea>
						<MkInput v-model="updateInfo.imageUrl" type="url">
							<template #label>{{ i18n.ts.imageUrl }}</template>
						</MkInput>
					</div>
				</MkFolder>
				<MkLoading v-if="loadingMore"/>
				<MkButton @click="more()">
					<i class="ti ti-reload"></i>{{ i18n.ts.more }}
				</MkButton>
			</template>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { ref, computed } from 'vue';
import * as Misskey from 'misskey-js';
import MkButton from '@/components/MkButton.vue';
import MkInput from '@/components/MkInput.vue';
import MkInfo from '@/components/MkInfo.vue';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import MkFolder from '@/components/MkFolder.vue';
import MkTextarea from '@/components/MkTextarea.vue';
import { genId } from '@/utility/id.js';

const loading = ref(true);
const loadingMore = ref(false);

const updateInfos = ref<(Omit<Misskey.entities.AdminUpdateInfoListResponse[number], 'id' | 'createdAt' | 'updatedAt'> & {
	id: string | null;
	_id?: string;
})[]>([]);

function refresh() {
	loading.value = true;
	misskeyApi('admin/update-info/list', {}).then(res => {
		updateInfos.value = res;
		loading.value = false;
	});
}

refresh();

function add() {
	updateInfos.value.unshift({
		_id: genId(),
		id: null,
		title: 'New update info',
		text: '',
		imageUrl: null,
	});
}

async function del(updateInfo: (typeof updateInfos)['value'][number]) {
	if (updateInfo.id == null) return;
	const { canceled } = await os.confirm({
		type: 'warning',
		text: i18n.tsx.deleteAreYouSure({ x: updateInfo.title }),
	});
	if (canceled) return;
	updateInfos.value = updateInfos.value.filter(x => x !== updateInfo);
	misskeyApi('admin/update-info/delete', {
		id: updateInfo.id,
	});
}

async function save(updateInfo: (typeof updateInfos)['value'][number]) {
	const { _id, ...data } = updateInfo; // _idを消す
	if (updateInfo.id == null) {
		await os.apiWithDialog('admin/update-info/create', data);
		refresh();
	} else {
		os.apiWithDialog('admin/update-info/update', {
			...data,
			id: updateInfo.id, // TSを黙らすため
		});
	}
}

function more() {
	loadingMore.value = true;
	misskeyApi('admin/update-info/list', {
		untilId: updateInfos.value.reduce((acc, updateInfo) => updateInfo.id != null ? updateInfo : acc).id!,
	}).then(res => {
		updateInfos.value = updateInfos.value.concat(res);
		loadingMore.value = false;
	});
}

const headerActions = computed(() => [{
	asFullButton: true,
	icon: 'ti ti-plus',
	text: i18n.ts.add,
	handler: add,
}]);

const headerTabs = computed(() => []);

definePage(() => ({
	title: i18n.ts.updateInfo,
	icon: 'ti ti-speakerphone',
}));
</script>
