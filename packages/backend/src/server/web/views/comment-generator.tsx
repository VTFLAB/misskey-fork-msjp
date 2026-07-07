/*
 * SPDX-FileCopyrightText: misskey-bsky-integration fork
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export function CommentGeneratorPage() {
	return (
		<>
			{'<!DOCTYPE html>'}
			<html>
				<head>
					<meta charset="UTF-8" />
					<meta name="viewport" content="width=device-width, initial-scale=1.0" />
					<meta name="application-name" content="Misskey" />
					<meta name="robots" content="noindex, nofollow" />
					<title>Misskey Comment Generator</title>
					<link rel="stylesheet" href="/static-assets/misc/comment-generator.css" />
				</head>

				<body>
					<div id="comments"></div>
					<script src="/static-assets/misc/comment-generator.js"></script>
				</body>
			</html>
		</>
	);
}
