// Asks Gemini to turn an unusual sentence into a spreading rule. Common sentences are read on
// the device (readRule in spread.ts), so this runs only for the rest. It goes through Firebase
// AI Logic on the Gemini free tier: no key lives in the app, and nobody needs to sign in.
import { GoogleAIBackend, Schema, getAI, getGenerativeModel } from 'firebase/ai'
import { app } from './cloud'
import { dayKey } from './schedule'
import type { SpreadRule } from './spread'

/** A small, fast model. Change it here when Google retires it. */
const MODEL = 'gemini-3.5-flash-lite'

const schema = Schema.object({
  properties: {
    from: Schema.string({ description: 'First day a task may go on, YYYY-MM-DD.' }),
    until: Schema.string({ description: 'Last day a task may go on, YYYY-MM-DD. Leave out when open-ended.' }),
    everyDays: Schema.integer({ description: '1 = every allowed day, 2 = every other allowed day, and so on.' }),
    weekdays: Schema.array({
      items: Schema.integer(),
      description: 'Allowed weekdays, 0 = Sunday to 6 = Saturday. Empty means every day.',
    }),
    perDay: Schema.integer({ description: 'Most tasks on one day. Use 99 for no limit.' }),
    windowStart: Schema.integer({ description: 'Earliest start, minutes after midnight.' }),
    windowEnd: Schema.integer({ description: 'Latest end, minutes after midnight.' }),
  },
  optionalProperties: ['until'],
})

let model: ReturnType<typeof getGenerativeModel> | null = null

export async function askGemini(sentence: string, now = new Date()): Promise<Partial<SpreadRule>> {
  model ??= getGenerativeModel(getAI(app, { backend: new GoogleAIBackend() }), {
    model: MODEL,
    generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0 },
  })
  const today = `${dayKey(now)} (${now.toLocaleDateString('en', { weekday: 'long' })})`
  const prompt = [
    'Someone is spreading several to-do tasks across their calendar and described how in their own words.',
    'Turn the description into the rule. Use sensible defaults for anything not said:',
    'from today, every day, every weekday allowed, one task a day, between 09:00 and 21:00.',
    `Today is ${today}.`,
    `Description: """${sentence.slice(0, 300)}"""`,
  ].join('\n')
  const result = await model.generateContent(prompt)
  return JSON.parse(result.response.text())
}
