import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, DeleteCommand, UpdateCommand, BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { Redis } from "@upstash/redis";
import fs from "node:fs";
import path from "node:path";

export type Item = Record<string, any> & { pk: string; sk: string };

export interface QueryOpts {
  begins?: string;
  gt?: string;
  limit?: number;
  desc?: boolean;
}

export interface Store {
  get<T = Item>(pk: string, sk: string): Promise<T | undefined>;
  put(item: Item): Promise<void>;
  putMany(items: Item[]): Promise<void>;
  query<T = Item>(pk: string, opts?: QueryOpts): Promise<T[]>;
  del(pk: string, sk: string): Promise<void>;
  merge(pk: string, sk: string, patch: Record<string, any>): Promise<void>;
  incr(pk: string, sk: string, fields: Record<string, number>): Promise<Record<string, number>>;
}

export interface Blobs {
  get(key: string): Promise<string | undefined>;
  put(key: string, body: string, contentType?: string): Promise<void>;
}

// ---------------- DynamoDB ----------------
class DynamoStore implements Store {
  private doc: DynamoDBDocumentClient;
  constructor(private table: string) {
    this.doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true, convertClassInstanceToMap: true } });
  }
  async get<T>(pk: string, sk: string) {
    const r = await this.doc.send(new GetCommand({ TableName: this.table, Key: { pk, sk } }));
    return r.Item as T | undefined;
  }
  async put(item: Item) {
    await this.doc.send(new PutCommand({ TableName: this.table, Item: item }));
  }
  async putMany(items: Item[]) {
    for (let i = 0; i < items.length; i += 25) {
      let req: any = { [this.table]: items.slice(i, i + 25).map((Item) => ({ PutRequest: { Item } })) };
      for (let attempt = 0; attempt < 6 && req && Object.keys(req).length; attempt++) {
        const r = await this.doc.send(new BatchWriteCommand({ RequestItems: req }));
        req = r.UnprocessedItems && Object.keys(r.UnprocessedItems).length ? r.UnprocessedItems : undefined;
        if (req) await new Promise((res) => setTimeout(res, 50 * 2 ** attempt));
      }
    }
  }
  async query<T>(pk: string, opts: QueryOpts = {}) {
    const names: Record<string, string> = { "#pk": "pk" };
    const values: Record<string, any> = { ":pk": pk };
    let cond = "#pk = :pk";
    if (opts.begins) {
      names["#sk"] = "sk";
      values[":b"] = opts.begins;
      cond += " AND begins_with(#sk, :b)";
    } else if (opts.gt) {
      names["#sk"] = "sk";
      values[":g"] = opts.gt;
      cond += " AND #sk > :g";
    }
    const out: T[] = [];
    let ExclusiveStartKey: any;
    do {
      const r = await this.doc.send(
        new QueryCommand({
          TableName: this.table,
          KeyConditionExpression: cond,
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
          ScanIndexForward: !opts.desc,
          Limit: opts.limit ? Math.min(opts.limit - out.length, 1000) : undefined,
          ExclusiveStartKey,
        }),
      );
      out.push(...((r.Items ?? []) as T[]));
      ExclusiveStartKey = r.LastEvaluatedKey;
    } while (ExclusiveStartKey && (!opts.limit || out.length < opts.limit));
    return out;
  }
  async del(pk: string, sk: string) {
    await this.doc.send(new DeleteCommand({ TableName: this.table, Key: { pk, sk } }));
  }
  async merge(pk: string, sk: string, patch: Record<string, any>) {
    const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
    if (!entries.length) return;
    const names: Record<string, string> = {};
    const values: Record<string, any> = {};
    const sets = entries.map(([k, v], i) => {
      names[`#k${i}`] = k;
      values[`:v${i}`] = v;
      return `#k${i} = :v${i}`;
    });
    await this.doc.send(new UpdateCommand({ TableName: this.table, Key: { pk, sk }, UpdateExpression: `SET ${sets.join(", ")}`, ExpressionAttributeNames: names, ExpressionAttributeValues: values }));
  }
  async incr(pk: string, sk: string, fields: Record<string, number>) {
    const names: Record<string, string> = {};
    const values: Record<string, any> = { ":zero": 0 };
    const sets = Object.entries(fields).map(([k, v], i) => {
      names[`#k${i}`] = k;
      values[`:v${i}`] = v;
      return `#k${i} = if_not_exists(#k${i}, :zero) + :v${i}`;
    });
    const r = await this.doc.send(new UpdateCommand({ TableName: this.table, Key: { pk, sk }, UpdateExpression: `SET ${sets.join(", ")}`, ExpressionAttributeNames: names, ExpressionAttributeValues: values, ReturnValues: "UPDATED_NEW" }));
    return (r.Attributes ?? {}) as Record<string, number>;
  }
}

