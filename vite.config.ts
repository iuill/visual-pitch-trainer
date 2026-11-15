import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";

const VERSION_BASE_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const VERSION_BUILD_PATTERN = /^(0|[1-9]\d*)$/;
const VERSION_TAG_PATTERN =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const CROSS_ORIGIN_ISOLATION_HEADERS = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};
const DEV_SERVER_WATCH_IGNORES = ["**/.tmp/**", "**/public/models/**"];
const UNUSED_ONNX_WASM_ASSET_PATTERN =
  /^assets\/ort-wasm-simd-threaded\.asyncify-[A-Za-z0-9_-]+\.wasm$/;

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

function readOnnxRuntimeWebVersion(): string {
  const packageJson = JSON.parse(
    readFileSync("node_modules/onnxruntime-web/package.json", "utf8"),
  ) as {
    version?: string;
  };

  if (!packageJson.version) {
    throw new Error("onnxruntime-web package version could not be resolved.");
  }

  return packageJson.version;
}

export default defineConfig({
  base: "./",
  define: {
    "import.meta.env.VITE_APP_COMMIT_HASH": JSON.stringify(readGitCommitHash()),
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(readVersion()),
    "import.meta.env.VITE_ONNX_RUNTIME_WEB_VERSION": JSON.stringify(
      readOnnxRuntimeWebVersion(),
    ),
  },
  plugins: [dropUnusedOnnxWasmAsset(), buildServiceWorker()],
  server: {
    headers: CROSS_ORIGIN_ISOLATION_HEADERS,
    watch: {
      ignored: DEV_SERVER_WATCH_IGNORES,
    },
  },
  preview: {
    headers: CROSS_ORIGIN_ISOLATION_HEADERS,
  },
});

function buildServiceWorker(): Plugin {
  return {
    name: "build-service-worker",
    apply: "build",
    generateBundle(_, bundle) {
      const staticFiles = [
        "manifest.webmanifest",
        "favicon.png",
        "apple-touch-icon.png",
        "icons/app-logo.png",
        "icons/heading-record.png",
        "icons/heading-tone.png",
        "icons/heading-trail.png",
        "icons/pwa-192.png",
        "icons/pwa-512.png",
        "icons/pwa-maskable-512.png",
      ];
      const files = [
        "index.html",
        ...Object.keys(bundle).filter((file) => /\.(js|css)$/.test(file)),
        ...staticFiles,
      ];
      const template = readFileSync("scripts/service-worker.js", "utf8");
      const hash = createHash("sha256").update(template);
      for (const item of Object.values(bundle))
        hash.update(item.type === "chunk" ? item.code : item.source);
      for (const file of staticFiles)
        hash.update(readFileSync(`public/${file}`));
      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source: template
          .replace("__PRECACHE__", JSON.stringify(files))
          .replace("__CACHE_VERSION__", hash.digest("hex").slice(0, 16)),
      });
    },
  };
}

function dropUnusedOnnxWasmAsset(): Plugin {
  return {
    name: "drop-unused-onnx-wasm-asset",
    generateBundle(_, bundle) {
      for (const fileName of Object.keys(bundle)) {
        if (UNUSED_ONNX_WASM_ASSET_PATTERN.test(fileName)) {
          delete bundle[fileName];
        }
      }
    },
  };
}
