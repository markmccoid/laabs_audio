import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";

export type Book = {
  id: string;
  title?: string;
  isDownloaded: boolean;
};

export type BooksState = {
  books: Record<string, Book>;
  actions: {
    setBooks: (books: Record<string, Book>) => void;
    updateBook: (bookId: string, updates: Partial<Book>) => void;
    removeBook: (bookId: string) => void;
  };
};

export const booksStore = createStore<BooksState>((set) => ({
  books: {},
  actions: {
    setBooks: (books) => set({ books }),
    updateBook: (bookId, updates) =>
      set((state) => ({
        books: {
          ...state.books,
          [bookId]: {
            ...state.books[bookId],
            id: bookId,
            ...updates,
          },
        },
      })),
    removeBook: (bookId) =>
      set((state) => {
        const next = { ...state.books };
        delete next[bookId];
        return { books: next };
      }),
  },
}));

export const useBooksStore = <T,>(selector: (state: BooksState) => T) =>
  useStore(booksStore, selector);

export const useBooksActions = () => useBooksStore((state) => state.actions);

export const selectHasOfflineContent = (state: BooksState) =>
  Object.values(state.books).some((book) => book.isDownloaded);