// ---------------- In-memory (local dev / tests) ----------------
class MemoryStore implements Store {
  private data = new Map<string, Map<string, Item>>();
  constructor(private file?: string) {
    if (file && fs.existsSync(file)) {
      try {
        const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Item[];
        for (const it of raw) this.part(it.pk).set(it.sk, it);
      } catch {
        /* ignore corrupt dev db */
      }
    }
  }
  private timer?: NodeJS.Timeout;
  private persist() {
    if (!this.file) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      const all: Item[] = [];
      for (const p of this.data.values()) all.push(...p.values());
      fs.mkdirSync(path.dirname(this.file!), { recursive: true });
      fs.writeFileSync(this.file!, JSON.stringify(all));
    }, 200);
  }
  private part(pk: string) {
    let p = this.data.get(pk);
    if (!p) this.data.set(pk, (p = new Map()));
    return p;
  }
  async get<T>(pk: string, sk: string) {
    const v = this.data.get(pk)?.get(sk);
    return v ? (structuredClone(v) as T) : undefined;
  }
  async put(item: Item) {
    this.part(item.pk).set(item.sk, structuredClone(item));
    this.persist();
  }
  async putMany(items: Item[]) {
    for (const it of items) this.part(it.pk).set(it.sk, structuredClone(it));
    this.persist();
  }
  async query<T>(pk: string, opts: QueryOpts = {}) {
    const p = this.data.get(pk);
    if (!p) return [];
    let rows = [...p.values()].sort((a, b) => (a.sk < b.sk ? -1 : a.sk > b.sk ? 1 : 0));
    if (opts.begins) rows = rows.filter((r) => r.sk.startsWith(opts.begins!));
    if (opts.gt) rows = rows.filter((r) => r.sk > opts.gt!);
    if (opts.desc) rows.reverse();
    if (opts.limit) rows = rows.slice(0, opts.limit);
    return structuredClone(rows) as T[];
  }
  async del(pk: string, sk: string) {
    this.data.get(pk)?.delete(sk);
    this.persist();
  }
  async merge(pk: string, sk: string, patch: Record<string, any>) {
    const cur = this.part(pk).get(sk) ?? { pk, sk };
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) (cur as any)[k] = structuredClone(v);
    this.part(pk).set(sk, cur);
    this.persist();
  }
  async incr(pk: string, sk: string, fields: Record<string, number>) {
    const cur: any = this.part(pk).get(sk) ?? { pk, sk };
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(fields)) out[k] = cur[k] = (cur[k] ?? 0) + v;
    this.part(pk).set(sk, cur);
    this.persist();
    return out;
  }
}

class S3Blobs implements Blobs {
  private s3 = new S3Client({});
  constructor(private bucket: string) {}
  async get(key: string) {
    try {
      const r = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return await r.Body?.transformToString();
    } catch (e: any) {
      if (e?.name === "NoSuchKey") return undefined;
      throw e;
    }
  }
  async put(key: string, body: string, contentType = "application/json") {
    await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }
}

class FileBlobs implements Blobs {
  constructor(private dir: string) {}
  async get(key: string) {
    const f = path.join(this.dir, key);
    return fs.existsSync(f) ? fs.readFileSync(f, "utf8") : undefined;
  }
  async put(key: string, body: string) {
    const f = path.join(this.dir, key);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, body);
  }
}

