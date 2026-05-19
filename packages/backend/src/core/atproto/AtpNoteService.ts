/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { NotesRepository, UsersRepository } from '@/models/_.js';
import type { MiNote } from '@/models/Note.js';
import type { MiRemoteUser } from '@/models/User.js';
import { NoteCreateService } from '@/core/NoteCreateService.js';
import { NoteDeleteService } from '@/core/NoteDeleteService.js';
import { bindThis } from '@/decorators.js';
import type Logger from '@/logger.js';
import { AtpLoggerService } from './AtpLoggerService.js';
import { AtpHttpClientService } from './AtpHttpClientService.js';
import { AtpPersonService } from './AtpPersonService.js';

// Bsky lexicon の最小型 (必要 field のみ)。
type BskyFacetFeature =
	| { $type: 'app.bsky.richtext.facet#link'; uri: string }
	| { $type: 'app.bsky.richtext.facet#mention'; did: string }
	| { $type: 'app.bsky.richtext.facet#tag'; tag: string };

type BskyFacet = {
	index: { byteStart: number; byteEnd: number };
	features: BskyFacetFeature[];
};

type BskyStrongRef = { uri: string; cid?: string };

type BskyEmbedImage = {
	alt?: string;
	image?: { ref?: { $link?: string }; mimeType?: string };
	aspectRatio?: { width: number; height: number };
};

type BskyEmbed =
	| { $type: 'app.bsky.embed.images'; images: BskyEmbedImage[] }
	| { $type: 'app.bsky.embed.external'; external: { uri: string; title?: string; description?: string } }
	| { $type: 'app.bsky.embed.record'; record: BskyStrongRef }
	| { $type: 'app.bsky.embed.recordWithMedia'; record: { record: BskyStrongRef }; media: BskyEmbed };

type BskyPostRecord = {
	$type?: 'app.bsky.feed.post';
	text: string;
	createdAt?: string;
	facets?: BskyFacet[];
	reply?: { root: BskyStrongRef; parent: BskyStrongRef };
	embed?: BskyEmbed;
	langs?: string[];
};

type BskyRepostRecord = {
	$type?: 'app.bsky.feed.repost';
	subject: BskyStrongRef;
	createdAt?: string;
};

// app.bsky.feed.getAuthorFeed の応答 (必要 field のみ)。
type BskyFeedItem = {
	post?: {
		uri: string;
		cid?: string;
		author?: { did: string };
		record?: unknown;
		indexedAt?: string;
	};
	// repost の場合 reason が付く。backfill では skip して original 投稿のみ取り込む
	// (repost は forward Jetstream に任せる)。
	reason?: { $type: string };
};

type BskyAuthorFeedResponse = {
	feed?: BskyFeedItem[];
	cursor?: string;
};

const POST_COLLECTION = 'app.bsky.feed.post';
const REPOST_COLLECTION = 'app.bsky.feed.repost';

const BACKFILL_DEFAULT_CUTOFF_MS = 30 * 24 * 60 * 60 * 1000; // 30 日
const BACKFILL_PAGE_LIMIT = 100;
const BACKFILL_MAX_PAGES = 20; // safety: 最大 2000 件まで遡る

@Injectable()
export class AtpNoteService {
	private logger: Logger;

	constructor(
		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		@Inject(DI.notesRepository)
		private notesRepository: NotesRepository,

		private noteCreateService: NoteCreateService,
		private noteDeleteService: NoteDeleteService,
		private atpLoggerService: AtpLoggerService,
		private atpHttpClientService: AtpHttpClientService,
		private atpPersonService: AtpPersonService,
	) {
		this.logger = this.atpLoggerService.child('note');
	}

	@bindThis
	public async ingestPost(did: string, rkey: string, raw: Record<string, unknown>): Promise<MiNote | null> {
		const record = raw as BskyPostRecord;
		if (typeof record.text !== 'string') {
			this.logger.debug(`ingestPost skipped (no text): ${did}/${rkey}`);
			return null;
		}

		const uri = this.buildPostUri(did, rkey);

		// 既存ノートがあればスキップ (Jetstream のリトライ / update イベント対策)
		const existing = await this.notesRepository.findOneBy({ uri });
		if (existing != null) {
			this.logger.debug(`ingestPost dedup hit: ${uri}`);
			return existing;
		}

		const author = await this.atpPersonService.resolveByDid(did);

		const text = this.renderText(record);
		const replyParentUri = record.reply?.parent.uri ?? null;
		const reply = replyParentUri ? await this.lookupNoteByUri(replyParentUri) : null;
		if (replyParentUri != null && reply == null) {
			this.logger.debug(`ingestPost: reply parent ${replyParentUri} not yet in DB, posting as standalone`);
		}
		const createdAt = record.createdAt ? new Date(record.createdAt) : null;
		const url = this.buildWebUrl(author, rkey);

		try {
			const created = await this.noteCreateService.create(author, {
				createdAt,
				text: text.length > 0 ? text : null,
				reply,
				visibility: 'public',
				localOnly: false,
				uri,
				url,
			});
			this.logger.info(`ingestPost created: noteId=${created.id} user=@${author.username} uri=${uri} textLen=${text.length}${reply ? ' reply=Y' : ''}`);
			return created;
		} catch (e) {
			if ((e as { name?: string }).name === 'duplicated') {
				this.logger.debug(`ingestPost duplicate (race): ${uri}`);
				return await this.lookupNoteByUri(uri);
			}
			throw e;
		}
	}

