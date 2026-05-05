import { execSync } from "node:child_process";
import { defineConfig } from "vite";

const VERSION_BASE_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const VERSION_BUILD_PATTERN = /^(0|[1-9]\d*)$/;
const VERSION_TAG_PATTERN =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const CROSS_ORIGIN_ISOLATION_HEADERS = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

function readGitCommitHash(): string {
  if (process.env.APP_COMMIT_HASH) {
    return process.env.APP_COMMIT_HASH.slice(0, 12);
  }

  if (process.env.GITHUB_SHA) {
    return process.env.GITHUB_SHA.slice(0, 12);
  }

  try {
    return execSync("git rev-parse --short=12 HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return "";
  }
}

function readBuildNumber(): string {
  if (process.env.GITHUB_RUN_NUMBER) {
    if (!VERSION_BUILD_PATTERN.test(process.env.GITHUB_RUN_NUMBER)) {
      throw new Error(
        `GITHUB_RUN_NUMBER must be numeric, but got "${process.env.GITHUB_RUN_NUMBER}".`,
      );
    }

    return process.env.GITHUB_RUN_NUMBER;
  }

  try {
    return execSync("git rev-list --count HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return "0";
  }
}

function readVersion(): string {
  if (process.env.GITHUB_REF_TYPE === "tag") {
    const tagName = process.env.GITHUB_REF_NAME ?? "";
    if (!VERSION_TAG_PATTERN.test(tagName)) {
      throw new Error(
        `GITHUB_REF_NAME must be a SemVer tag such as v1.2.3, but got "${tagName}".`,
      );
    }

    return tagName.replace(/^v/, "");
  }

  const versionBase = process.env.APP_VERSION_BASE ?? "0.1";
  if (!VERSION_BASE_PATTERN.test(versionBase)) {
    throw new Error(
      `APP_VERSION_BASE must use the major.minor format, but got "${versionBase}".`,
    );
  }

  return `${versionBase}.${readBuildNumber()}`;
}

export default defineConfig({
  base: "./",
  define: {
    "import.meta.env.VITE_APP_COMMIT_HASH": JSON.stringify(readGitCommitHash()),
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(readVersion()),
  },
  server: {
    headers: CROSS_ORIGIN_ISOLATION_HEADERS,
  },
  preview: {
    headers: CROSS_ORIGIN_ISOLATION_HEADERS,
  },
});
