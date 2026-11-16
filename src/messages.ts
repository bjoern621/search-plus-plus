export type ViewMessage = { type: "search"; query: string };

export type HostMessage = { type: "focus" } | { type: "results"; query: string; summary: string };
