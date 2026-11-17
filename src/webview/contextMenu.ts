import type { MenuAction, MenuContent, MenuItem } from "./menu";

/** Space between the menu and the edges of the view, as in the mockup. */
const MENU_LEFT_PX = 36;
const MENU_RIGHT_PX = 12;

/**
 * Shows a context menu inside the view, since a webview cannot add items to the native one.
 * Up and Down move between the items, Enter or Space runs one, Escape and Tab close the menu.
 */
export class ContextMenu {
  private readonly reasons: HTMLDivElement;
  private readonly list: HTMLDivElement;
  /** The items that take focus and run, in the order of the menu. Disabled items stay out. */
  private items: { element: HTMLDivElement; label: string; action: MenuAction }[] = [];
  /** Every item as `describe` writes it, disabled ones included. */
  private descriptions = new Map<HTMLElement, string>();

  constructor(
    private readonly element: HTMLDivElement,
    private readonly onChoose: (action: MenuAction) => void,
    private readonly onClose: () => void,
  ) {
    this.reasons = document.createElement("div");
    this.reasons.className = "menu-reasons";
    this.reasons.id = "menu-reasons";
    this.list = document.createElement("div");
    this.list.className = "menu-items";
    this.list.setAttribute("role", "menu");
    this.list.tabIndex = -1;
    this.list.setAttribute("aria-describedby", this.reasons.id);
    element.append(this.reasons, this.list);
    element.hidden = true;

    element.addEventListener("keydown", (event) => this.handleKey(event));
    this.list.addEventListener("click", (event) => {
      const index = this.itemIndex(event.target);
      if (index >= 0) this.choose(index);
    });
    this.list.addEventListener("mousemove", (event) => {
      const index = this.itemIndex(event.target);
      if (index >= 0) this.items[index]?.element.focus();
    });
    document.addEventListener("pointerdown", (event) => {
      if (this.isOpen && !element.contains(event.target as Node)) this.close(false);
    });
    window.addEventListener("blur", () => this.close(false));
    window.addEventListener("resize", () => this.close(false));
  }

  get isOpen(): boolean {
    return !this.element.hidden;
  }

  /**
   * Opens `menu` below `anchor`, or above it when the view ends first.
   * A menu opened from the keyboard focuses its first item, as the menus of VS Code do.
   * A menu opened with the pointer highlights no item until the pointer or a key moves to one.
   */
  open(menu: MenuContent, anchor: DOMRect, fromKeyboard: boolean): void {
    this.reasons.replaceChildren(...menu.reasons.map((text) => textElement("menu-reason", text)));
    this.reasons.hidden = menu.reasons.length === 0;
    this.items = [];
    this.descriptions.clear();
    const children: HTMLElement[] = [];
    menu.groups.forEach((group, index) => {
      if (index > 0) children.push(separator());
      for (const item of group) {
        const element = itemElement(item);
        this.descriptions.set(element, describeItem(item));
        if (!item.disabled) this.items.push({ element, label: item.label, action: item.action });
        children.push(element);
      }
    });
    if (menu.reasons.length > 0) children.unshift(separator());
    this.list.replaceChildren(...children);

    this.element.hidden = false;
    this.element.style.left = `${MENU_LEFT_PX}px`;
    this.element.style.right = `${MENU_RIGHT_PX}px`;
    const height = this.element.offsetHeight;
    const below = anchor.bottom + height <= window.innerHeight;
    this.element.style.top = `${below ? anchor.bottom : Math.max(0, anchor.top - height)}px`;
    if (fromKeyboard && this.items[0]) this.items[0].element.focus();
    else this.list.focus();
  }

  /** Hides the menu. With `returnFocus`, the results take the focus back. */
  close(returnFocus = true): void {
    if (!this.isOpen) return;
    this.element.hidden = true;
    this.items = [];
    this.descriptions.clear();
    if (returnFocus) this.onClose();
  }

  /** Lists the reasons, the item labels and `-` for each separator, as the menu shows them. For integration tests. */
  describe(): string[] {
    if (!this.isOpen) return [];
    const reasons = Array.from(this.reasons.children).map((child) => child.textContent ?? "");
    const items = Array.from(this.list.children).map((child) => (child.getAttribute("role") === "separator" ? "-" : (this.descriptions.get(child as HTMLElement) ?? "")));
    return [...reasons, ...items];
  }

  /** Returns the label of the focused item, empty while the menu shows none. For integration tests. */
  focusedLabel(): string {
    return this.items.find((item) => item.element === document.activeElement)?.label ?? "";
  }

  /** Runs the item labelled `label`. Returns false when the menu holds no such item or the item is disabled. For integration tests. */
  chooseLabel(label: string): boolean {
    const index = this.items.findIndex((item) => item.label === label);
    if (index < 0) return false;
    this.choose(index);
    return true;
  }

  private choose(index: number): void {
    const item = this.items[index];
    if (!item) return;
    this.close();
    this.onChoose(item.action);
  }

  private handleKey(event: KeyboardEvent): void {
    const current = this.items.findIndex((item) => item.element === document.activeElement);
    switch (event.key) {
      case "ArrowDown":
        this.focusItem(current + 1);
        break;
      case "ArrowUp":
        this.focusItem(current <= 0 ? this.items.length - 1 : current - 1);
        break;
      case "Home":
        this.focusItem(0);
        break;
      case "End":
        this.focusItem(this.items.length - 1);
        break;
      case "Enter":
      case " ":
        this.choose(current);
        break;
      case "Escape":
      case "Tab":
        this.close();
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  /** Focuses the item at `index`, wrapping past the last item to the first. */
  private focusItem(index: number): void {
    if (this.items.length === 0) return;
    this.items[index % this.items.length]?.element.focus();
  }

  private itemIndex(target: EventTarget | null): number {
    const element = (target as HTMLElement | null)?.closest(".menu-item");
    return this.items.findIndex((item) => item.element === element);
  }
}

/** A check mark column, the label and the dimmer description. */
function itemElement(item: MenuItem): HTMLDivElement {
  const element = document.createElement("div");
  element.className = item.disabled ? "menu-item disabled" : "menu-item";
  element.tabIndex = -1;
  if (item.checked === undefined) element.setAttribute("role", "menuitem");
  else {
    element.setAttribute("role", "menuitemradio");
    element.setAttribute("aria-checked", String(item.checked));
    element.append(spanElement("menu-check", item.checked ? "✓" : ""));
  }
  if (item.disabled) element.setAttribute("aria-disabled", "true");
  element.append(spanElement("menu-label", item.label));
  if (item.description !== undefined) element.append(spanElement("menu-description", item.description));
  return element;
}

/** Writes an item for integration tests, such as `✓ Working tree` or `Git history (Last 200 commits)`, with `[disabled]` behind a disabled one. */
function describeItem(item: MenuItem): string {
  const check = item.checked ? "✓ " : "";
  const description = item.description === undefined ? "" : ` (${item.description})`;
  return `${check}${item.label}${description}${item.disabled ? " [disabled]" : ""}`;
}

function textElement(className: string, text: string): HTMLDivElement {
  const element = document.createElement("div");
  element.className = className;
  element.textContent = text;
  return element;
}

function spanElement(className: string, text: string): HTMLSpanElement {
  const element = document.createElement("span");
  element.className = className;
  element.textContent = text;
  return element;
}

function separator(): HTMLDivElement {
  const element = document.createElement("div");
  element.className = "menu-separator";
  element.setAttribute("role", "separator");
  return element;
}
