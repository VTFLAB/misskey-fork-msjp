/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export type MfmSyntaxEntry = {
	key: string;
	icon: string;
	labelKey: string;
	category: 'format' | 'block' | 'inline' | 'function';
	insert: (
		text: string,
		start: number,
		end: number,
	) => { text: string; start: number; end: number };
};

export function wrapSelection(
	text: string,
	start: number,
	end: number,
	prefix: string,
	suffix: string,
): { text: string; start: number; end: number } {
	const before = text.slice(0, start);
	const selected = text.slice(start, end);
	const after = text.slice(end);

	if (start === end) {
		const cursor = start + prefix.length;
		return {
			text: `${before}${prefix}${suffix}${after}`,
			start: cursor,
			end: cursor,
		};
	}

	const newText = `${before}${prefix}${selected}${suffix}${after}`;
	return {
		text: newText,
		start: start + prefix.length,
		end: end + prefix.length,
	};
}

export function wrapLines(
	text: string,
	start: number,
	end: number,
	linePrefix: string,
): { text: string; start: number; end: number } {
	const before = text.slice(0, start);
	const selected = text.slice(start, end);
	const after = text.slice(end);

	const lines = selected.split('\n');
	const wrapped = lines.map((line) => `${linePrefix}${line}`).join('\n');
	const newText = `${before}${wrapped}${after}`;

	return {
		text: newText,
		start: start + linePrefix.length,
		end: end + linePrefix.length * lines.length,
	};
}

export function wrapBlock(
	text: string,
	start: number,
	end: number,
	openMarker: string,
	closeMarker: string,
): { text: string; start: number; end: number } {
	const before = text.slice(0, start);
	const selected = text.slice(start, end);
	const after = text.slice(end);

	if (start === end) {
		const cursor = start + openMarker.length;
		return {
			text: `${before}${openMarker}${closeMarker}${after}`,
			start: cursor,
			end: cursor,
		};
	}

	const newText = `${before}${openMarker}${selected}${closeMarker}${after}`;
	return {
		text: newText,
		start: start + openMarker.length,
		end: end + openMarker.length,
	};
}

export const MFM_SYNTAX_ENTRIES: MfmSyntaxEntry[] = [
	{
		key: 'bold',
		icon: 'ti ti-bold',
		labelKey: 'mfmToolbar.bold',
		category: 'format',
		insert: (text, start, end) => wrapSelection(text, start, end, '**', '**'),
	},
	{
		key: 'italic',
		icon: 'ti ti-italic',
		labelKey: 'mfmToolbar.italic',
		category: 'format',
		insert: (text, start, end) => wrapSelection(text, start, end, '*', '*'),
	},
	{
		key: 'strike',
		icon: 'ti ti-strikethrough',
		labelKey: 'mfmToolbar.strike',
		category: 'format',
		insert: (text, start, end) => wrapSelection(text, start, end, '~~', '~~'),
	},
	{
		key: 'small',
		icon: 'ti ti-subscript',
		labelKey: 'mfmToolbar.small',
		category: 'format',
		insert: (text, start, end) => wrapSelection(text, start, end, '<small>', '</small>'),
	},
	{
		key: 'big',
		icon: 'ti ti-superscript',
		labelKey: 'mfmToolbar.big',
		category: 'format',
		insert: (text, start, end) => wrapSelection(text, start, end, '***', '***'),
	},
	{
		key: 'quote',
		icon: 'ti ti-quote',
		labelKey: 'mfmToolbar.quote',
		category: 'block',
		insert: (text, start, end) => wrapLines(text, start, end, '> '),
	},
	{
		key: 'codeBlock',
		icon: 'ti ti-code-dots',
		labelKey: 'mfmToolbar.codeBlock',
		category: 'block',
		insert: (text, start, end) => {
			if (start === end) {
				return wrapBlock(text, start, end, '```\ncode\n', '\n```');
			}
			return wrapBlock(text, start, end, '```\n', '\n```');
		},
	},
	{
		key: 'mathBlock',
		icon: 'ti ti-math-function',
		labelKey: 'mfmToolbar.mathBlock',
		category: 'block',
		insert: (text, start, end) => wrapBlock(text, start, end, '\\[\n', '\n\\]'),
	},
	{
		key: 'center',
		icon: 'ti ti-align-center',
		labelKey: 'mfmToolbar.center',
		category: 'block',
		insert: (text, start, end) => wrapBlock(text, start, end, '<center>', '</center>'),
	},
	{
		key: 'search',
		icon: 'ti ti-search',
		labelKey: 'mfmToolbar.search',
		category: 'block',
		insert: (text, start, end) => {
			if (start === end) {
				return {
					text: `${text.slice(0, start)} Search${text.slice(end)}`,
					start,
					end,
				};
			}
			return {
				text: `${text.slice(0, start)}${text.slice(start, end)} Search${text.slice(end)}`,
				start,
				end: end + 7,
			};
		},
	},
	{
		key: 'inlineCode',
		icon: 'ti ti-code',
		labelKey: 'mfmToolbar.inlineCode',
		category: 'inline',
		insert: (text, start, end) => wrapSelection(text, start, end, '`', '`'),
	},
	{
		key: 'inlineMath',
		icon: 'ti ti-math',
		labelKey: 'mfmToolbar.inlineMath',
		category: 'inline',
		insert: (text, start, end) => wrapSelection(text, start, end, '\\(', '\\)'),
	},
	{
		key: 'link',
		icon: 'ti ti-link',
		labelKey: 'mfmToolbar.link',
		category: 'inline',
		insert: (text, start, end) => {
			if (start === end) {
				const inserted = '[text](url)';
				const cursor = start + 1;
				return {
					text: `${text.slice(0, start)}${inserted}${text.slice(end)}`,
					start: cursor,
					end: cursor + 4,
				};
			}
			const selected = text.slice(start, end);
			const inserted = `[${selected}](url)`;
			return {
				text: `${text.slice(0, start)}${inserted}${text.slice(end)}`,
				start: start + 1,
				end: start + 1 + selected.length,
			};
		},
	},
];

export const MFM_SYNTAX_CATEGORIES = ['format', 'block', 'inline'] as const;
