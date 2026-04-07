// hex — @hexhive/cli — MIT — https://github.com/hexhive/cli

import vm from 'node:vm'
import fs from 'node:fs'
import path from 'node:path'
import type { TestSuite, GeneratedTest } from './TestGenerator.ts'

export interface TestResult {
  description: string
  passed: boolean
  error?: string
  durationMs: number
}

export interface RunResult {
  functionName: string
  passed: number
  failed: number
  results: TestResult[]
  allPassed: boolean
}

const TIMEOUT_MS = 5000

export async function runTests(suite: TestSuite): Promise<RunResult> {
  const results: TestResult[] = []

  for (const test of suite.tests) {
    const start = Date.now()
    try {
      const context = vm.createContext({
        Math, JSON, Array, Object, String, Number, Boolean,
        parseInt, parseFloat, isNaN, isFinite,
        Map, Set, Date, RegExp, Error, TypeError, RangeError,
        console: { log: () => {}, error: () => {}, warn: () => {} },
      })

      const script = new vm.Script(`(function() { ${test.code} })()`, {
        filename: `hex-test-${test.description.slice(0, 20)}.js`,
      })

      const result = script.runInContext(context, { timeout: TIMEOUT_MS })
      const testResult: TestResult = {
        description: test.description,
        passed: result === true,
        durationMs: Date.now() - start,
      }
      if (result !== true) {
        testResult.error = `Test returned ${JSON.stringify(result)}`
      }
      results.push(testResult)
    } catch (err) {
      results.push({
        description: test.description,
        passed: false,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
      })
    }
  }

  const passed = results.filter(r => r.passed).length
  const failed = results.filter(r => !r.passed).length

  const logPath = path.join(process.cwd(), '.hex', 'test-results.json')
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true })
    fs.appendFileSync(logPath, JSON.stringify({
      ts: new Date().toISOString(),
      functionName: suite.functionName,
      passed,
      failed,
      results,
    }) + '\n')
  } catch {
    // logging failure should not crash
  }

  return {
    functionName: suite.functionName,
    passed,
    failed,
    results,
    allPassed: failed === 0,
  }
}
