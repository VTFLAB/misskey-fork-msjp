#!/usr/bin/env bash
# Build the vendored wllama (ESM bundle + main JSPI/WebGPU wasm) from an upstream commit.
#
# Usage: build.sh <wllama-commit-sha> <out-dir>
#   <out-dir> must not exist yet; the caller copies its contents into this directory.
#
# Optional env: EMDAWN_SHA256 = expected sha256 of the emdawnwebgpu zip (the build fails on mismatch).
# The hash of the zip that was actually used is recorded in SOURCE.json as toolchain.dawnZipSha256.
#
# Requirements: emcc of the version that upstream pins in scripts/build_wasm.sh
# (EMSDK_IMAGE_TAG), git, cmake, make, python3, node, npm, curl.
# CI runs this inside the emscripten/emsdk image (see Dockerfile next to this file).
set -euo pipefail

COMMIT="${1:?usage: build.sh <wllama-commit-sha> <out-dir>}"
OUT="${2:?usage: build.sh <wllama-commit-sha> <out-dir>}"
REPO_URL="${WLLAMA_REPO_URL:-https://github.com/ngxson/wllama}"

if [ -e "$OUT" ]; then
	echo "out-dir already exists: $OUT" >&2
	exit 1
fi

WORK="$(mktemp -d)" || exit 1
cleanup() { rm -rf "${WORK:?}"; }
trap cleanup EXIT

SRC="$WORK/wllama"
git init --quiet "$SRC"
git -C "$SRC" remote add origin "$REPO_URL"
git -C "$SRC" fetch --quiet --depth 1 origin "$COMMIT"
git -C "$SRC" checkout --quiet FETCH_HEAD
git -C "$SRC" submodule update --quiet --init --depth 1 llama.cpp

# PLaMo 3 Translate GGUFs declare tokenizer.ggml.model = "plamo3" (llama.cpp #30045, 2026-10-06).
if ! grep -q '"plamo3"' "$SRC/llama.cpp/src/llama-vocab.cpp"; then
	echo "llama.cpp bundled by wllama $COMMIT does not know the plamo3 tokenizer" >&2
	exit 1
fi

EXPECTED_EMCC="$(sed -n 's/^export EMSDK_IMAGE_TAG="\([0-9.]*\)"$/\1/p' "$SRC/scripts/build_wasm.sh" | sed -n '1p')"
ACTUAL_EMCC="$(emcc --version | sed -n '1p' | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | sed -n '1p')"
if [ -z "$EXPECTED_EMCC" ] || [ "$EXPECTED_EMCC" != "$ACTUAL_EMCC" ]; then
	echo "emcc $ACTUAL_EMCC does not match the version upstream pins ($EXPECTED_EMCC)" >&2
	exit 1
fi

DAWN_TAG="$(sed -n 's/^[[:space:]]*DAWN_TAG=\(v[0-9.]*\)[[:space:]]*$/\1/p' "$SRC/scripts/docker-compose.yml" | sed -n '1p')"
if [ -z "$DAWN_TAG" ]; then
	echo "could not read DAWN_TAG from upstream scripts/docker-compose.yml" >&2
	exit 1
fi
curl -fsSL -o "$WORK/emdawn.zip" \
	"https://github.com/google/dawn/releases/download/${DAWN_TAG}/emdawnwebgpu_pkg-${DAWN_TAG}.zip"
DAWN_ZIP_SHA256="$(sha256sum "$WORK/emdawn.zip" | cut -d' ' -f1)"
if [ -n "${EMDAWN_SHA256:-}" ]; then
	if ! printf '%s' "$EMDAWN_SHA256" | grep -qxE '[0-9a-f]{64}'; then
		echo "EMDAWN_SHA256 is not a lowercase sha256 hex digest" >&2
		exit 1
	fi
	if [ "$DAWN_ZIP_SHA256" != "$EMDAWN_SHA256" ]; then
		echo "emdawnwebgpu zip ($DAWN_TAG) sha256 $DAWN_ZIP_SHA256 does not match the pinned $EMDAWN_SHA256" >&2
		exit 1
	fi
