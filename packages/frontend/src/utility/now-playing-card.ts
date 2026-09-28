/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// NowPlaying カード画像のレンダラー。DOM / Vue に一切依存しない純粋な 2D canvas 描画コードで、
// ブラウザの CanvasRenderingContext2D と @napi-rs/canvas の SKRSContext2D の両方から
// 呼び出せるよう、ctx の型は実際に使うメソッド/プロパティだけを列挙した最小限の構造的型にしている。
// (オフライン視覚確認は scratchpad で esbuild バンドル + @napi-rs/canvas を使って行う)

/** このモジュールが要求する 2D コンテキストの最小限のインターフェース。 */
export interface NowPlayingCardContext2D {
	save(): void;
	restore(): void;
	beginPath(): void;
	closePath(): void;
	moveTo(x: number, y: number): void;
	lineTo(x: number, y: number): void;
	arc(x: number, y: number, radius: number, startAngle: number, endAngle: number, counterclockwise?: boolean): void;
	roundRect(x: number, y: number, w: number, h: number, radii?: number | number[]): void;
	rect(x: number, y: number, w: number, h: number): void;
	clip(fillRule?: 'nonzero' | 'evenodd'): void;
	fill(fillRule?: 'nonzero' | 'evenodd'): void;
	stroke(): void;
	fillRect(x: number, y: number, w: number, h: number): void;
	drawImage(image: any, dx: number, dy: number): void;
	drawImage(image: any, dx: number, dy: number, dw: number, dh: number): void;
	drawImage(image: any, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void;
	createLinearGradient(x0: number, y0: number, x1: number, y1: number): { addColorStop(offset: number, color: string): void };
	createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): { addColorStop(offset: number, color: string): void };
	measureText(text: string): { width: number };
	fillText(text: string, x: number, y: number, maxWidth?: number): void;
	getImageData(sx: number, sy: number, sw: number, sh: number): { data: Uint8ClampedArray | Uint8Array };
	fillStyle: any;
	strokeStyle: any;
	lineWidth: number;
	lineCap: string;
	font: string;
	textAlign: string;
	textBaseline: string;
	shadowColor: string;
	shadowBlur: number;
	shadowOffsetX: number;
	shadowOffsetY: number;
	filter?: string;
	canvas?: any;
}

export type RgbColor = { r: number; g: number; b: number };

export type NowPlayingCardInput = {
	title: string;
	artist: string | null;
	serviceLabel: string;
	/** 右下に小さく表示するフッター文字列 (インスタンスホストや "#NowPlaying" など) */
	footer: string;
	/** アートワーク画像。呼び出し側で読み込み済みのものを渡す (null なら art card を描画) */
	artwork: CanvasImageSource | null;
	/** 事前に計算した支配色。無ければタイトル文字列から決定論的に生成する */
	artworkColors?: RgbColor[];
	fontFamily?: string;
};

export const NOW_PLAYING_CARD_SIZE = { width: 1600, height: 840 } as const;

export const DEFAULT_FONT_FAMILY = '\'Inter\', \'Noto Sans JP\', \'Hiragino Sans\', \'Yu Gothic UI\', \'Segoe UI\', system-ui, sans-serif';

// ---- 文字列サニタイズ ---------------------------------------------------

function collapseWhitespace(value: string): string {
	return value.replace(/\s+/g, ' ').trim();
}

function clampChars(value: string, maxLength: number): string {
	const chars = Array.from(value);
	if (chars.length <= maxLength) return value;
	return chars.slice(0, maxLength).join('') + '…';
}

// ---- 色ユーティリティ ---------------------------------------------------

function rgbToCss(c: RgbColor, alpha = 1): string {
	return `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${alpha})`;
}

function darken(c: RgbColor, amount: number): RgbColor {
	const f = 1 - amount;
	return { r: c.r * f, g: c.g * f, b: c.b * f };
}

function lighten(c: RgbColor, amount: number): RgbColor {
	return {
		r: c.r + (255 - c.r) * amount,
		g: c.g + (255 - c.g) * amount,
		b: c.b + (255 - c.b) * amount,
	};
}

