import { absClient } from "./abs-client";
import type { AuthorsItemsResponse } from "../types/absTypes";

export const authorsApi = {
  getAuthorWithItems(authorId: string) {
    return absClient.get<AuthorsItemsResponse>(
      `/api/authors/${authorId}?include=items`,
    );
  },
};
