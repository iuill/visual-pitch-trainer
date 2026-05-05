import { spawn } from "node:child_process";

const hostUrl = process.env.DEV_SERVER_HOST_URL ?? "http://localhost:35173/";
const viteArgs = ["--bun", "vite", "--host", "0.0.0.0", "--strictPort"];
const useColor = process.stdout.isTTY && process.env.NO_COLOR === undefined;
const color = {
  cyan: useColor ? "\x1b[36m" : "",
  green: useColor ? "\x1b[32m" : "",
  reset: useColor ? "\x1b[0m" : "",
};

console.log(
  `\n${color.green}Dev Container:${color.reset} ${color.cyan}${hostUrl}${color.reset}\n`,
);

const vite = spawn("bunx", viteArgs, {
  stdio: "inherit",
});

vite.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
