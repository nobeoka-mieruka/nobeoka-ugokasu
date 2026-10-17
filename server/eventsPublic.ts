// トップページ「今後のイベント」・/events/ のイベント部分を、配信時にD1の内容で差し替えるための部品です
//（差し替えは server/publicRewrite.ts）。
// D1からは一般公開・未削除のイベントの、公開してよい列だけを読む（server/events.ts の listPublicEvents）。

import type { PublicEvent } from "../src/types/events";
import { todayInJapan } from "../src/utils/dialogueEvents";
import { listPublicEvents } from "./events";
import type { PublicPageEnv } from "./newsPublic";
import type { PublicSection } from "./publicRewrite";

/** イベント部分の差し替え内容。同じリクエストの中では D1 を1回だけ読む */
export function eventsSection(
  context: EventContext<PublicPageEnv, string, Record<string, unknown>>,
  selector: "[data-events-home]" | "[data-events-list]",
  render: (events: PublicEvent[], today: string) => string,
  schemas?: (events: PublicEvent[], today: string) => string,
): PublicSection {
  let loaded: Promise<PublicEvent[]> | null = null;
  const load = () => {
    const db = context.env.STAFF_DB;
    if (!db) return Promise.reject(new Error("no_database"));
    loaded ??= listPublicEvents(db);
    return loaded;
  };
  return {
    name: "events",
    selector,
    html: async () => render(await load(), todayInJapan()),
    ...(schemas ? { head: async () => schemas(await load(), todayInJapan()) } : {}),
  };
}
