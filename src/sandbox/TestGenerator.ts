// hex — @hexhive/cli — MIT — https://github.com/hexhive/cli

import Anthropic from '@anthropic-ai/sdk'

export interface GeneratedTest {
  description: string
  code: string
  category: 'happy' | 'edge' | 'error'
}

export interface TestSuite {
  functionName: string
  functionCode: string
  tests: GeneratedTest[]
}

export async function generateTests(functionCode: string, functionName: string): Promise<TestSuite> {
  try {
    const anthropic = new Anthropic()
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: `Generate exactly 6 test cases for this function.
Return ONLY a JSON array, no other text, no markdown.

Function:
${functionCode}

Required format:
[
  {
    "description": "returns correct value for normal input",
    "code": "const fn = ${functionCode}; return fn(normalInput) === expectedOutput;",
    "category": "happy"
  }
]

Rules:
- 3 happy path tests (normal valid inputs)
- 2 edge cases (null, undefined, empty string, 0, empty array, boundary)
- 1 error case (should throw or handle invalid input gracefully)
- Each "code" field must be a complete self-contained expression returning boolean
- Do not use import or require
- Do not use async/await (sync tests only)
- JSON only, no markdown, no explanation`,
      }],
    })

    const text = response.content[0]?.type === 'text' ? response.content[0].text : '[]'
    const cleaned = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
    const tests: GeneratedTest[] = JSON.parse(cleaned)

    return { functionName, functionCode, tests }
  } catch {
    return {
      functionName,
      functionCode,
      tests: [],
    }
  }
}
