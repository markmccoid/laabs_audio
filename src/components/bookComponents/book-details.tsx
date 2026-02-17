import React from "react";
import { Pressable, Text, View } from "react-native";

type Props = {
  description?: string | null;
  genres?: string[];
  tags?: string[];
  maxLines?: number;
};

const BookDetails = ({ description, genres, tags, maxLines = 4 }: Props) => {
  const [isExpanded, setIsExpanded] = React.useState(false);
  const trimmedDescription = description?.trim() ?? "";
  const hasDescription = trimmedDescription.length > 0;
  const resolvedGenres = genres ?? [];
  const resolvedTags = tags ?? [];
  const hasGenres = resolvedGenres.length > 0;
  const hasTags = resolvedTags.length > 0;

  const handleToggle = () => {
    if (!hasDescription) return;
    setIsExpanded((prev) => !prev);
  };

  return (
    <View style={{ gap: 16 }}>
      <View style={{ gap: 10 }}>
        <Text selectable style={{ fontSize: 18, fontWeight: "600", color: "#111827" }}>
          Description
        </Text>
        <Pressable
          onPress={handleToggle}
          disabled={!hasDescription}
          style={({ pressed }) => ({
            borderRadius: 18,
            borderCurve: "continuous",
            backgroundColor: "#ffffff",
            padding: 14,
            borderWidth: 1,
            borderColor: "#e5e7eb",
            boxShadow: "0 10px 22px rgba(15, 23, 42, 0.08)",
            opacity: pressed ? 0.9 : 1,
          })}
        >
          <Text
            selectable
            style={{ fontSize: 14, lineHeight: 20, color: "#374151" }}
            numberOfLines={isExpanded ? undefined : maxLines}
          >
            {hasDescription ? trimmedDescription : "No description available yet."}
          </Text>
          {hasDescription ? (
            <Text selectable style={{ marginTop: 8, fontSize: 12, color: "#9ca3af" }}>
              {isExpanded ? "Tap to collapse" : "Tap to expand"}
            </Text>
          ) : (
            <Text selectable style={{ marginTop: 8, fontSize: 12, color: "#cbd5e1" }}>
              Description will appear here when available.
            </Text>
          )}
        </Pressable>
      </View>

      <View style={{ gap: 10 }}>
        <Text selectable style={{ fontSize: 16, fontWeight: "600", color: "#111827" }}>
          Genres
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {hasGenres ? (
            resolvedGenres.map((genre, index) => (
              <View
                key={`${genre}-${index}`}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderRadius: 999,
                  backgroundColor: "#eef2ff",
                  borderWidth: 1,
                  borderColor: "#c7d2fe",
                }}
              >
                <Text selectable style={{ fontSize: 12, color: "#3730a3" }}>
                  {genre}
                </Text>
              </View>
            ))
          ) : (
            <Text selectable style={{ fontSize: 13, color: "#9ca3af" }}>
              No genres listed.
            </Text>
          )}
        </View>
      </View>

      <View style={{ gap: 10 }}>
        <Text selectable style={{ fontSize: 16, fontWeight: "600", color: "#111827" }}>
          Tags
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {hasTags ? (
            resolvedTags.map((tag, index) => (
              <View
                key={`${tag}-${index}`}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderRadius: 999,
                  backgroundColor: "#ecfdf3",
                  borderWidth: 1,
                  borderColor: "#bbf7d0",
                }}
              >
                <Text selectable style={{ fontSize: 12, color: "#14532d" }}>
                  {tag}
                </Text>
              </View>
            ))
          ) : (
            <Text selectable style={{ fontSize: 13, color: "#9ca3af" }}>
              No tags listed.
            </Text>
          )}
        </View>
      </View>
    </View>
  );
};

export default BookDetails;