	@bindThis
	public async ingestRepost(did: string, rkey: string, raw: Record<string, unknown>): Promise<MiNote | null> {
		const record = raw as BskyRepostRecord;
		if (record.subject?.uri == null) {
			this.logger.debug(`ingestRepost skipped (no subject): ${did}/${rkey}`);
			return null;
		}

		const uri = this.buildRepostUri(did, rkey);
		const existing = await this.notesRepository.findOneBy({ uri });
		if (existing != null) {
			this.logger.debug(`ingestRepost dedup hit: ${uri}`);
			return existing;
		}

		const subjectNote = await this.lookupNoteByUri(record.subject.uri);
		if (subjectNote == null) {
			// 対象ポストが未取り込みの場合は skip (将来 backfill 実装で対応)
			this.logger.info(`ingestRepost skipped: subject ${record.subject.uri} not in DB (need backfill)`);
			return null;
		}

		const author = await this.atpPersonService.resolveByDid(did);
		const createdAt = record.createdAt ? new Date(record.createdAt) : null;

		try {
			const created = await this.noteCreateService.create(author, {
				createdAt,
				renote: subjectNote,
				visibility: 'public',
				localOnly: false,
				uri,
			});
			this.logger.info(`ingestRepost created: noteId=${created.id} user=@${author.username} renoteId=${subjectNote.id}`);
			return created;
		} catch (e) {
			if ((e as { name?: string }).name === 'duplicated') {
				this.logger.debug(`ingestRepost duplicate (race): ${uri}`);
				return await this.lookupNoteByUri(uri);
			}
			throw e;
		}
	}

	/**
	 * follow 時に直近 N 日分の post を AppView (`app.bsky.feed.getAuthorFeed`) から
	 * reverse-chronological に取って ingestPost に流す。cutoff 越え or feed 終端で停止。
	 * 既存 note は ingestPost 内で uri lookup によって dedup される。
	 * repost (item.reason 付き) は skip — forward Jetstream に任せる。
	 */
	@bindThis
	public async backfillAuthorFeed(
		did: string,
		opts: { cutoffMs?: number } = {},
	): Promise<{ scanned: number; ingested: number; pagesRequested: number; reachedCutoff: boolean }> {
		const cutoffMs = opts.cutoffMs ?? BACKFILL_DEFAULT_CUTOFF_MS;
		const cutoffTs = Date.now() - cutoffMs;
		let scanned = 0;
		let ingested = 0;
		let cursor: string | undefined;
		let pagesRequested = 0;
		let reachedCutoff = false;

		this.logger.info(`backfill start: did=${did} cutoffDays=${(cutoffMs / 86400000).toFixed(1)}`);

		while (pagesRequested < BACKFILL_MAX_PAGES) {
			pagesRequested += 1;
			let page: BskyAuthorFeedResponse;
			try {
				page = await this.atpHttpClientService.xrpcGet<BskyAuthorFeedResponse>(
					'app.bsky.feed.getAuthorFeed',
					{ actor: did, limit: BACKFILL_PAGE_LIMIT, cursor },
				);
			} catch (e) {
				this.logger.warn(`backfill getAuthorFeed failed: did=${did} page=${pagesRequested} err=${e instanceof Error ? e.message : String(e)}`);
				break;
			}
			const items = page.feed ?? [];
			if (items.length === 0) break;

			for (const item of items) {
				scanned += 1;
				// repost (= 他人の post の再放流) は backfill では skip。Jetstream の forward に任せる。
				if (item.reason != null) continue;
				const post = item.post;
				if (post == null || post.author?.did !== did) continue;
				const record = post.record as BskyPostRecord | undefined;
				if (record == null) continue;
				const createdAtTs = record.createdAt ? new Date(record.createdAt).getTime() : 0;
				if (createdAtTs > 0 && createdAtTs < cutoffTs) {
					reachedCutoff = true;
					break;
				}
				const rkey = post.uri.split('/').pop();
				if (!rkey) continue;
				try {
					const result = await this.ingestPost(did, rkey, record as unknown as Record<string, unknown>);
					if (result != null) ingested += 1;
				} catch (e) {
					this.logger.warn(`backfill ingest failed: ${post.uri} ${e instanceof Error ? e.message : String(e)}`);
				}
			}

			if (reachedCutoff) break;
			cursor = page.cursor;
			if (cursor == null) break;
		}

		this.logger.info(`backfill done: did=${did} scanned=${scanned} ingested=${ingested} pages=${pagesRequested} reachedCutoff=${reachedCutoff}`);
		return { scanned, ingested, pagesRequested, reachedCutoff };
	}

	@bindThis
	public async deletePost(did: string, rkey: string): Promise<void> {
		await this.deleteByUri(did, this.buildPostUri(did, rkey));
	}

