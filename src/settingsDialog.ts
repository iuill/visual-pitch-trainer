export function setupSettingsDialog(
  dialog: HTMLDialogElement,
  opener: HTMLButtonElement,
) {
  opener.addEventListener("click", () => {
    if (!dialog.open) dialog.showModal();
  });
  dialog
    .querySelectorAll<HTMLButtonElement>("[data-close-dialog]")
    .forEach((button) => {
      button.addEventListener("click", () => dialog.close());
    });
  // A backdrop click targets the dialog too; keep clicks inside its padding open.
  const outside = (event: PointerEvent | MouseEvent) => {
    const bounds = dialog.getBoundingClientRect();
    return (
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom
    );
  };
  let startedOutside = false;
  dialog.addEventListener("pointerdown", (event) => {
    startedOutside = event.target === dialog && outside(event);
  });
  dialog.addEventListener("click", (event) => {
    if (startedOutside && event.target === dialog && outside(event))
      dialog.close();
    startedOutside = false;
  });
}
