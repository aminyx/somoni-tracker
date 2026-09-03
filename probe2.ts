import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'tz-probe-'))
process.env.DATABASE_PATH = join(dir, 'p.db')
const { runMigrations } = await import('./scripts/migrate.ts')
runMigrations(process.env.DATABASE_PATH)

const { db } = await import('./src/lib/db/index.ts')
const { expenses, users } = await import('./src/lib/db/schema.ts')
const { summarize, totalFor } = await import('./src/lib/stats.ts')
const { rangeFor, previousRange, dayKey, zonedStartOfDay } = await import('./src/lib/time.ts')

const TZ = 'Asia/Dushanbe'
db.insert(users).values({ id: 1, firstName: 'A', timezone: TZ, baseCurrency: 'TJS', weekStart: 1, createdAt: 0, lastSeenAt: 0 }).run()

let n = 0
function put(y:number,m:number,d:number,hour:number,minor:number, cat='other'){
  const at = zonedStartOfDay(TZ,y,m,d) + hour*3600000
  db.insert(expenses).values({
    id: 'x'+(n++), userId: 1, amountMinor: minor, currency:'TJS', baseMinor: minor, rate:1,
    category: cat, description:'d', spentAt: at, createdAt: at, updatedAt: at, source:'seed',
  }).run()
}

// August 2026: 1st..3rd = 100,200,300 ; 20th = 5000
put(2026,8,1,12,100); put(2026,8,2,12,200); put(2026,8,3,12,300); put(2026,8,20,12,5000)
// September: 1,2,3 = 10,20,30
put(2026,9,1,12,10); put(2026,9,2,12,20); put(2026,9,3,12,30)

const user = { id:1, timezone:TZ, baseCurrency:'TJS', weekStart:1 }
const now = zonedStartOfDay(TZ,2026,9,3) + 14*3600000  // 3 Sep 14:00 local

const s = summarize(user as any, 'month', now)
console.log('month@3Sep total', s.totalMinor, 'expect 60')
console.log('  prevTotal', s.previousTotalMinor, 'expect 5600')
console.log('  prevComparable', s.previousComparableMinor, 'expect 600')
console.log('  elapsedDays', s.elapsedDays, 'expect 3')
console.log('  avg', s.averagePerDayMinor, 'expect 20')
console.log('  byDay len', s.byDay.length, 'expect 30')

// 00:30 local on 1 Sep
const now2 = zonedStartOfDay(TZ,2026,9,1) + 0.5*3600000
const s2 = summarize(user as any, 'month', now2)
console.log('month@1Sep00:30 total', s2.totalMinor, 'expect 10', 'elapsed', s2.elapsedDays, 'expect 1', 'prevComparable', s2.previousComparableMinor, 'expect 100')

// past month view: at = 15 Aug
const s3 = summarize(user as any, 'month', zonedStartOfDay(TZ,2026,8,15)+12*3600000)
console.log('month@15Aug total', s3.totalMinor, 'expect 5600', 'elapsed', s3.elapsedDays, 'expect 15', 'prevComparable(July)', s3.previousComparableMinor)

// past FULL month view via step-back from Sept: at = start of Sep - 1000 = 31 Aug 23:59:59
const s4 = summarize(user as any, 'month', rangeFor('month', now, TZ, 1).start - 1000)
console.log('month@31Aug23:59 total', s4.totalMinor, 'expect 5600', 'elapsed', s4.elapsedDays, 'expect 31')

// day period
const sd = summarize(user as any, 'day', now)
console.log('day@3Sep total', sd.totalMinor, 'expect 30', 'prevComparable', sd.previousComparableMinor, 'expect 20', 'elapsed', sd.elapsedDays)

// week period; 3 Sep 2026 = Thursday, week = Mon 31 Aug .. Sun 6 Sep
const sw = summarize(user as any, 'week', now)
console.log('week@3Sep total', sw.totalMinor, 'expect 60 (31Aug has none)', 'range', dayKey(sw.range.start,TZ), dayKey(sw.range.end-1,TZ))
console.log('  elapsed', sw.elapsedDays, 'expect 4', 'prevTotal', sw.previousTotalMinor, 'prevComparable', sw.previousComparableMinor)
const pw = previousRange('week', now, TZ, 1)
console.log('  prev week', dayKey(pw.start,TZ), dayKey(pw.end-1,TZ))
