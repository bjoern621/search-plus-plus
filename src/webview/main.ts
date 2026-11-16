import type { HostMessage, ViewMessage } from "../messages";

declare function acquireVsCodeApi(): { postMessage(message: ViewMessage): void };

const vscode = acquireVsCodeApi();
const input = document.getElementById("query") as HTMLInputElement;
const summary = document.getElementById("summary") as HTMLDivElement;

input.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  vscode.postMessage({ type: "search", query: input.value });
});

window.addEventListener("message", (event: MessageEvent<HostMessage>) => {
  const message = event.data;
  switch (message.type) {
    case "focus":
      input.focus();
      input.select();
      return;
    case "results":
      summary.textContent = message.summary;
      return;
  }
});
