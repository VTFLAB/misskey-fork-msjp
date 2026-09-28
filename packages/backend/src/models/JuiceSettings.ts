/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Entity, PrimaryColumn, Column } from 'typeorm';

// JUICE 由来の拡張機能設定はここに集約する。misskey-juice からの移植で、単一の jsonb カラムに
// まとめる構成をそのまま踏襲している(個別のマイグレーションを増やさないため)。フィールドを
// 追加する際もこのファイルに追記していく想定(移植元との diff 互換性を保つため命名はそのまま)
export interface JuiceSettingsValue {
	/** リモートのカスタム絵文字を使ったリアクションへの相乗り(既存リアクションをクリックして同じリアクションを付けること)を許可するか */
	reactionPiggybackOnRemoteEnabled?: boolean;
	/** 通報(ユーザー通報)時に選べるカテゴリ一覧 */
	reportCategories?: ReportCategory[];
	/**
	 * AI生成物フラグ(isAIGenerated)が、ノート本体か添付ファイルのいずれか1つにでも立っている
	 * ノートを連合する際、ActivityPubのsummary(CW相当)にフォールバック文言を合成して送出するか
	 */
	aiGeneratedFallbackCwEnabled?: boolean;
}

// JUICE: 通報(ユーザー通報)のカテゴリ
export type ReportCategory = {
	key: string;
	text: string;
	enabled: boolean;
	order: number;
	isDefault: boolean;
};

/**
 * jsonb には存在しないキーがありうるため、デフォルト値を解決してから返す。
 * admin/juice/settings・juice/public-settingsの2箇所で共通利用する。
 */
export function resolveReactionPiggybackSettings(settings: JuiceSettingsValue): {
	reactionPiggybackOnRemoteEnabled: boolean;
} {
	return {
		// JUICE: リモートの絵文字画像を著作権者の許諾なく表示・使用することになりうるため、
		// 既定は無効(サーバー管理者の自己責任でのオプトイン)とする
		reactionPiggybackOnRemoteEnabled: settings.reactionPiggybackOnRemoteEnabled ?? false,
	};
}

/**
 * jsonb には存在しないキーがありうるため、デフォルト値を解決してから返す。
 * admin/juice/settings・juice/public-settingsの2箇所で共通利用する。
 */
export function resolveReportCategorySettings(settings: JuiceSettingsValue): {
	reportCategories: ReportCategory[];
} {
	return {
		reportCategories: settings.reportCategories ?? [],
	};
}

/**
 * jsonb には存在しないキーがありうるため、デフォルト値を解決してから返す。
 * admin/juice/settingsで利用する。
 */
export function resolveAiGeneratedFallbackCwSettings(settings: JuiceSettingsValue): {
	aiGeneratedFallbackCwEnabled: boolean;
} {
	return {
		aiGeneratedFallbackCwEnabled: settings.aiGeneratedFallbackCwEnabled ?? false,
	};
}

@Entity('juice_settings')
export class MiJuiceSettings {
	@PrimaryColumn('varchar', {
		length: 32,
	})
	public id: string;

	@Column('jsonb', {
		default: {},
	})
	public settings: JuiceSettingsValue;

	constructor(data: Partial<MiJuiceSettings>) {
		if (data == null) return;

		for (const [k, v] of Object.entries(data)) {
			(this as any)[k] = v;
		}
	}
}
