"use client";

import { useSyncExternalStore } from "react";

const sAbonner = () => () => {};

/**
 * False in the server HTML, true once React has hydrated the page. A form holding
 * a secret keeps its submit button disabled until then: submitted before
 * hydration, the browser would send it natively instead of the Server Action.
 */
export function usePret(): boolean {
  return useSyncExternalStore(
    sAbonner,
    () => true,
    () => false,
  );
}
