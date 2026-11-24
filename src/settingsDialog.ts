import { queryElement } from "./dom";

export function setupSettingsDialog(
  dialog: HTMLDialogElement,
  openers: HTMLButtonElement | HTMLButtonElement[],
  beforeOpen?: (opener: HTMLButtonElement) => void,
) {
  for (const opener of Array.isArray(openers) ? openers : [openers]) {
    opener.addEventListener("click", () => {
      if (dialog.open) return;
      beforeOpen?.(opener);
      // Safari may leave focus elsewhere after a button click.
      opener.focus({ preventScroll: true });
      dialog.showModal();
      dialog.scrollTop = 0;
    });
  }
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

export function setupTabbedSettingsDialog(
  dialog: HTMLDialogElement,
  opener: HTMLButtonElement,
  onSelect: (panel: HTMLElement) => void,
  initialTabIndex: () => number,
) {
  const tabList = queryElement<HTMLElement>('[role="tablist"]', dialog);
  const tabs = Array.from(
    tabList.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
  );
  const panels = tabs.map((tab) =>
    queryElement<HTMLElement>(`#${tab.getAttribute("aria-controls")}`, dialog),
  );
  let selectedIndex = 0;

  function select(index: number) {
    selectedIndex = index;
    for (const [tabIndex, tab] of tabs.entries()) {
      const selected = tabIndex === index;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      panels[tabIndex].hidden = !selected;
    }
    onSelect(panels[index]);
    dialog.scrollTop = 0;
  }

  for (const [index, tab] of tabs.entries()) {
    tab.addEventListener("click", () => {
      if (index !== selectedIndex) select(index);
      tab.focus();
    });
  }
  tabList.addEventListener("keydown", (event) => {
    let index: number;
    switch (event.key) {
      case "ArrowLeft":
        index = (selectedIndex + tabs.length - 1) % tabs.length;
        break;
      case "ArrowRight":
        index = (selectedIndex + 1) % tabs.length;
        break;
      case "Home":
        index = 0;
        break;
      case "End":
        index = tabs.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    if (index !== selectedIndex) select(index);
    tabs[index].focus();
  });
  setupSettingsDialog(dialog, opener, () => select(initialTabIndex()));
}
