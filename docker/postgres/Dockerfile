# postgres:15-alpine plus pgvector, for SmartWardrobe's item embeddings.
# Built on the same Alpine image the stack already uses, so an existing data volume (created
# with musl's en_US.utf8 collation) keeps its text ordering and indexes; the Debian-based
# pgvector/pgvector image would sort text differently.
FROM postgres:15-alpine

ARG PGVECTOR_VERSION=v0.8.0

RUN apk add --no-cache --virtual .pgvector-build build-base git \
    && git clone --depth 1 --branch "$PGVECTOR_VERSION" https://github.com/pgvector/pgvector.git /tmp/pgvector \
    && cd /tmp/pgvector \
    # The image's server is built with LLVM JIT, whose bitcode step needs a matching clang;
    # pgvector works without it.
    && make with_llvm=no \
    && make with_llvm=no install \
    && cd / && rm -rf /tmp/pgvector \
    && apk del .pgvector-build
