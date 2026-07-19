/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export function SubtitlesPage() {
	return (
		<>
			{'<!DOCTYPE html>'}
			<html>
				<head>
					<meta charset="UTF-8" />
					<meta name="viewport" content="width=device-width, initial-scale=1.0" />
					<meta name="application-name" content="Misskey" />
					<meta name="robots" content="noindex, nofollow" />
					<title>Misskey Live Subtitles</title>
					<link rel="stylesheet" href="/static-assets/misc/subtitles.css" />
				</head>

				<body>
					<div id="stage">
						<div id="box" class="st-box">
							<div id="original" class="st-line st-original"></div>
							<div id="translation" class="st-line st-translation"></div>
						</div>
					</div>
					<script src="/static-assets/misc/subtitles.js"></script>
				</body>
			</html>
		</>
	);
}
