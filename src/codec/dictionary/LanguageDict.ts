// hex — @hexhive/cli — MIT — https://github.com/hexhive/cli

export interface PhraseEntry {
  token: string
  phrase: string
  frequency: number
}

const INITIAL_PHRASES: Array<[string, string]> = [
  ['&xP001;', 'returns undefined'],
  ['&xP002;', 'null check'],
  ['&xP003;', 'import statement'],
  ['&xP004;', 'async function'],
  ['&xP005;', 'event listener'],
  ['&xP006;', 'type error'],
  ['&xP007;', 'missing dependency'],
  ['&xP008;', 'authentication'],
  ['&xP009;', 'authorization'],
  ['&xP010;', 'database query'],
  ['&xP011;', 'HTTP request'],
  ['&xP012;', 'API endpoint'],
  ['&xP013;', 'middleware'],
  ['&xP014;', 'environment variable'],
  ['&xP015;', 'configuration file'],
  ['&xP016;', 'unit test'],
  ['&xP017;', 'integration test'],
  ['&xP018;', 'error handling'],
  ['&xP019;', 'stack trace'],
  ['&xP020;', 'memory leak'],
  ['&xP021;', 'race condition'],
  ['&xP022;', 'dependency injection'],
  ['&xP023;', 'type assertion'],
  ['&xP024;', 'null pointer'],
  ['&xP025;', 'callback function'],
  ['&xP026;', 'promise chain'],
  ['&xP027;', 'state management'],
  ['&xP028;', 'route handler'],
  ['&xP029;', 'request body'],
  ['&xP030;', 'response header'],
  ['&xP031;', 'status code'],
  ['&xP032;', 'query parameter'],
  ['&xP033;', 'path parameter'],
  ['&xP034;', 'request validation'],
  ['&xP035;', 'schema validation'],
  ['&xP036;', 'foreign key'],
  ['&xP037;', 'primary key'],
  ['&xP038;', 'index creation'],
  ['&xP039;', 'migration file'],
  ['&xP040;', 'seed data'],
  ['&xP041;', 'connection pool'],
  ['&xP042;', 'transaction rollback'],
  ['&xP043;', 'component render'],
  ['&xP044;', 'virtual DOM'],
  ['&xP045;', 'side effect'],
  ['&xP046;', 'custom hook'],
  ['&xP047;', 'context provider'],
  ['&xP048;', 'default export'],
  ['&xP049;', 'named export'],
  ['&xP050;', 'barrel file'],
]

export class LanguageDict {
  private byToken = new Map<string, PhraseEntry>()
  private byPhrase = new Map<string, PhraseEntry>()
  private nextId = INITIAL_PHRASES.length + 1

  constructor() {
    for (const [token, phrase] of INITIAL_PHRASES) {
      const entry: PhraseEntry = { token, phrase, frequency: 0 }
      this.byToken.set(token, entry)
      this.byPhrase.set(phrase.toLowerCase(), entry)
    }
  }

  getByPhrase(phrase: string): PhraseEntry | undefined {
    return this.byPhrase.get(phrase.toLowerCase())
  }

  getByToken(token: string): PhraseEntry | undefined {
    return this.byToken.get(token)
  }

  addPhrase(phrase: string): PhraseEntry {
    const existing = this.getByPhrase(phrase)
    if (existing) return existing

    const token = `&xP${this.nextId.toString().padStart(3, '0')};`
    this.nextId++

    const entry: PhraseEntry = { token, phrase, frequency: 0 }
    this.byToken.set(token, entry)
    this.byPhrase.set(phrase.toLowerCase(), entry)
    return entry
  }

  incrementFrequency(token: string): void {
    const entry = this.byToken.get(token)
    if (entry) entry.frequency++
  }

  entries(): PhraseEntry[] {
    return [...this.byToken.values()]
  }

  toJSON(): PhraseEntry[] {
    return this.entries()
  }

  fromJSON(data: PhraseEntry[]): void {
    this.byToken.clear()
    this.byPhrase.clear()
    let maxId = 0

    for (const entry of data) {
      this.byToken.set(entry.token, entry)
      this.byPhrase.set(entry.phrase.toLowerCase(), entry)
      const idMatch = entry.token.match(/&xP(\d+);/)
      if (idMatch) {
        maxId = Math.max(maxId, parseInt(idMatch[1]!, 10))
      }
    }

    this.nextId = maxId + 1
  }
}
