import { useMemo } from "react";
import { NodeHtmlMarkdown } from "node-html-markdown";
import Markdown from "react-native-markdown-display";

type Props = {
  html: string;
  textColor?: string;
};

const HtmlToMarkdown = ({ html, textColor = "black" }: Props) => {
  const markdown = useMemo(() => {
    const validHtmlInput = typeof html === "string" ? html : "";
    return NodeHtmlMarkdown.translate(validHtmlInput, {}, undefined, undefined);
  }, [html]);

  return (
    <Markdown
      style={{
        body: { color: textColor, fontSize: 14, lineHeight: 20 },
        heading1: { fontSize: 22, fontWeight: "700", color: textColor },
        heading2: { fontSize: 18, fontWeight: "700", color: textColor },
        heading3: { fontSize: 16, fontWeight: "700", color: textColor },
        link: { color: "#007AFF" },
        paragraph: { marginBottom: 4 },
        list_item: {
          flexDirection: "row",
          alignItems: "center",
          marginBottom: 8,
        },
        bullet_list_icon: {
          fontSize: 20,
          color: textColor,
          marginRight: 8,
        },
      }}
    >
      {markdown}
    </Markdown>
  );
};

export default HtmlToMarkdown;