function hashString(str: string): number {
	let h = 2166136261;
	for (let i = 0; i < str.length; i++) {
		h ^= str.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}

function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6D2B79F5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function hslToRgb(h: number, s: number, l: number): RgbColor {
	h = ((h % 360) + 360) % 360;
	const c = (1 - Math.abs(2 * l - 1)) * s;
	const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
	const m = l - c / 2;
	let r1 = 0, g1 = 0, b1 = 0;
	if (h < 60) { r1 = c; g1 = x; } else if (h < 120) { r1 = x; g1 = c; } else if (h < 180) { g1 = c; b1 = x; } else if (h < 240) { g1 = x; b1 = c; } else if (h < 300) { r1 = x; b1 = c; } else { r1 = c; b1 = x; }
	return {
		r: Math.round((r1 + m) * 255),
		g: Math.round((g1 + m) * 255),
		b: Math.round((b1 + m) * 255),
	};
}

/** アートワークが無い場合の art card 用に、文字列から決定論的な 2 色を作る */
export function hashPalette(seed: string): RgbColor[] {
	const h = hashString(seed && seed.length > 0 ? seed : 'nowplaying');
	const hue1 = h % 360;
	const hue2 = (hue1 + 140 + ((h >>> 8) % 40)) % 360;
	const sat = 0.65 + (((h >>> 16) % 20) / 100);
	const light = 0.48 + (((h >>> 4) % 10) / 100);
	return [hslToRgb(hue1, sat, light), hslToRgb(hue2, sat, light * 0.85)];
}

function normalizePalette(colors: RgbColor[] | undefined, seed: string): RgbColor[] {
	if (colors != null && colors.length > 0) return colors;
	return hashPalette(seed);
}

/** 画像を ~32x32 に縮小して getImageData し、近黒/近白を除いた支配色を頻度順に返す */
export function extractDominantColors(ctx: NowPlayingCardContext2D, image: CanvasImageSource, count = 2): RgbColor[] {
	const sampleSize = 32;

	let data: Uint8ClampedArray | Uint8Array | null = null;
	try {
		ctx.save();
		drawCover(ctx, image, 0, 0, sampleSize, sampleSize);
		const imageData = ctx.getImageData(0, 0, sampleSize, sampleSize);
		data = imageData.data;
	} catch {
		data = null;
	} finally {
		ctx.restore();
	}

	if (data == null) return hashPalette('nowplaying').slice(0, count);

	const buckets = new Map<string, { r: number; g: number; b: number; n: number }>();
	for (let i = 0; i < data.length; i += 4) {
		const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!, a = data[i + 3]!;
		if (a < 128) continue;
		const max = Math.max(r, g, b), min = Math.min(r, g, b);
		if (max < 32) continue; // 近黒
		if (min > 224 && max - min < 20) continue; // 近白/近灰
		const key = `${r >> 5}-${g >> 5}-${b >> 5}`; // channel あたり 8 段階に量子化
		const bucket = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0 };
		bucket.r += r; bucket.g += g; bucket.b += b; bucket.n += 1;
		buckets.set(key, bucket);
	}

	const sorted = [...buckets.values()].sort((a, b) => b.n - a.n);
	const colors: RgbColor[] = sorted.slice(0, count).map(b => ({
		r: Math.round(b.r / b.n),
		g: Math.round(b.g / b.n),
		b: Math.round(b.b / b.n),
	}));

	if (colors.length < count) {
		const fallback = hashPalette(colors.length > 0 ? rgbToCss(colors[0]!) : 'nowplaying');
		for (const c of fallback) {
			if (colors.length >= count) break;
			colors.push(c);
		}
	}

	return colors;
}

// ---- 描画ヘルパー ---------------------------------------------------

function roundRectPath(ctx: NowPlayingCardContext2D, x: number, y: number, w: number, h: number, r: number): void {
	ctx.beginPath();
	ctx.roundRect(x, y, w, h, r);
}

