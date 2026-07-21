/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { bindThis } from '@/decorators.js';
import type Logger from '@/logger.js';
import { GoogleLoggerService } from '@/core/google/GoogleLoggerService.js';
import { GoogleOAuthService, GoogleOAuthCallbackError } from '@/core/google/GoogleOAuthService.js';
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';

// Google OAuth 同意画面の検証用ホームページ (未ログインで閲覧可能、アプリ名は OAuth 同意画面の
// 構成と完全一致させること: MixerStreamJP)。
const ABOUT_PAGE_HTML = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MixerStreamJP</title>
<meta name="description" content="MixerStreamJP は、Misskey インスタンス mi.msjp.pro が提供する独自ライブ配信機能です。配信終了後、配信者本人の Google Drive に録画を自動アーカイブし、視聴者がチャンネルページから再生できるようにします。">
<style>
  body { font-family: system-ui, -apple-system, "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif; max-width: 640px; margin: 48px auto; padding: 0 20px; line-height: 1.8; color: #1a1a2e; }
  h1 { font-size: 1.6em; margin-bottom: 0.2em; }
  .sub { color: #666; margin-bottom: 2em; }
  h2 { font-size: 1.1em; margin-top: 2em; }
  ul { padding-left: 1.4em; }
  a { color: #2563eb; }
  .card { background: #f5f7fb; border-radius: 12px; padding: 20px 24px; margin: 1.5em 0; }
</style>
</head>
<body>
  <h1>MixerStreamJP</h1>
  <p class="sub">Misskey インスタンス <a href="https://mi.msjp.pro/">mi.msjp.pro</a> が提供する独自ライブ配信機能です。</p>

  <p>MixerStreamJP は、配信者が OBS 等から直接配信できる独自ライブ配信基盤 (WHIP/WebRTC) と、
  視聴者向けのチャンネルページ・コメント機能を提供します。</p>

  <h2>Google アカウント連携の目的</h2>
  <div class="card">
    <p>配信終了後、録画を配信者本人が指定した Google Drive アカウントへ自動でアップロードし、
    そのアーカイブをチャンネルページから再生できるようにする「配信アーカイブ」機能のために、
    Google アカウントとの連携を行っています。</p>
    <ul>
      <li>アクセスするのは <strong>MixerStreamJP がアップロードしたファイルのみ</strong> です
        (<code>drive.file</code> スコープ、Drive 内の既存ファイルには一切アクセスしません)。</li>
      <li>アップロードした録画ファイルの共有設定 (リンクを知っている人が閲覧可) を行い、
        配信者本人のチャンネルページへの埋め込み再生を可能にします。</li>
      <li>連携はいつでも <a href="https://mi.msjp.pro/settings/streaming">配信設定ページ</a> から解除できます。</li>
    </ul>
  </div>

  <h2>運営者</h2>
  <p>mi.msjp.pro は個人が運営する小規模インスタンスです。連絡先・利用規約・プライバシーポリシーは
  <a href="https://mi-legal.msjp.pro/contact.html">こちら</a>を参照してください。</p>
</body>
</html>
`;

// Google OAuth の redirect URI: GET {url}/google-drive/oauth/callback
// (/api 配下は POST 前提の API サーバーなので、ブラウザリダイレクトを受けるルートはここに置く)
@Injectable()
export class GoogleDriveServerService {
	private logger: Logger;

	constructor(
		private googleOAuthService: GoogleOAuthService,
		private googleLoggerService: GoogleLoggerService,
	) {
		this.logger = this.googleLoggerService.child('server');
	}

	@bindThis
	public createServer(fastify: FastifyInstance, options: FastifyPluginOptions, done: (err?: Error) => void) {
		// Google OAuth 同意画面の検証用ホームページ。未ログインで内容が見えること・アプリの目的が
		// 説明されていること・OAuth 側のアプリ名 (MixerStreamJP) と一致することが Google の要求事項。
		// SPA (mi.msjp.pro トップ) は entrancePageStyle=classic のためログイン画面が表示されてしまい
		// 要件を満たせないので、認証不要の静的 HTML を専用ルートで返す。
		fastify.get('/about', async (request, reply) => {
			reply.type('text/html; charset=utf-8');
			return ABOUT_PAGE_HTML;
		});

		fastify.get<{
			Querystring: { code?: string; state?: string; error?: string; error_description?: string };
		}>('/oauth/callback', async (request, reply) => {
			const settingsUrl = '/settings/streaming';

			if (!this.googleOAuthService.isEnabled) {
				reply.code(404);
				return;
			}

			const { code, state, error } = request.query;

			if (error != null || code == null || state == null) {
				// ユーザーが認可画面で拒否した場合など
				this.logger.info(`oauth callback denied: ${error ?? 'missing params'}`);
				return await reply.redirect(`${settingsUrl}?googleDriveResult=denied`);
			}

			try {
				const target = await this.googleOAuthService.handleCallback(code, state);
				return await reply.redirect(`${settingsUrl}?googleDriveResult=${target === 'youtube' ? 'youtubeLinked' : 'linked'}`);
			} catch (err) {
				if (err instanceof GoogleOAuthCallbackError) {
					this.logger.warn(`oauth callback rejected: ${err.message}`);
					return await reply.redirect(`${settingsUrl}?googleDriveResult=error&reason=${encodeURIComponent(err.message)}`);
				}
				this.logger.error(`oauth callback failed: ${err instanceof Error ? err.message : err}`);
				return await reply.redirect(`${settingsUrl}?googleDriveResult=error`);
			}
		});

		done();
	}
}
