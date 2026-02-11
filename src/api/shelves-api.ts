import { authStore } from "../auth/auth-store";
import { librariesApi } from "./libraries-api";
import type {
  BookPersonalizedView,
  TypedPersonalizedView,
} from "../types/absTypes";

export type ShelfBook = { libraryItemId: string };

export type Shelf = {
  books: ShelfBook[];
  shelfId: string;
  shelfLabel: string;
};

export const buildBookShelf = <T extends TypedPersonalizedView>(bookShelfItem: T) => {
  const baseInfo = { shelfId: bookShelfItem.id, shelfLabel: bookShelfItem.label };
  switch (bookShelfItem.type) {
    case "book": {
      const books = bookShelfItem.entities.map((book) => ({
        libraryItemId: book.id,
      }));
      return { ...baseInfo, books } as Shelf;
    }
  }
};

const resolveLibraryId = (libraryId?: string | null) =>
  libraryId ?? authStore.getState().activeLibraryId;

export const shelvesApi = {
  async getBookShelves(libraryId?: string) {
    const libraryIdToUse = resolveLibraryId(libraryId);

    if (!libraryIdToUse) {
      console.warn("getBookShelves: No active library set");
      return null;
    }

    let resp;

    try {
      resp = await librariesApi.getPersonalized(libraryIdToUse, { limit: 16 });
    } catch (error) {
      console.log("Error getting book shelves", error);
      return null;
    }

    const continueListeningShelf = resp.find(
      (item): item is BookPersonalizedView => item.id === "continue-listening",
    );
    const recentlyAddedShelf = resp.find(
      (item): item is BookPersonalizedView => item.id === "recently-added",
    );
    const discoverShelf = resp.find(
      (item): item is BookPersonalizedView => item.id === "discover",
    );
    const listenAgainShelf = resp.find(
      (item): item is BookPersonalizedView => item.id === "listen-again",
    );

    const continueListening = continueListeningShelf
      ? buildBookShelf(continueListeningShelf)
      : undefined;
    const recentlyAdded = recentlyAddedShelf
      ? buildBookShelf(recentlyAddedShelf)
      : undefined;
    const discover = discoverShelf ? buildBookShelf(discoverShelf) : undefined;
    const listenAgain = listenAgainShelf
      ? buildBookShelf(listenAgainShelf)
      : undefined;

    const shelves: Record<string, Shelf> = {
      ...(continueListening ? { "continue-listening": continueListening } : {}),
      ...(recentlyAdded ? { "recently-added": recentlyAdded } : {}),
      ...(discover ? { discover } : {}),
      ...(listenAgain ? { "listen-again": listenAgain } : {}),
    };

    return { ...shelves };
  },
};