function getImageSize(image: any): { width: number; height: number } {
	const width = image?.naturalWidth ?? image?.width ?? 0;
	const height = image?.naturalHeight ?? image?.height ?? 0;
	return { width, height };
}

/** "cover" フィット (中央クロップして dw x dh を隙間なく埋める) で画像を描画する */
function drawCover(ctx: NowPlayingCardContext2D, image: CanvasImageSource, dx: number, dy: number, dw: number, dh: number): void {
	const { width: iw, height: ih } = getImageSize(image);
	if (iw <= 0 || ih <= 0) return;
	const scale = Math.max(dw / iw, dh / ih);
	const sw = dw / scale;
	const sh = dh / scale;
	const sx = (iw - sw) / 2;
	const sy = (ih - sh) / 2;
	ctx.drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh);
}

/** 文字単位で折り返す (日本語のような分かち書きしない言語に対応するため) 。超過分は末尾行を省略記号で切る */
function wrapTextByChar(ctx: NowPlayingCardContext2D, text: string, maxWidth: number, maxLines: number): string[] {
	const chars = Array.from(text);
	if (chars.length === 0 || maxLines <= 0) return [];

	const lines: string[] = [];
	let current = '';
	let idx = 0;
	while (idx < chars.length && lines.length < maxLines) {
		const ch = chars[idx]!;
		const test = current + ch;
		if (current !== '' && ctx.measureText(test).width > maxWidth) {
			lines.push(current);
			current = '';
			continue;
		}
		current = test;
		idx++;
	}
	if (current !== '' && lines.length < maxLines) {
		lines.push(current);
		current = '';
	}

	const overflow = idx < chars.length || current !== '';
	if (overflow && lines.length > 0) {
		let last = lines[lines.length - 1]!;
		while (last.length > 0 && ctx.measureText(last + '…').width > maxWidth) {
			last = last.slice(0, -1);
		}
		lines[lines.length - 1] = last + '…';
	}

	return lines;
}

/**
 * 空白区切りのテキスト (英語など) は単語境界で折り返し、1 単語が幅を超える場合や
 * 空白の無いテキスト (日本語など) は文字単位で折り返す。
 */
function wrapText(ctx: NowPlayingCardContext2D, text: string, maxWidth: number, maxLines: number): string[] {
	if (maxLines <= 0) return [];
	const words = text.split(' ').filter(w => w !== '');
	if (words.length <= 1) return wrapTextByChar(ctx, text, maxWidth, maxLines);

	const lines: string[] = [];
	let current = '';
	let overflow = false;
	for (let i = 0; i < words.length; i++) {
		const word = words[i]!;
		if (lines.length >= maxLines) { overflow = true; break; }
		const test = current === '' ? word : `${current} ${word}`;
		if (ctx.measureText(test).width <= maxWidth) {
			current = test;
			continue;
		}
		if (current !== '') {
			lines.push(current);
			current = '';
			if (lines.length >= maxLines) { overflow = true; break; }
		}
		// 1 単語が行幅を超える場合は文字単位で分割する
		if (ctx.measureText(word).width > maxWidth) {
			const parts = wrapTextByChar(ctx, word, maxWidth, maxLines - lines.length);
			const complete = parts.slice(0, -1);
			lines.push(...complete);
			current = parts[parts.length - 1]?.replace(/…$/, '') ?? '';
			if (lines.length >= maxLines) { overflow = true; break; }
		} else {
			current = word;
		}
	}
	if (!overflow && current !== '') {
		if (lines.length < maxLines) lines.push(current);
		else overflow = true;
	}
	if (overflow && lines.length > 0) {
		let last = lines[lines.length - 1]!.replace(/…$/, '');
		while (last.length > 0 && ctx.measureText(last + '…').width > maxWidth) {
			last = last.slice(0, -1);
		}
		lines[lines.length - 1] = last.trimEnd() + '…';
	}
	return lines;
}

