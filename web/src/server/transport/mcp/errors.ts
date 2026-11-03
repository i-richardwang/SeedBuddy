export function mcpErrorContent({
  code,
  message,
}: {
  code: string;
  message: string;
}) {
  return {
    isError: true,
    content: [
      { type: "text" as const, text: JSON.stringify({ code, message }) },
    ],
  };
}