	@bindThis
	public async deleteRepost(did: string, rkey: string): Promise<void> {
		await this.deleteByUri(did, this.buildRepostUri(did, rkey));
	}

	@bindThis
	private async deleteByUri(did: string, uri: string): Promise<void> {
		const note = await this.notesRepository.findOneBy({ uri });
		if (note == null) {
			this.logger.debug(`delete: note not found in DB (already gone or never ingested): ${uri}`);
			return;
		}

		const author = await this.usersRepository.findOneBy({ atDid: did }) as MiRemoteUser | null;
		if (author == null) {
			this.logger.warn(`delete: author user not found for did=${did}`);
			return;
		}
		await this.noteDeleteService.delete(author, note);
		this.logger.info(`deleted note: noteId=${note.id} uri=${uri}`);
	}

	@bindThis
	private async lookupNoteByUri(uri: string): Promise<MiNote | null> {
		return await this.notesRepository.findOneBy({ uri });
	}

	@bindThis
	private buildPostUri(did: string, rkey: string): string {
		return `at://${did}/${POST_COLLECTION}/${rkey}`;
	}

	@bindThis
	private buildRepostUri(did: string, rkey: string): string {
		return `at://${did}/${REPOST_COLLECTION}/${rkey}`;
	}

	@bindThis
	private buildWebUrl(author: MiRemoteUser, rkey: string): string {
		// https://bsky.app/profile/<handle>/post/<rkey>
		return `https://bsky.app/profile/${author.username}/post/${rkey}`;
	}

	/**
	 * Bsky の text + facets + embed を MFM 風文字列に組み立てる。
	 * facets は UTF-8 byte offset なので、TextEncoder で byte 列に直してから
	 * 後ろのほうから置換し、最後に文字列へ戻す。
	 */
	@bindThis
	private renderText(record: BskyPostRecord): string {
		const text = record.text ?? '';
		const replacedFacets = this.applyFacets(text, record.facets ?? []);
		const trailers = this.renderEmbedTrailers(record.embed);
		return [replacedFacets, ...trailers].filter(s => s.length > 0).join('\n\n');
	}

	@bindThis
	private applyFacets(text: string, facets: BskyFacet[]): string {
		if (facets.length === 0) return text;

		const encoder = new TextEncoder();
		const decoder = new TextDecoder();
		const bytes = encoder.encode(text);

		// byteStart 降順で安全に置換していく。
		const sorted = [...facets].sort((a, b) => b.index.byteStart - a.index.byteStart);

		let buffer: Uint8Array = bytes;
		for (const f of sorted) {
			const start = f.index.byteStart;
			const end = f.index.byteEnd;
			if (start < 0 || end > buffer.length || start >= end) continue;
			const segmentBytes = buffer.slice(start, end);
			const segment = decoder.decode(segmentBytes);
			const replacement = this.formatFacet(segment, f.features);
			const replacementBytes = encoder.encode(replacement);

			const merged = new Uint8Array(buffer.length - (end - start) + replacementBytes.length);
			merged.set(buffer.slice(0, start), 0);
			merged.set(replacementBytes, start);
			merged.set(buffer.slice(end), start + replacementBytes.length);
			buffer = merged;
		}
		return decoder.decode(buffer);
	}

	@bindThis
	private formatFacet(segment: string, features: BskyFacetFeature[]): string {
		// 1 facet に複数 feature が乗ることがある。優先順位は link > mention > tag。
		for (const feat of features) {
			if (feat.$type === 'app.bsky.richtext.facet#link') {
				return segment === feat.uri ? feat.uri : `[${segment}](${feat.uri})`;
			}
		}
		for (const feat of features) {
			if (feat.$type === 'app.bsky.richtext.facet#mention') {
				// Bsky DID は MFM mention に直接マップできない。@<handle>@bsky.social として
				// 残し、後から resolve できればクリック可になる (Phase 後続)。
				return segment.startsWith('@') ? `${segment}@bsky.social` : `@${segment}@bsky.social`;
			}
		}
		for (const feat of features) {
			if (feat.$type === 'app.bsky.richtext.facet#tag') {
				return segment.startsWith('#') ? segment : `#${segment}`;
			}
		}
		return segment;
	}

	@bindThis
	private renderEmbedTrailers(embed: BskyEmbed | undefined): string[] {
		if (embed == null) return [];
		switch (embed.$type) {
			case 'app.bsky.embed.external':
				return [embed.external.uri];
			case 'app.bsky.embed.images':
				return [];
			case 'app.bsky.embed.record':
				return [this.atUriToWebUrl(embed.record.uri) ?? embed.record.uri];
			case 'app.bsky.embed.recordWithMedia':
				return [this.atUriToWebUrl(embed.record.record.uri) ?? embed.record.record.uri];
			default:
				return [];
		}
	}

	@bindThis
	private atUriToWebUrl(uri: string): string | null {
		// at://did:plc:.../app.bsky.feed.post/<rkey> → https://bsky.app/profile/<did>/post/<rkey>
		const m = uri.match(/^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/]+)$/);
		if (m == null) return null;
		return `https://bsky.app/profile/${m[1]}/post/${m[2]}`;
	}
}
