FROM mcr.microsoft.com/devcontainers/typescript-node:1-22-bookworm

ENV TZ=Asia/Tokyo

RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends locales python-is-python3 tzdata \
 && sed -i 's/^# *ja_JP.UTF-8 UTF-8/ja_JP.UTF-8 UTF-8/' /etc/locale.gen \
 && locale-gen ja_JP.UTF-8 \
 && update-locale LANG=ja_JP.UTF-8 LC_ALL=ja_JP.UTF-8 \
 && ln -snf "/usr/share/zoneinfo/$TZ" /etc/localtime \
 && echo "$TZ" > /etc/timezone \
 && chsh -s /bin/bash node \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*

ENV LANG=ja_JP.UTF-8 \
    LC_ALL=ja_JP.UTF-8 \
    SHELL=/bin/bash
