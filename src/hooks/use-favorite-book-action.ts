import type { LibraryItemsSummary } from "@/api/library-items-api";
import { favoritesApi } from "@/api/favorites-api";
import { itemsApi, type ItemDetails } from "@/api/items-api";
import {
  createEmptyUserServerState,
  type UserServerState,
} from "@/api/me-api";
import { useAuthStore } from "@/auth/auth-store";
import { queryKeys } from "@/query/query-keys";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "react-native-sonner";

type ToggleFavoriteVariables = {
  libraryItemId: string;
  currentTags: string[];
  isFavorite: boolean;
  nextTags: string[];
};

type ToggleFavoriteContext = {
  previousUserServerState?: UserServerState;
  previousLibraryBooks?: LibraryItemsSummary;
  previousItemDetails?: ItemDetails;
};

const updateFavoriteState = (
  previousState: UserServerState | undefined,
  userKey: string,
  libraryItemId: string,
  isFavorite: boolean,
): UserServerState => {
  const baseState = previousState ?? createEmptyUserServerState(userKey);
  const favoriteByLibraryItemId = { ...(previousState?.favoriteByLibraryItemId ?? {}) };

  if (isFavorite) {
    favoriteByLibraryItemId[libraryItemId] = true;
  } else {
    delete favoriteByLibraryItemId[libraryItemId];
  }

  return {
    ...baseState,
    favoriteByLibraryItemId,
  };
};

export const useFavoriteBookAction = () => {
  const queryClient = useQueryClient();
  const status = useAuthStore((state) => state.status);
  const activeLibraryId = useAuthStore((state) => state.activeLibraryId);
  const activeLibraryUserKey = useAuthStore((state) => state.activeLibraryUserKey);
  const isOffline = useAuthStore((state) => state.isOnline === false);

  const canToggleFavorite =
    status === "authenticated" &&
    !isOffline &&
    Boolean(activeLibraryId) &&
    Boolean(activeLibraryUserKey);

  const mutation = useMutation<void, Error, ToggleFavoriteVariables, ToggleFavoriteContext>({
    mutationFn: async ({ libraryItemId, nextTags }) => {
      await itemsApi.updateMediaTags(libraryItemId, nextTags);
    },
    onMutate: async ({ libraryItemId, isFavorite, nextTags }) => {
      if (!activeLibraryId || !activeLibraryUserKey) {
        return {};
      }

      await Promise.all([
        queryClient.cancelQueries({
          queryKey: queryKeys.userServerState(activeLibraryUserKey),
          exact: true,
        }),
        queryClient.cancelQueries({
          queryKey: queryKeys.libraryBooks(activeLibraryId),
          exact: true,
        }),
        queryClient.cancelQueries({
          queryKey: queryKeys.itemDetails(libraryItemId),
          exact: true,
        }),
      ]);

      const previousUserServerState = queryClient.getQueryData<UserServerState>(
        queryKeys.userServerState(activeLibraryUserKey),
      );
      const previousLibraryBooks = queryClient.getQueryData<LibraryItemsSummary>(
        queryKeys.libraryBooks(activeLibraryId),
      );
      const previousItemDetails = queryClient.getQueryData<ItemDetails>(
        queryKeys.itemDetails(libraryItemId),
      );
      const nextIsFavorite = !isFavorite;

      queryClient.setQueryData<UserServerState>(
        queryKeys.userServerState(activeLibraryUserKey),
        (previousState) =>
          updateFavoriteState(
            previousState,
            activeLibraryUserKey,
            libraryItemId,
            nextIsFavorite,
          ),
      );

      queryClient.setQueryData<LibraryItemsSummary>(
        queryKeys.libraryBooks(activeLibraryId),
        (previousBooks) =>
          previousBooks?.map((book) =>
            book.id === libraryItemId
              ? {
                  ...book,
                  tags: nextTags,
                  isFavorite: nextIsFavorite,
                }
              : book,
          ) ?? previousBooks,
      );

      queryClient.setQueryData<ItemDetails>(
        queryKeys.itemDetails(libraryItemId),
        (previousDetails) =>
          previousDetails
            ? {
                ...previousDetails,
                media: {
                  ...previousDetails.media,
                  tags: nextTags,
                },
              }
            : previousDetails,
      );

      return {
        previousUserServerState,
        previousLibraryBooks,
        previousItemDetails,
      };
    },
    onSuccess: (_data, variables) => {
      toast.success(variables.isFavorite ? "Removed from favorites" : "Marked as favorite");
      void queryClient.invalidateQueries({
        queryKey: queryKeys.itemDetails(variables.libraryItemId),
        exact: true,
      });
    },
    onError: (_error, variables, context) => {
      if (activeLibraryUserKey) {
        queryClient.setQueryData(
          queryKeys.userServerState(activeLibraryUserKey),
          context?.previousUserServerState,
        );
      }
      if (activeLibraryId) {
        queryClient.setQueryData(
          queryKeys.libraryBooks(activeLibraryId),
          context?.previousLibraryBooks,
        );
      }
      queryClient.setQueryData(
        queryKeys.itemDetails(variables.libraryItemId),
        context?.previousItemDetails,
      );
      toast.error(variables.isFavorite ? "Unable to remove favorite" : "Unable to mark favorite");
    },
  });

  const toggleFavorite = async (payload: {
    libraryItemId: string;
    currentTags: string[];
    isFavorite: boolean;
  }) => {
    if (status !== "authenticated") {
      toast.error("Login required to update favorites");
      return;
    }
    if (isOffline) {
      toast.error("Favorites require an online connection");
      return;
    }
    if (!activeLibraryId || !activeLibraryUserKey) {
      toast.error("Library context is not ready");
      return;
    }

    const { favoriteUserTagValue } = favoritesApi.getUserFavoriteInfo();
    const nextTags = payload.isFavorite
      ? favoritesApi.removeFavoriteTag(payload.currentTags, favoriteUserTagValue)
      : favoritesApi.addFavoriteTag(payload.currentTags, favoriteUserTagValue);

    try {
      await mutation.mutateAsync({
        ...payload,
        nextTags,
      });
    } catch {
      return;
    }
  };

  return {
    canToggleFavorite,
    isToggleFavoritePending: mutation.isPending,
    toggleFavorite,
  };
};
