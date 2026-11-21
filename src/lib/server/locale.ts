const FALLBACK = "en-US";

/**
 * pick the browser's preferred locale from its accept-language header
 *
 * @param header accept-language value
 *
 * @returns {string} a locale the runtime can format with
 */
export function preferredLocale(header: string | null): string {
  const tags = (header ?? "")
    .split(",")
    .map((part) => {
      const [tag, quality] = part.trim().split(";q=");
      return { tag, quality: quality ? Number(quality) : 1 };
    })
    .filter(({ tag }) => tag && tag !== "*")
    .sort((a, b) => b.quality - a.quality);

  for (const { tag } of tags) {
    try {
      const [supported] = Intl.DateTimeFormat.supportedLocalesOf(tag);
      if (supported) return supported;
    } catch {}
  }

  return FALLBACK;
}