/** 文字ごとに手動で送りを制御して字間を空けて描画する (letterSpacing プロパティに依存しない) */
function fillTextTracked(ctx: NowPlayingCardContext2D, text: string, x: number, y: number, spacing: number): void {
	ctx.textAlign = 'left';
	let cursor = x;
	for (const ch of Array.from(text)) {
		ctx.fillText(ch, cursor, y);
		cursor += ctx.measureText(ch).width + spacing;
	}
}

/** ctx.filter (blur) に対応していればぼかし背景を、非対応なら低解像度描画を拡大してそれっぽく見せる */
function drawBlurredBackground(ctx: NowPlayingCardContext2D, image: CanvasImageSource, w: number, h: number): void {
	let blurApplied = false;
	ctx.save();
	try {
		ctx.filter = 'blur(60px)';
		blurApplied = typeof ctx.filter === 'string' && ctx.filter !== 'none' && ctx.filter !== '';
	} catch {
		blurApplied = false;
	}

	if (blurApplied) {
		// filter の効果が端まで均一になるよう少し大きめにオーバードローする
		drawCover(ctx, image, -80, -80, w + 160, h + 160);
		ctx.restore();
		return;
	}
	ctx.restore();

	// フォールバック: 極小サイズで描画したものを引き伸ばして疑似ぼかしにする
	const lowW = 48;
	const lowH = Math.max(1, Math.round(lowW * (h / w)));
	ctx.save();
	drawCover(ctx, image, 0, 0, lowW, lowH);
	ctx.restore();

	const canvasSource = ctx.canvas;
	if (canvasSource != null) {
		ctx.save();
		ctx.drawImage(canvasSource, 0, 0, lowW, lowH, 0, 0, w, h);
		ctx.restore();
	}
}

function drawArtCard(ctx: NowPlayingCardContext2D, x: number, y: number, size: number, palette: RgbColor[], title: string, fontFamily: string): void {
	const c1 = palette[0]!;
	const c2 = palette[1] ?? lighten(c1, 0.25);

	const grad = ctx.createLinearGradient(x, y, x + size, y + size);
	grad.addColorStop(0, rgbToCss(c1));
	grad.addColorStop(1, rgbToCss(c2));
	ctx.fillStyle = grad;
	ctx.fillRect(x, y, size, size);

	// 右上を起点にした同心円の飾り
	ctx.save();
	ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
	ctx.lineWidth = 3;
	const cx = x + size * 0.82;
	const cy = y + size * 0.18;
	for (let i = 1; i <= 5; i++) {
		ctx.beginPath();
		ctx.arc(cx, cy, i * (size * 0.16), 0, Math.PI * 2);
		ctx.stroke();
	}
	ctx.restore();

	const trimmed = title.trim();
	const glyph = trimmed.length > 0 ? Array.from(trimmed)[0]! : '♪';
	ctx.save();
	ctx.font = `700 ${Math.round(size * 0.5)}px ${fontFamily}`;
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
	ctx.shadowBlur = 24;
	ctx.shadowOffsetY = 6;
	ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
	ctx.fillText(glyph, x + size / 2, y + size / 2 + size * 0.02);
	ctx.restore();
}

function drawLeftPanel(ctx: NowPlayingCardContext2D, input: NowPlayingCardInput, palette: RgbColor[], title: string, fontFamily: string): void {
	const x = 96, y = 80, size = 680, radius = 40;

	// ドロップシャドウ
	ctx.save();
	ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
	ctx.shadowBlur = 60;
	ctx.shadowOffsetY = 24;
	ctx.fillStyle = 'rgba(0, 0, 0, 1)';
	roundRectPath(ctx, x, y, size, size, radius);
	ctx.fill();
	ctx.restore();

	// 本体 (クリップして中に描画)
	ctx.save();
	roundRectPath(ctx, x, y, size, size, radius);
	ctx.clip();
	if (input.artwork != null) {
		drawCover(ctx, input.artwork, x, y, size, size);
	} else {
		drawArtCard(ctx, x, y, size, palette, title, fontFamily);
	}
	ctx.restore();

	// 内側の縁取り
	ctx.save();
	ctx.lineWidth = 2;
	ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
	roundRectPath(ctx, x + 1, y + 1, size - 2, size - 2, radius - 1);
	ctx.stroke();
	ctx.restore();
}

