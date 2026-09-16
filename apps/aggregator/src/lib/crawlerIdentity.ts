/**
 * One truthful identity for Catwalks public-job collection across HTTP and
 * browser transports. It never borrows another crawler's access exception.
 */

/** Public operator information URL; availability needs a separate native check. */
export const BOT_INFO_URL = 'https://catwalks.io/bot';

/** Shared by the HTTP identity and robots group selection. */
export const CRAWLER_PRODUCT_TOKEN = 'CatwalksBot';

/** Fixed operator identity, without an environment override. */
export const CRAWLER_IDENTITY = `${CRAWLER_PRODUCT_TOKEN}/1.0 (+${BOT_INFO_URL})`;
