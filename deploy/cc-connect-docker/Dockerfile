FROM golang:1.25-bookworm AS builder

WORKDIR /src

ARG GOPROXY=https://goproxy.cn,direct
ARG GOSUMDB=sum.golang.google.cn

COPY go.mod go.sum ./
RUN GOPROXY="${GOPROXY}" GOSUMDB="${GOSUMDB}" go mod download

COPY . .
RUN GOPROXY="${GOPROXY}" GOSUMDB="${GOSUMDB}" CGO_ENABLED=0 GOFLAGS=-buildvcs=false \
    make release TARGET=linux/amd64 AGENTS=codex PLATFORMS_INCLUDE=feishu NO_WEB=1 \
    && cp dist/cc-connect-v*-linux-amd64 /usr/local/bin/cc-connect

FROM node:22-bookworm-slim

ARG CODEX_VERSION=0.137.0
ARG APT_PROXY=
ARG NPM_CONFIG_REGISTRY=https://registry.npmmirror.com

RUN if [ -n "${APT_PROXY}" ]; then \
      echo "Acquire::http::Proxy \"${APT_PROXY}\";" > /etc/apt/apt.conf.d/99proxy; \
      echo "Acquire::https::Proxy \"${APT_PROXY}\";" >> /etc/apt/apt.conf.d/99proxy; \
    fi \
    && apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git openssh-client bash tini \
    && npm install -g --registry="${NPM_CONFIG_REGISTRY}" "@openai/codex@${CODEX_VERSION}" \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /etc/apt/apt.conf.d/99proxy

COPY --from=builder /usr/local/bin/cc-connect /usr/local/bin/cc-connect

WORKDIR /workspaces/cc-connect-fork
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["cc-connect", "--config", "/config/config.toml"]
