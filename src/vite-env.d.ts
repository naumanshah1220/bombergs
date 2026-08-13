/// <reference types="vite/client" />

/** LAN IPv4 of the dev machine, injected by vite.config.ts (null in prod builds). */
declare const __LAN_HOST__: string | null;

/** Every address a phone could reach the dev machine on, best first. */
declare const __NET_HOSTS__: { label: string; host: string }[];
