import { execSync } from "node:child_process";
import { defineConfig } from "vite";

function readGitCommitHash(): string {
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
    return (process.env.GITHUB_REF_NAME ?? "").replace(/^v/, "");
  }

  const versionBase = process.env.APP_VERSION_BASE ?? "0.1";
  return `${versionBase}.${readBuildNumber()}`;
}

export default defineConfig({
  base: "./",
  define: {
    "import.meta.env.VITE_APP_COMMIT_HASH": JSON.stringify(readGitCommitHash()),
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(readVersion()),
  },
});
