/// <reference lib="webworker" />
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { NetworkOnly, Serwist, StaleWhileRevalidate } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

/**
 * Service worker deliberately limited to the application shell.
 * Pages and API responses are NEVER cached: tablets are shared, the data
 * concerns minors, and an action must never look recorded when it was not.
 * The offline check-in queue comes in lot 5.
 */
const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    {
      // Harvest Kids logos and PWA icons (public, no personal data).
      matcher: ({ url, sameOrigin }) =>
        sameOrigin && (url.pathname.startsWith("/icons/") || url.pathname.startsWith("/logo/")),
      handler: new StaleWhileRevalidate({ cacheName: "hk-images-publiques" }),
    },
    {
      // Pages always come from the network; when it fails, the offline page is shown.
      matcher: ({ request }) => request.mode === "navigate",
      handler: new NetworkOnly(),
    },
  ],
  fallbacks: {
    entries: [
      {
        url: "/hors-connexion",
        matcher: ({ request }) => request.destination === "document",
      },
    ],
  },
});

serwist.addEventListeners();
