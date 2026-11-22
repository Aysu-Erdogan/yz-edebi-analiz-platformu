import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../src/lib/prisma.js';
import { PrismaJobRepository } from '../src/repositories/prisma-job.repository.js';
import { createJobRunner, type JobHandler, type JobRunner } from '../src/services/job-runner.js';
import { assertSafeTestDatabase, testDatabaseUrl } from './support/test-db.js';

const url = testDatabaseUrl();

if (url) {
  assertSafeTestDatabase(url);
  const db = createDb(url);
  afterAll(async () => {
    await db.job.deleteMany();
    await db.$disconnect();
  });

  describe('MySQL: iş kuyruğu (depo)', () => {
    let repo: PrismaJobRepository;
    beforeEach(async () => {
      await db.job.deleteMany();
      repo = new PrismaJobRepository(db);
    });

    it('iş ekler: bekliyor durumunda, sayaçlar sıfır, parametreler (Türkçe dahil) aynen saklanır', async () => {
      const job = await repo.enqueue({
        type: 'evaluate_batch',
        payload: { metinler: [1, 2], not: 'Sonbahar şiiri' },
        total: 2,
      });
      expect(job).toMatchObject({
        type: 'evaluate_batch',
        status: 'pending',
        total: 2,
        done: 0,
        failed: 0,
        attempts: 0,
        result: null,
        error: null,
        startedAt: null,
        finishedAt: null,
      });
      expect((await repo.findById(job.id))?.payload).toEqual({
        metinler: [1, 2],
        not: 'Sonbahar şiiri',
      });
      expect(await repo.findById(999_999)).toBeNull();
    });

    it('geçersiz işi reddeder: boş tür, 32 karakterden uzun tür, eksi toplam', async () => {
      for (const bad of [
        { type: '', payload: {}, total: 1 },
        { type: 'a'.repeat(33), payload: {}, total: 1 },
        { type: 'x', payload: {}, total: -1 },
        { type: 'x', payload: {}, total: 1.5 },
      ]) {
        await expect(repo.enqueue(bad), JSON.stringify(bad)).rejects.toThrow();
      }
      expect(await db.job.count()).toBe(0);
    });

    it('sıradakini sahiplenir: en eski bekleyen önce, çalışıyor olur, deneme artar, ilk başlama zamanı yazılır', async () => {
      const first = await repo.enqueue({ type: 'a', payload: {}, total: 1 });
      const second = await repo.enqueue({ type: 'a', payload: {}, total: 1 });

      const claimed = await repo.claimNext();
      expect(claimed).toMatchObject({ id: first.id, status: 'running', attempts: 1 });
      expect(claimed?.startedAt).toBeInstanceOf(Date);
      expect((await repo.claimNext())?.id).toBe(second.id);
      expect(await repo.claimNext()).toBeNull(); // bekleyen kalmadı
    });

    it('yalnızca istenen türleri sahiplenir', async () => {
      await repo.enqueue({ type: 'baska', payload: {}, total: 1 });
      const wanted = await repo.enqueue({ type: 'istenen', payload: {}, total: 1 });
      expect((await repo.claimNext(['istenen']))?.id).toBe(wanted.id);
      expect(await repo.claimNext(['istenen'])).toBeNull();
      expect((await repo.claimNext())?.type).toBe('baska');
    });

    it('iki işçi aynı anda sahiplenmeye çalışınca iş yalnızca birine verilir', async () => {
      await repo.enqueue({ type: 'a', payload: {}, total: 1 });
      const results = await Promise.all(Array.from({ length: 6 }, () => repo.claimNext()));
      expect(results.filter((r) => r !== null)).toHaveLength(1);
      expect((await db.job.findFirstOrThrow()).attempts).toBe(1);
    });

    it('ilerlemeyi yazar, işi başarıyla bitirir (sonuç ve bitiş zamanı)', async () => {
      const job = await repo.enqueue({ type: 'a', payload: {}, total: 5 });
      await repo.claimNext();
      await repo.setProgress(job.id, { done: 3, failed: 1 });
      expect(await repo.findById(job.id)).toMatchObject({ done: 3, failed: 1, status: 'running' });

      await repo.complete(job.id, { özet: 'bitti' });
      const done = await repo.findById(job.id);
      expect(done).toMatchObject({ status: 'succeeded', result: { özet: 'bitti' } });
      expect(done?.finishedAt).toBeInstanceOf(Date);
    });

    it('ilerleme sayaçları geçersizse reddeder', async () => {
      const job = await repo.enqueue({ type: 'a', payload: {}, total: 5 });
      for (const bad of [
        { done: -1, failed: 0 },
        { done: 1.5, failed: 0 },
        { done: 0, failed: -2 },
      ]) {
        await expect(repo.setProgress(job.id, bad), JSON.stringify(bad)).rejects.toThrow();
      }
    });

    it('işi başarısız yapar: neden yazılır, bitiş zamanı dolar, uzun neden kısaltılır', async () => {
      const job = await repo.enqueue({ type: 'a', payload: {}, total: 1 });
      await repo.claimNext();
      await repo.fail(job.id, 'x'.repeat(5000));
      const failed = await repo.findById(job.id);
      expect(failed?.status).toBe('failed');
      expect(failed?.error).toHaveLength(2000);
      expect(failed?.finishedAt).toBeInstanceOf(Date);
    });

    it('yarım kalan (çalışıyor) işleri bekleyene geri alır: sayaçlar ve ilk başlama zamanı korunur (T37)', async () => {
      const running = await repo.enqueue({ type: 'a', payload: {}, total: 10 });
      const finished = await repo.enqueue({ type: 'a', payload: {}, total: 1 });
      const broken = await repo.enqueue({ type: 'a', payload: {}, total: 1 });
      await repo.claimNext(); // running
      await repo.setProgress(running.id, { done: 4, failed: 1 });
      const started = (await repo.findById(running.id))?.startedAt;
      await repo.claimNext();
      await repo.complete(finished.id, {});
      await repo.claimNext();
      await repo.fail(broken.id, 'hata');

      expect(await repo.requeueInterrupted()).toBe(1);

      expect(await repo.findById(running.id)).toMatchObject({
        status: 'pending',
        done: 4,
        failed: 1,
        attempts: 1,
        startedAt: started,
      });
      expect((await repo.findById(finished.id))?.status).toBe('succeeded'); // dokunulmadı
      expect((await repo.findById(broken.id))?.status).toBe('failed');
      expect(await repo.requeueInterrupted()).toBe(0);
    });

    it('çalışan işi bırakır (düzgün kapanma): bekleyene döner, bitmiş işe dokunmaz', async () => {
      const job = await repo.enqueue({ type: 'a', payload: {}, total: 3 });
      await repo.claimNext();
      await repo.release(job.id);
      expect((await repo.findById(job.id))?.status).toBe('pending');

      await repo.claimNext();
      await repo.complete(job.id, {});
      await repo.release(job.id);
      expect((await repo.findById(job.id))?.status).toBe('succeeded');
    });
  });

  describe('MySQL: iş kuyruğu (işçi döngüsü)', () => {
    let repo: PrismaJobRepository;
    beforeEach(async () => {
      await db.job.deleteMany();
      repo = new PrismaJobRepository(db);
    });

    const runnerWith = (handlers: Record<string, JobHandler>) =>
      createJobRunner({ jobs: repo, handlers, pollMs: 5 });

    /** `items` öğeyi sırayla işler; biten sayısından devam eder (yeniden başlatmada atlama). */
    const itemHandler =
      (processed: number[], afterItem?: (item: number) => void): JobHandler =>
      async (ctx) => {
        const items = (ctx.job.payload as { items: number }).items;
        let done = ctx.job.done;
        for (let item = done + 1; item <= items; item++) {
          if (ctx.signal.aborted) return { status: 'interrupted' };
          processed.push(item);
          done++;
          await ctx.progress({ done, failed: 0 });
          afterItem?.(item);
        }
        return { status: 'done', result: { işlenen: done } };
      };

    it('türüne uygun işleyiciyi çalıştırır, ilerlemeyi yazar ve işi bitirir', async () => {
      const processed: number[] = [];
      const job = await repo.enqueue({ type: 'say', payload: { items: 4 }, total: 4 });
      const runner = runnerWith({ say: itemHandler(processed) });

      expect(await runner.runNext()).toBe(true);
      expect(processed).toEqual([1, 2, 3, 4]);
      expect(await repo.findById(job.id)).toMatchObject({
        status: 'succeeded',
        done: 4,
        failed: 0,
        result: { işlenen: 4 },
      });
      expect(await runner.runNext()).toBe(false); // iş kalmadı
    });

    it('iş sürerken ilerleme veritabanında görünür', async () => {
      const job = await repo.enqueue({ type: 'say', payload: { items: 3 }, total: 3 });
      const seen: number[] = [];
      const runner = runnerWith({
        say: async (ctx) => {
          for (let i = 1; i <= 3; i++) {
            await ctx.progress({ done: i, failed: 0 });
            seen.push((await repo.findById(job.id))?.done ?? -1);
          }
          return { status: 'done' };
        },
      });
      await runner.runNext();
      expect(seen).toEqual([1, 2, 3]);
    });

    it('işleyicisi olmayan türü sahiplenmez, bekleyen olarak bırakır', async () => {
      const job = await repo.enqueue({ type: 'bilinmeyen', payload: {}, total: 1 });
      const runner = runnerWith({ say: itemHandler([]) });
      expect(await runner.runNext()).toBe(false);
      expect((await repo.findById(job.id))?.status).toBe('pending');
    });

    it('işleyici hata fırlatırsa iş failed olur, neden yazılır; sıradaki iş yine çalışır', async () => {
      const bad = await repo.enqueue({ type: 'kirik', payload: {}, total: 1 });
      const processed: number[] = [];
      const good = await repo.enqueue({ type: 'say', payload: { items: 2 }, total: 2 });
      const runner = runnerWith({
        kirik: async () => {
          throw new Error('işleyici patladı');
        },
        say: itemHandler(processed),
      });

      await runner.runUntilIdle();

      expect(await repo.findById(bad.id)).toMatchObject({ status: 'failed' });
      expect((await repo.findById(bad.id))?.error).toContain('işleyici patladı');
      expect((await repo.findById(good.id))?.status).toBe('succeeded');
      expect(processed).toEqual([1, 2]);
    });

    it('kapatma istenmeden "yarım kaldım" diyen işleyici işi sonsuz döngüye sokmaz: iş failed olur', async () => {
      const job = await repo.enqueue({ type: 'say', payload: {}, total: 1 });
      const runner = runnerWith({ say: async () => ({ status: 'interrupted' }) });
      await runner.runUntilIdle(); // sonsuz döngüye girerse test zaman aşımına uğrar
      expect(await repo.findById(job.id)).toMatchObject({ status: 'failed' });
      expect((await repo.findById(job.id))?.error).toContain('kapatma istenmeden');
    });

    it('runUntilIdle işleri sırayla (en eski önce) çalıştırır ve işi kalmayınca durur', async () => {
      const order: number[] = [];
      const a = await repo.enqueue({ type: 't', payload: {}, total: 0 });
      const b = await repo.enqueue({ type: 't', payload: {}, total: 0 });
      const runner = runnerWith({
        t: async (ctx) => {
          order.push(ctx.job.id);
          return { status: 'done' };
        },
      });
      await runner.runUntilIdle();
      expect(order).toEqual([a.id, b.id]);
    });

    it('T37: sunucu çökünce yarım kalan iş, açılışta kaldığı yerden devam eder; biten öğe tekrar işlenmez', async () => {
      const job = await repo.enqueue({ type: 'say', payload: { items: 10 }, total: 10 });
      // Çöküş: iş sahiplenildi, 5 öğe bitti, işçi öldü (iş "çalışıyor" olarak kaldı).
      await repo.claimNext();
      await repo.setProgress(job.id, { done: 5, failed: 0 });
      expect((await repo.findById(job.id))?.status).toBe('running');
      const started = (await repo.findById(job.id))?.startedAt;

      // Yeni süreç: işçi açılırken yarım kalanları geri alır, sonra çalıştırır.
      const processed: number[] = [];
      const runner = runnerWith({ say: itemHandler(processed) });
      await runner.recover();
      await runner.runUntilIdle();

      expect(processed).toEqual([6, 7, 8, 9, 10]); // ilk beşi tekrar işlenmedi
      expect(await repo.findById(job.id)).toMatchObject({
        status: 'succeeded',
        done: 10,
        attempts: 2,
        startedAt: started, // ilk başlama zamanı yeniden başlatmada değişmez
      });
    });

    it('düzgün kapanma: kapatma istenince çalışan öğe biter, iş bekleyene döner; yeni işçi devam eder', async () => {
      const job = await repo.enqueue({ type: 'say', payload: { items: 8 }, total: 8 });
      const processed: number[] = [];
      const first: JobRunner = runnerWith({
        say: itemHandler(processed, (item) => {
          if (item === 3) void first.stop(); // 3. öğeden sonra kapat
        }),
      });
      await first.runNext();

      expect(processed).toEqual([1, 2, 3]);
      expect(await repo.findById(job.id)).toMatchObject({ status: 'pending', done: 3 });
      expect(await first.runNext()).toBe(false); // kapanan işçi yeni iş almaz

      const second = runnerWith({ say: itemHandler(processed) });
      await second.runUntilIdle();
      expect(processed).toEqual([1, 2, 3, 4, 5, 6, 7, 8]); // hiçbir öğe iki kez işlenmedi
      expect((await repo.findById(job.id))?.status).toBe('succeeded');
    });

    it('start: yeni gelen işi kendiliğinden alır, stop ile durur', async () => {
      const processed: number[] = [];
      const runner = runnerWith({ say: itemHandler(processed) });
      const running = runner.start();

      const job = await repo.enqueue({ type: 'say', payload: { items: 3 }, total: 3 });
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        if ((await repo.findById(job.id))?.status === 'succeeded') break;
        await new Promise((r) => setTimeout(r, 10));
      }
      await runner.stop();
      await running;

      expect((await repo.findById(job.id))?.status).toBe('succeeded');
      expect(processed).toEqual([1, 2, 3]);
    });

    it('start açılışta yarım kalan işi de toparlar', async () => {
      const job = await repo.enqueue({ type: 'say', payload: { items: 4 }, total: 4 });
      await repo.claimNext();
      await repo.setProgress(job.id, { done: 2, failed: 0 });

      const processed: number[] = [];
      const runner = runnerWith({ say: itemHandler(processed) });
      const running = runner.start();
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        if ((await repo.findById(job.id))?.status === 'succeeded') break;
        await new Promise((r) => setTimeout(r, 10));
      }
      await runner.stop();
      await running;

      expect(processed).toEqual([3, 4]);
    });
  });
} else if (process.env.CI) {
  describe('MySQL: iş kuyruğu', () => {
    it('CI ortamında TEST_DATABASE_URL tanımlı olmalı', () => {
      throw new Error('TEST_DATABASE_URL tanımlı değil: MySQL testleri çalışamadı');
    });
  });
} else {
  describe.skip('MySQL: iş kuyruğu (TEST_DATABASE_URL tanımlı değil, atlandı)', () => {
    it('yerelde çalıştırmak için kök .env dosyasına TEST_DATABASE_URL ekleyin (README)', () => {});
  });
}
