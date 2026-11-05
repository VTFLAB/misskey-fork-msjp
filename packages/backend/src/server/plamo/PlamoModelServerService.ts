/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { bindThis } from '@/decorators.js';
import { PLAMO_MODEL, PlamoModelService } from '@/core/plamo/PlamoModelService.js';
import { AuthenticateService, AuthenticationError } from '@/server/api/AuthenticateService.js';
import type { FastifyInstance, FastifyPluginOptions, FastifyRequest } from 'fastify';

// 端末内翻訳 (PLaMo 3 Translate) のモデルを配信するルート (bsky-fork 独自)。
// route: GET {url}/plamo-model/<revision>/<file>  (Authorization: Bearer <Misskey access token>)
// - 翻訳はログイン中のユーザーだけが使うので、配信もアクセストークンを持つユーザーに限る
//   (誰でも 573MB を何度も取れると、回線を浪費される)
// - 決め打ちのモデル (PLAMO_MODEL) だけを返す。それ以外のパスは 404
// - サーバーがまだ取得していなければ 503 (フロントエンドは他の翻訳に切り替える)
// - 中身は revision ごとに変わらないので長期間キャッシュさせる (認証付きなので private)。Range にも応える
@Injectable()
export class PlamoModelServerService {
	constructor(
		private plamoModelService: PlamoModelService,
		private authenticateService: AuthenticateService,
	) {
	}

	private async isSignedIn(request: FastifyRequest): Promise<boolean> {
		const authorization = request.headers.authorization;
		if (authorization == null || !authorization.startsWith('Bearer ')) return false;
		try {
			const [user] = await this.authenticateService.authenticate(authorization.slice('Bearer '.length));
			return user != null;
		} catch (err) {
			if (err instanceof AuthenticationError) return false;
			throw err;
		}
	}

	@bindThis
	public createServer(fastify: FastifyInstance, options: FastifyPluginOptions, done: (err?: Error) => void) {
		fastify.get<{
			Params: { revision: string; file: string };
		}>('/:revision/:file', async (request, reply) => {
			if (request.params.revision !== PLAMO_MODEL.revision || request.params.file !== PLAMO_MODEL.file) {
				reply.code(404);
				return;
			}
			if (!(await this.isSignedIn(request))) {
				reply.code(401);
				reply.header('Cache-Control', 'no-store');
				return;
			}
			if (!this.plamoModelService.isReady()) {
				reply.code(503);
				reply.header('Retry-After', '600');
				reply.header('Cache-Control', 'no-store');
				return;
			}
			reply.header('Content-Type', 'application/octet-stream');
			reply.header('Cache-Control', 'private, max-age=31536000, immutable');
			return reply.sendFile(PLAMO_MODEL.file, this.plamoModelService.getModelDir(), {
				cacheControl: false,
				acceptRanges: true,
			});
		});

		done();
	}
}