fi
python3 -c 'import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])' "$WORK/emdawn.zip" "$WORK/emdawn"

# Same flags as upstream's main build (docker-compose.yml). The compat build (no JSPI / no
# Memory64) is not built: the frontend disables wllama's compat mode and falls back instead.
mkdir -p "$SRC/build"
(
	cd "$SRC/build"
	emcmake cmake .. -DGGML_WEBGPU=ON -DGGML_WEBGPU_JSPI=ON \
		-DEMDAWNWEBGPU_DIR="$WORK/emdawn/emdawnwebgpu_pkg" -DWLLAMA_TEST_BACKEND=OFF
	emmake make wllama -j"$(nproc)"
)
mkdir -p "$SRC/src/wasm"
cp "$SRC/build/wllama.js" "$SRC/build/wllama.wasm" "$SRC/src/wasm/"

(
	cd "$SRC"
	npm ci --ignore-scripts --no-audit --no-fund
	npm run build:glue
	npm run clean
	npm run build:worker
	npm run build:tsup
	npm run build:typedef
	./scripts/post_build.sh
)

mkdir -p "$OUT/esm/wasm"
cp "$SRC/esm/index.js" "$OUT/esm/"
(cd "$SRC/esm" && find . -name '*.d.ts' -print0 | xargs -0 -I{} cp --parents {} "$OUT/esm/")
cp "$SRC/esm/wasm/wllama.wasm" "$OUT/esm/wasm/"
cp "$SRC/LICENCE" "$OUT/LICENCE.wllama"
cp "$SRC/llama.cpp/LICENSE" "$OUT/LICENSE.llama.cpp"
# emdawnwebgpu's bindings are compiled into the wasm and its JS glue.
cp "$WORK/emdawn/emdawnwebgpu_pkg/webgpu_cpp/LICENSE" "$OUT/LICENSE.emdawnwebgpu-webgpu_cpp"
cp "$WORK/emdawn/emdawnwebgpu_pkg/webgpu/src/LICENSE" "$OUT/LICENSE.emdawnwebgpu-webgpu"

WLLAMA_VERSION="$(node -p 'require(process.argv[1]).version' "$SRC/package.json")"
LLAMA_CPP_COMMIT="$(git -C "$SRC/llama.cpp" rev-parse HEAD)"
LLAMA_CPP_DATE="$(git -C "$SRC/llama.cpp" log -1 --format=%cI)"
WLLAMA_DATE="$(git -C "$SRC" log -1 --format=%cI)"
node - "$OUT" "$COMMIT" "$WLLAMA_VERSION" "$WLLAMA_DATE" "$LLAMA_CPP_COMMIT" "$LLAMA_CPP_DATE" "$ACTUAL_EMCC" "$DAWN_TAG" "$DAWN_ZIP_SHA256" <<'EOF'
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const [out, commit, version, wllamaDate, llamaCommit, llamaDate, emcc, dawnTag, dawnZipSha256] = process.argv.slice(2);
const files = {};
const walk = (dir) => {
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, e.name);
		if (e.isDirectory()) walk(p);
		else if (e.name !== 'SOURCE.json') files[path.relative(out, p)] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
	}
};
walk(out);
const sorted = Object.fromEntries(Object.keys(files).sort().map(k => [k, files[k]]));
const source = {
	wllama: { repo: 'https://github.com/ngxson/wllama', commit, version, committedAt: wllamaDate },
	llamaCpp: { commit: llamaCommit, committedAt: llamaDate },
	toolchain: { emscripten: emcc, dawn: dawnTag, dawnZipSha256 },
	builtAt: new Date().toISOString(),
	files: sorted,
};
fs.writeFileSync(path.join(out, 'SOURCE.json'), JSON.stringify(source, null, '\t') + '\n');
EOF

echo "built wllama $WLLAMA_VERSION ($COMMIT) with llama.cpp $LLAMA_CPP_COMMIT into $OUT"
