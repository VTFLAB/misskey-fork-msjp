# Build the vendored wllama with build.sh inside the emscripten image.
# Used by .gitea/workflows/wllama-vendor.yml; the build context is only this Dockerfile and build.sh.
#
#   docker buildx build --load --build-arg WLLAMA_COMMIT=<40-hex sha> -t wllama-vendor .
#
# EMSDK_TAG must equal EMSDK_IMAGE_TAG in wllama's scripts/build_wasm.sh at the commit being built.
# This is the only place the tag is written. The workflow and build.sh both check it and fail otherwise.
# The base image is also pinned by digest: the linux/amd64 image manifest digest of the tag above (not the
# manifest list digest, which starts with sha256:460fff). Update both together.
ARG EMSDK_TAG=4.0.20
ARG EMSDK_DIGEST=sha256:33e992367f721747d8008c9141c04fa017139e3557a60e0c80be93a0870fe462

FROM docker.io/emscripten/emsdk:${EMSDK_TAG}@${EMSDK_DIGEST} AS build
ARG WLLAMA_COMMIT
# sha256 of the emdawnwebgpu zip to accept; empty = trust on first use (build.sh records the hash)
ARG EMDAWN_SHA256=
RUN apt-get update -qq \
	&& apt-get install -y -qq --no-install-recommends git ca-certificates curl cmake make python3 \
	&& rm -rf /var/lib/apt/lists/*
COPY build.sh /usr/local/bin/wllama-build.sh
RUN test -n "${WLLAMA_COMMIT}" && EMDAWN_SHA256="${EMDAWN_SHA256}" bash /usr/local/bin/wllama-build.sh "${WLLAMA_COMMIT}" /out

# Only the generated files remain; the workflow copies them out with `docker create` + `docker cp`.
FROM scratch
COPY --from=build /out/ /
