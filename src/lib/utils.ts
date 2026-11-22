export { cn } from "cn";

/**
 * whether the browser runs on an apple platform, where shortcuts use cmd
 *
 * @returns {boolean} whether it is apple
 */
export const isApple = (): boolean =>
  /mac|iphone|ipad|ipod/i.test(
    (navigator as Navigator & { userAgentData?: { platform: string } })
      .userAgentData?.platform ?? navigator.platform,
  );
