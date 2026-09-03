import {
  rangeFor, previousRange, enumerateDays, dayKey, dayKeyToInstant, startOfDay,
  addDays, zonedStartOfDay, partsInZone, daysInRange,
} from './src/lib/time.ts'

function j(x:any){return JSON.stringify(x)}

console.log('--- 1. zonedStartOfDay in DST-at-midnight zones ---')
for (const tz of ['America/Santiago','Asia/Beirut','America/Havana','America/Sao_Paulo']) {
  // scan a whole year of local midnights, check round-trip dayKey
  let bad: string[] = []
  for (const year of [2026]) {
    for (let m=1;m<=12;m++){
      for (let d=1;d<=28;d++){
        const i = zonedStartOfDay(tz, year, m, d)
        const k = dayKey(i, tz)
        const want = `${year}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`
        if (k !== want) bad.push(`${want} -> ${k} (parts=${j(partsInZone(i,tz))})`)
      }
    }
  }
  console.log(tz, 'mismatches:', bad.length, bad.slice(0,6))
}

console.log('--- 2. enumerateDays for months in Santiago (DST at midnight 2026-09-06) ---')
for (const tz of ['America/Santiago']) {
  for (let m=1;m<=12;m++){
    const r = rangeFor('month', Date.UTC(2026,m-1,15,12,0), tz)
    const days = enumerateDays(r, tz)
    const uniq = new Set(days)
    console.log(tz, m, 'len',days.length,'uniq',uniq.size, 'first',days[0],'last',days[days.length-1])
  }
}

console.log('--- 3. Santiago Sept 2026 daily walk ---')
{
  const tz='America/Santiago'
  const r = rangeFor('month', Date.UTC(2026,8,15,12), tz)
  console.log('range', new Date(r.start).toISOString(), new Date(r.end).toISOString())
  const days = enumerateDays(r, tz)
  console.log(days.join(' '))
}
