// テスト用：Cloudflare D1 と同じ使い方ができる、Node標準のSQLite（node:sqlite）によるラッパーです。
// 実際のCloudflare D1へは一切アクセスしません。

import { DatabaseSync } from "node:sqlite";

export class FakeStatement {
  constructor(
    private db: DatabaseSync,
    public sql: string,
    private params: unknown[] = [],
  ) {}
  bind(...params: unknown[]) {
    return new FakeStatement(this.db, this.sql, params);
  }
  async first<T>() {
    const row = this.db.prepare(this.sql).get(...(this.params as never[]));
    return (row ? { ...row } : null) as T | null;
  }
  async all<T>() {
    return { results: this.db.prepare(this.sql).all(...(this.params as never[])).map((row) => ({ ...row })) as T[], success: true };
  }
  async run() {
    // SELECT 文・RETURNING 付きの文は結果の行も返す（D1の batch と同じ）
    if (/^\s*SELECT\b/i.test(this.sql) || /\bRETURNING\b/i.test(this.sql)) return this.all();
    this.db.prepare(this.sql).run(...(this.params as never[]));
    return { results: [], success: true };
  }
}

export class FakeD1 {
  queries = 0;
  constructor(public sqlite = new DatabaseSync(":memory:")) {}
  prepare(sql: string) {
    this.queries++;
    return new FakeStatement(this.sqlite, sql);
  }
  async batch(statements: FakeStatement[]) {
    this.sqlite.exec("BEGIN");
    try {
      const results = [];
      for (const s of statements) results.push(await s.run());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (err) {
      this.sqlite.exec("ROLLBACK");
      throw err;
    }
  }
}