function drawEqualizer(ctx: NowPlayingCardContext2D, rightEdge: number, bottomY: number, color: RgbColor, seedText: string): void {
	const barCount = 14;
	const barWidth = 8;
	const gap = 6;
	const maxHeight = 64;
	const minHeight = 12;
	const totalWidth = barCount * barWidth + (barCount - 1) * gap;
	const startX = rightEdge - totalWidth;
	const rand = mulberry32(hashString(seedText && seedText.length > 0 ? seedText : 'nowplaying'));

	ctx.save();
	ctx.fillStyle = rgbToCss(color, 0.85);
	for (let i = 0; i < barCount; i++) {
		const h = minHeight + rand() * (maxHeight - minHeight);
		const bx = startX + i * (barWidth + gap);
		const by = bottomY - h;
		roundRectPath(ctx, bx, by, barWidth, h, barWidth / 2);
		ctx.fill();
	}
	ctx.restore();
}

function drawRightColumn(
	ctx: NowPlayingCardContext2D,
	texts: { title: string; artist: string | null; serviceLabel: string; footer: string },
	palette: RgbColor[],
	fontFamily: string,
): void {
	const x = 856;
	const right = 1504;
	const colW = right - x;
	const top = 80;
	const bottom = 760;
	const accent = lighten(palette[0]!, 0.15);

	// "NOW PLAYING" ピル (パルスドット + トラッキングを効かせたラベル)
	const dotR = 14;
	const pillY = top + 32;
	ctx.save();
	ctx.fillStyle = rgbToCss(accent);
	ctx.beginPath();
	ctx.arc(x + dotR, pillY, dotR, 0, Math.PI * 2);
	ctx.fill();
	ctx.restore();

	ctx.save();
	ctx.font = `600 34px ${fontFamily}`;
	ctx.textBaseline = 'middle';
	ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
	fillTextTracked(ctx, 'NOW PLAYING', x + dotR * 2 + 20, pillY + 1, 6);
	ctx.restore();

	// タイトル (最大 2 行、はみ出しは省略記号)
	const titleFontSize = 80;
	const titleLineHeight = titleFontSize * 1.15;
	const titleTop = top + 140;
	ctx.save();
	ctx.font = `700 ${titleFontSize}px ${fontFamily}`;
	ctx.textAlign = 'left';
	ctx.textBaseline = 'alphabetic';
	ctx.fillStyle = '#ffffff';
	const titleLines = wrapText(ctx, texts.title, colW, 2);
	titleLines.forEach((line, i) => {
		ctx.fillText(line, x, titleTop + titleLineHeight * (i + 1) - titleFontSize * 0.2);
	});
	ctx.restore();

	let cursorY = titleTop + titleLineHeight * Math.max(titleLines.length, 1) + 24;

	// アーティスト (1 行、はみ出しは省略記号)
	if (texts.artist != null && texts.artist !== '') {
		const artistFontSize = 44;
		ctx.save();
		ctx.font = `500 ${artistFontSize}px ${fontFamily}`;
		ctx.textAlign = 'left';
		ctx.textBaseline = 'alphabetic';
		ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
		const [artistLine] = wrapText(ctx, texts.artist, colW, 1);
		ctx.fillText(artistLine ?? '', x, cursorY + artistFontSize * 0.85);
		ctx.restore();
		cursorY += artistFontSize * 1.5;
	}

	// サービス名ピル (輪郭のみ)
	if (texts.serviceLabel !== '') {
		const serviceFontSize = 32;
		const paddingX = 28;
		const pillHeight = 56;
		ctx.save();
		ctx.font = `600 ${serviceFontSize}px ${fontFamily}`;
		const serviceWidth = ctx.measureText(texts.serviceLabel).width;
		const pillWidth = serviceWidth + paddingX * 2;
		const pillTop = cursorY + 16;
		ctx.lineWidth = 2;
		ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
		roundRectPath(ctx, x, pillTop, pillWidth, pillHeight, pillHeight / 2);
		ctx.stroke();
		ctx.textAlign = 'left';
		ctx.textBaseline = 'middle';
		ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
		ctx.fillText(texts.serviceLabel, x + paddingX, pillTop + pillHeight / 2 + 1);
		ctx.restore();
	}

	// 右下: イコライザー風の装飾
	drawEqualizer(ctx, right, bottom, accent, texts.title);

	// 左下: フッター (インスタンスホストなど)
	if (texts.footer !== '') {
		ctx.save();
		ctx.font = `400 28px ${fontFamily}`;
		ctx.textAlign = 'left';
		ctx.textBaseline = 'alphabetic';
		ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
		ctx.fillText(texts.footer, x, bottom);
		ctx.restore();
	}
}

