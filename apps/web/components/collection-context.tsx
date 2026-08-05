"use client";

import { createContext, useContext } from "react";
import type { CollectionWithNodes, TreeItem } from "@/lib/collections";

export interface CollectionCtx {
  collection: CollectionWithNodes;
  tree: TreeItem[];
}

export const CollectionContext = createContext<CollectionCtx | null>(null);

export function useCollection(): CollectionCtx {
  const ctx = useContext(CollectionContext);
  if (!ctx) throw new Error("useCollection outside provider");
  return ctx;
}
