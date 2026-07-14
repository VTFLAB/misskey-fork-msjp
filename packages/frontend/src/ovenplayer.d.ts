/**
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

declare module 'ovenplayer' {
	const OvenPlayer: {
		create(elementId: string, config: Record<string, unknown>): {
			remove(): void;
			setMute(muted: boolean): void;
			setVolume(volume: number): void;
			getState(): string;
			on(event: 'stateChanged', cb: (data: { prevstate: string; newstate: string }) => void): void;
			on(event: 'error', cb: (error: unknown) => void): void;
		};
	};
	export default OvenPlayer;
}