/**
 * NowPlaying カード画像を ctx に描画する。DOM / Vue への依存は無く、ブラウザの
 * CanvasRenderingContext2D、@napi-rs/canvas の SKRSContext2D のどちらでも動く。
 */
export function renderNowPlayingCard(ctx: NowPlayingCardContext2D, input: NowPlayingCardInput): void {
	const { width: W, height: H } = NOW_PLAYING_CARD_SIZE;
	const fontFamily = input.fontFamily ?? DEFAULT_FONT_FAMILY;

	const title = clampChars(collapseWhitespace(input.title), 120) || '♪';
	const artist = input.artist != null ? clampChars(collapseWhitespace(input.artist), 80) : null;
	const serviceLabel = clampChars(collapseWhitespace(input.serviceLabel), 40);
	const footer = clampChars(collapseWhitespace(input.footer), 60);

	const paletteSeed = title || artist || serviceLabel || 'nowplaying';
	const palette = normalizePalette(input.artworkColors, paletteSeed);

	ctx.save();
	roundRectPath(ctx, 0, 0, W, H, 48);
	ctx.clip();

	if (input.artwork != null) {
		drawBlurredBackground(ctx, input.artwork, W, H);

		const overlay = ctx.createLinearGradient(0, 0, W, 0);
		overlay.addColorStop(0, 'rgba(12, 12, 20, 0.55)');
		overlay.addColorStop(1, 'rgba(12, 12, 20, 0.88)');
		ctx.fillStyle = overlay;
		ctx.fillRect(0, 0, W, H);

		const highlight = ctx.createLinearGradient(0, 0, W, H);
		highlight.addColorStop(0, 'rgba(255, 255, 255, 0.06)');
		highlight.addColorStop(0.4, 'rgba(255, 255, 255, 0)');
		highlight.addColorStop(1, 'rgba(255, 255, 255, 0)');
		ctx.fillStyle = highlight;
		ctx.fillRect(0, 0, W, H);
	} else {
		const c1 = palette[0]!;
		const c2 = palette[1] ?? darken(c1, 0.4);
		const bg = ctx.createLinearGradient(0, 0, W, H);
		bg.addColorStop(0, rgbToCss(darken(c1, 0.35)));
		bg.addColorStop(1, rgbToCss(darken(c2, 0.55)));
		ctx.fillStyle = bg;
		ctx.fillRect(0, 0, W, H);

		const glow = ctx.createRadialGradient(W * 0.75, H * 0.25, 0, W * 0.75, H * 0.25, W * 0.6);
		glow.addColorStop(0, rgbToCss(c1, 0.35));
		glow.addColorStop(1, rgbToCss(c1, 0));
		ctx.fillStyle = glow;
		ctx.fillRect(0, 0, W, H);
	}

	drawLeftPanel(ctx, input, palette, title, fontFamily);
	drawRightColumn(ctx, { title, artist, serviceLabel, footer }, palette, fontFamily);

	ctx.restore();
}
