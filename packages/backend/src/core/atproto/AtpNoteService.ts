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

// 並列度制限。50 アカウントを一気に follow しても AppView / Postgres に対する並列実行数を
// この値以下に抑える。超過分は内部 FIFO queue に積まれて順次消化される。
// BullMQ への置換も検討したが、Misskey の既存 queue モジュールに乗せるオーバーヘッドより
// in-memory semaphore で十分 (process 再起動で job が失われるが、follow 状態は DB に
// 残っているので /api/atproto/backfill で人手再 trigger できる)。
const BACKFILL_MAX_PARALLEL = 2;

@Injectable()
export class AtpNoteService {
	private logger: Logger;

	// in-memory FIFO queue with concurrency limit for backfill jobs.
	// inflight が BACKFILL_MAX_PARALLEL に達したら waiters に積まれ、先行 job が完了したら次が走る。
	private backfillInflight = 0;
	private backfillWaiters: Array<() => void> = [];

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
	private async acquireBackfillSlot(): Promise<void> {
		if (this.backfillInflight < BACKFILL_MAX_PARALLEL) {
			this.backfillInflight += 1;
			return;
		}
		await new Promise<void>(resolve => this.backfillWaiters.push(resolve));
		this.backfillInflight += 1;
	}

	@bindThis
	private releaseBackfillSlot(): void {
		this.backfillInflight -= 1;
		const next = this.backfillWaiters.shift();
		if (next != null) next();
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

		// Quote post (app.bsky.embed.record / recordWithMedia) を Misskey の renote として
		// 取り込む。subject post が AppView で fetch でき、かつ post collection の場合のみ。
		// list / feed generator / starter pack 等は対象外で、trailer URL fallback に任せる。
		const quoteSubjectUri = this.extractQuoteSubjectUri(record.embed);
		const renote = quoteSubjectUri != null
			? await this.fetchOrIngestPostByUri(quoteSubjectUri)
			: null;

		// renote として取り込めた場合、embed trailer から quote 用 URL を抑止する
		// (Misskey の renote 表示で subject を見せるので二重表示にしないため)。
		const text = this.renderText(record, { suppressQuoteTrailer: renote != null });
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
				renote,
				visibility: 'public',
				localOnly: false,
				uri,
				url,
			});
			this.logger.info(`ingestPost created: noteId=${created.id} user=@${author.username} uri=${uri} textLen=${text.length}${reply ? ' reply=Y' : ''}${renote ? ` quote=${renote.id}` : ''}`);
			return created;
		} catch (e) {
			if ((e as { name?: string }).name === 'duplicated') {
				this.logger.debug(`ingestPost duplicate (race): ${uri}`);
				return await this.lookupNoteByUri(uri);
			}
			throw e;
		}
	}

	/**
	 * embed が record / recordWithMedia の場合に subject post の AT-URI を返す。
	 * post collection に限定する (list / feedgen 等は null)。
	 */
	@bindThis
	private extractQuoteSubjectUri(embed: BskyEmbed | undefined): string | null {
		if (embed == null) return null;
		const subjectUri =
			embed.$type === 'app.bsky.embed.record' ? embed.record.uri :
			embed.$type === 'app.bsky.embed.recordWithMedia' ? embed.record.record.uri :
			null;
		if (subjectUri == null) return null;
		const parsed = this.parseAtUri(subjectUri);
		if (parsed == null || parsed.collection !== POST_COLLECTION) return null;
		return subjectUri;
	}

	@bindThis
	private parseAtUri(uri: string): { did: string; collection: string; rkey: string } | null {
		if (!uri.startsWith('at://')) return null;
		const rest = uri.slice('at://'.length);
		const parts = rest.split('/');
		if (parts.length < 3) return null;
		const [didPart, collectionPart, ...rkeyParts] = parts;
		if (!didPart || !collectionPart || rkeyParts.length === 0) return null;
		return { did: didPart, collection: collectionPart, rkey: rkeyParts.join('/') };
	}

	/**
	 * AT-URI で identify される Bsky post を、既に DB にあればそれを、無ければ AppView
	 * (com.atproto.repo.getRecord) から取得して ingest する。recursive な quote chain は
	 * 段数 1 までに抑える (ingestPost 内で再度 quote ingest が走るのを防ぐため、
	 * fetchOrIngestPostByUri からの呼び出しでは embed.record を fetch しない仕様)。
	 *
	 * 注: ここでは ingestPost(本体) を呼ぶので、subject post 自体の embed が更に quote
	 * を持つ場合、ingest 時に再帰的に解決されうる。深い chain は AppView 負荷を考えて
	 * 将来 max-depth で抑える検討の余地あり (現状は 1-2 段が実用 ceiling)。
	 */
	@bindThis
	private async fetchOrIngestPostByUri(uri: string): Promise<MiNote | null> {
		const existing = await this.lookupNoteByUri(uri);
		if (existing != null) return existing;

		const parsed = this.parseAtUri(uri);
		if (parsed == null || parsed.collection !== POST_COLLECTION) return null;

		try {
			const response = await this.atpHttpClientService.xrpcGet<{
				uri: string;
				cid: string;
				value: Record<string, unknown>;
			}>('com.atproto.repo.getRecord', {
				repo: parsed.did,
				collection: parsed.collection,
				rkey: parsed.rkey,
			});
			return await this.ingestPost(parsed.did, parsed.rkey, response.value);
		} catch (e) {
			this.logger.warn(`fetchOrIngestPostByUri failed for ${uri}: ${e instanceof Error ? e.message : String(e)}`);
			return null;
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

		// 対象 post が DB に無い場合、AppView から fetch して ingest する (renote 整合性を維持)。
		// 失敗時のみ skip。
		const subjectNote = await this.fetchOrIngestPostByUri(record.subject.uri);
		if (subjectNote == null) {
			this.logger.info(`ingestRepost skipped: subject ${record.subject.uri} could not be fetched`);
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
		await this.acquireBackfillSlot();
		try {
			return await this.backfillAuthorFeedInternal(did, opts);
		} finally {
			this.releaseBackfillSlot();
		}
	}

	@bindThis
	private async backfillAuthorFeedInternal(
		did: string,
		opts: { cutoffMs?: number },
	): Promise<{ scanned: number; ingested: number; pagesRequested: number; reachedCutoff: boolean }> {
		const cutoffMs = opts.cutoffMs ?? BACKFILL_DEFAULT_CUTOFF_MS;
		const cutoffTs = Date.now() - cutoffMs;
		let scanned = 0;
		let ingested = 0;
		let cursor: string | undefined;
		let pagesRequested = 0;
		let reachedCutoff = false;

		this.logger.info(`backfill start: did=${did} cutoffDays=${(cutoffMs / 86400000).toFixed(1)} (inflight=${this.backfillInflight}/${BACKFILL_MAX_PARALLEL})`);

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
	 *
	 * suppressQuoteTrailer = true のとき、embed が record / recordWithMedia でも
	 * その quote 用 URL trailer を出さない (renote 経由で表示するため重複回避)。
	 */
	@bindThis
	private renderText(record: BskyPostRecord, opts: { suppressQuoteTrailer?: boolean } = {}): string {
		const text = record.text ?? '';
		const replacedFacets = this.applyFacets(text, record.facets ?? []);
		const trailers = this.renderEmbedTrailers(record.embed, opts);
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
	private renderEmbedTrailers(embed: BskyEmbed | undefined, opts: { suppressQuoteTrailer?: boolean } = {}): string[] {
		if (embed == null) return [];
		switch (embed.$type) {
			case 'app.bsky.embed.external':
				return [embed.external.uri];
			case 'app.bsky.embed.images':
				return [];
			case 'app.bsky.embed.record':
				if (opts.suppressQuoteTrailer) return [];
				return [this.atUriToWebUrl(embed.record.uri) ?? embed.record.uri];
			case 'app.bsky.embed.recordWithMedia':
				if (opts.suppressQuoteTrailer) return [];
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
