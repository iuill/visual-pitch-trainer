type InstallPrompt = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function setupPwa() {
  const button = document.querySelector<HTMLButtonElement>("#installApp");
  const status = document.querySelector<HTMLElement>("#pwaStatus");
  if (!button || !status) return;
  let prompt: InstallPrompt | null = null;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    prompt = event as InstallPrompt;
    button.hidden = false;
  });
  button.addEventListener("click", async () => {
    const pending = prompt;
    if (!pending) return;
    prompt = null;
    button.hidden = true;
    try {
      await pending.prompt();
      await pending.userChoice;
    } catch {
      status.textContent = "ブラウザのメニューからホーム画面に追加できます。";
    }
  });
  window.addEventListener("appinstalled", () => {
    button.hidden = true;
    prompt = null;
  });
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  void navigator.serviceWorker
    .register(`${import.meta.env.BASE_URL}sw.js`, {
      scope: import.meta.env.BASE_URL,
      updateViaCache: "none",
    })
    .then((registration) => {
      const updateMessage = () => {
        status.textContent =
          "新しいバージョンがあります。アプリをすべて閉じて、開き直すと更新されます。";
      };
      if (registration.waiting) updateMessage();
      registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        installing?.addEventListener("statechange", () => {
          if (
            installing.state === "redundant" &&
            !navigator.serviceWorker.controller
          )
            status.textContent =
              "オフライン起動の準備ができませんでした。接続後に開き直してください。";
          if (
            installing.state === "installed" &&
            navigator.serviceWorker.controller
          )
            updateMessage();
        });
      });
      void navigator.serviceWorker.ready.then(() => {
        if (!registration.waiting)
          status.textContent = "基本画面はオフラインでも起動できます。";
      });
    })
    .catch(() => {
      status.textContent =
        "オフライン起動の準備ができませんでした。接続後に開き直してください。";
    });
}