// ---------------- Upstash Redis (Vercel deployment) ----------------
// Partitions are Redis hashes (field = sk, value = JSON); event partitions ("E#…") are sorted sets scored by
// timestamp; atomic counters live in a side hash so concurrent increments never clobber document writes.
class RedisStore implements Store {
  constructor(private r: Redis, private ns = "cl:") {}
  private hk(pk: string) {
    return this.ns + pk;
  }
  private ck(pk: string, sk: string) {
    return `${this.ns}cnt:${pk}|${sk}`;
  }
  private isEv(pk: string) {
    return pk.startsWith("E#");
  }
  private parse(raw: unknown) {
    if (raw == null) return undefined;
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  }
  private async evFind(pk: string, sk: string): Promise<{ raw: string; item: any } | undefined> {
    const [tsStr, id] = sk.split("#");
    const ts = Number(tsStr);
    const rows = (await this.r.zrange(this.hk(pk), ts, ts, { byScore: true })) as string[];
    for (const raw of rows) {
      const item = this.parse(raw);
      if (item?.id === id) return { raw: typeof raw === "string" ? raw : JSON.stringify(raw), item };
    }
    return undefined;
  }
  async get<T>(pk: string, sk: string) {
    if (this.isEv(pk)) return (await this.evFind(pk, sk))?.item as T | undefined;
    const p = this.r.pipeline();
    p.hget(this.hk(pk), sk);
    p.hgetall(this.ck(pk, sk));
    const [raw, cnt] = (await p.exec()) as [unknown, Record<string, unknown> | null];
    if (raw == null && !cnt) return undefined;
    const item = this.parse(raw) ?? { pk, sk };
    for (const [k, v] of Object.entries(cnt ?? {})) item[k] = Number(v);
    return item as T;
  }
  async put(item: Item) {
    const key = this.hk(item.pk);
    if (this.isEv(item.pk)) {
      const p = this.r.pipeline();
      p.zadd(key, { score: Number(item.ts), member: JSON.stringify(item) });
      p.expire(key, 3 * 24 * 3600);
      if (Math.random() < 0.05) p.zremrangebyrank(key, 0, -6001);
      await p.exec();
      return;
    }
    const p = this.r.pipeline();
    p.hset(key, { [item.sk]: JSON.stringify(item) });
    if (item.ttl) p.expire(key, Math.max(60, Number(item.ttl) - Math.floor(Date.now() / 1000)));
    await p.exec();
  }
  async putMany(items: Item[]) {
    const groups = new Map<string, Record<string, string>>();
    for (const it of items) {
      if (this.isEv(it.pk)) {
        await this.put(it);
        continue;
      }
      const g = groups.get(it.pk) ?? {};
      g[it.sk] = JSON.stringify(it);
      groups.set(it.pk, g);
    }
    if (!groups.size) return;
    const p = this.r.pipeline();
    for (const [pk, fields] of groups) p.hset(this.hk(pk), fields);
    await p.exec();
  }
  async query<T>(pk: string, opts: QueryOpts = {}) {
    const key = this.hk(pk);
    if (this.isEv(pk)) {
      let rows: unknown[];
      const limit = opts.limit ?? 2000;
      if (opts.gt) rows = await this.r.zrange(key, `(${Number(opts.gt)}`, "+inf", { byScore: true, offset: 0, count: limit });
      else if (opts.desc) rows = await this.r.zrange(key, 0, limit - 1, { rev: true });
      else rows = await this.r.zrange(key, 0, limit - 1);
      return rows.map((x) => this.parse(x)) as T[];
    }
    const all = ((await this.r.hgetall(key)) ?? {}) as Record<string, unknown>;
    let rows = Object.entries(all)
      .map(([sk, v]) => ({ sk, item: this.parse(v) }))
      .filter((x) => x.item)
      .sort((a, b) => (a.sk < b.sk ? -1 : a.sk > b.sk ? 1 : 0))
      .map((x) => x.item);
    if (opts.begins) rows = rows.filter((r: any) => r.sk.startsWith(opts.begins!));
    if (opts.gt) rows = rows.filter((r: any) => r.sk > opts.gt!);
    if (opts.desc) rows.reverse();
    if (opts.limit) rows = rows.slice(0, opts.limit);
    return rows as T[];
  }
  async del(pk: string, sk: string) {
    if (this.isEv(pk)) {
      const f = await this.evFind(pk, sk);
      if (f) await this.r.zrem(this.hk(pk), f.raw);
      return;
    }
    const p = this.r.pipeline();
    p.hdel(this.hk(pk), sk);
    p.del(this.ck(pk, sk));
    await p.exec();
  }
  async merge(pk: string, sk: string, patch: Record<string, any>) {
    if (this.isEv(pk)) {
      const f = await this.evFind(pk, sk);
      if (!f) return;
      await this.r.zrem(this.hk(pk), f.raw);
      await this.put({ ...f.item, ...patch });
      return;
    }
    const raw = await this.r.hget(this.hk(pk), sk);
    const cur = this.parse(raw) ?? { pk, sk };
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) cur[k] = v;
    await this.r.hset(this.hk(pk), { [sk]: JSON.stringify(cur) });
  }
  async incr(pk: string, sk: string, fields: Record<string, number>) {
    const p = this.r.pipeline();
    const keys = Object.keys(fields);
    for (const k of keys) p.hincrby(this.ck(pk, sk), k, fields[k]);
    const res = (await p.exec()) as number[];
    return Object.fromEntries(keys.map((k, i) => [k, Number(res[i])]));
  }
}

class RedisBlobs implements Blobs {
  constructor(private r: Redis, private ns = "cl:blob:") {}
  async get(key: string) {
    const v = await this.r.get<string>(this.ns + key);
    return v == null ? undefined : typeof v === "string" ? v : JSON.stringify(v);
  }
  async put(key: string, body: string) {
    await this.r.set(this.ns + key, body);
  }
}

let _redis: Redis | undefined;
function redis(): Redis | undefined {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return undefined;
  _redis ??= new Redis({ url, token, automaticDeserialization: false });
  return _redis;
}

let _store: Store | undefined;
let _blobs: Blobs | undefined;

export function storageKind() {
  return process.env.TABLE_NAME ? "dynamodb" : redis() ? "redis" : "memory";
}

export function store(): Store {
  if (!_store) {
    const r = redis();
    _store = process.env.TABLE_NAME ? new DynamoStore(process.env.TABLE_NAME) : r ? new RedisStore(r) : new MemoryStore(process.env.LOCAL_DB_FILE);
  }
  return _store;
}

export function blobs(): Blobs {
  if (!_blobs) {
    const r = redis();
    _blobs = process.env.BUCKET_NAME ? new S3Blobs(process.env.BUCKET_NAME) : r && !process.env.TABLE_NAME ? new RedisBlobs(r) : new FileBlobs(process.env.LOCAL_BLOB_DIR ?? (process.env.VERCEL ? "/tmp/chaoslab-blobs" : ".local/blobs"));
  }
  return _blobs;
}
