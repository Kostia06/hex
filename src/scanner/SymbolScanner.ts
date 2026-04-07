// hex — @hexhive/cli — MIT — https://github.com/hexhive/cli

import { Project } from 'ts-morph'
import type { DictManager } from '../codec/dictionary/DictManager.ts'

export async function scanFile(
  filePath: string,
  fileToken: string,
  dict: DictManager,
): Promise<number> {
  let count = 0

  try {
    const project = new Project({ skipAddingFilesFromTsConfig: true })
    project.addSourceFileAtPath(filePath)
    const sourceFile = project.getSourceFileOrThrow(filePath)

    // Functions
    for (const fn of sourceFile.getFunctions()) {
      const name = fn.getName()
      if (!name) continue
      const params = fn.getParameters().map(p => p.getText()).join(', ')
      const returnType = fn.getReturnTypeNode()?.getText() ?? 'void'
      dict.registerSymbol({
        kind: 'method',
        name,
        fileToken,
        line: fn.getStartLineNumber(),
        signature: `(${params}): ${returnType}`,
      })
      count++
    }

    // Classes + their methods
    for (const cls of sourceFile.getClasses()) {
      const className = cls.getName()
      if (!className) continue
      dict.registerSymbol({
        kind: 'class',
        name: className,
        fileToken,
        line: cls.getStartLineNumber(),
      })
      count++

      for (const method of cls.getMethods()) {
        const params = method.getParameters().map(p => p.getText()).join(', ')
        const returnType = method.getReturnTypeNode()?.getText() ?? 'void'
        dict.registerSymbol({
          kind: 'method',
          name: method.getName(),
          fileToken,
          line: method.getStartLineNumber(),
          signature: `(${params}): ${returnType}`,
        })
        count++
      }
    }

    // Interfaces
    for (const iface of sourceFile.getInterfaces()) {
      dict.registerSymbol({
        kind: 'interface',
        name: iface.getName(),
        fileToken,
        line: iface.getStartLineNumber(),
      })
      count++
    }

    // Exported variables
    for (const v of sourceFile.getVariableDeclarations()) {
      if (v.isExported()) {
        dict.registerSymbol({
          kind: 'variable',
          name: v.getName(),
          fileToken,
          line: v.getStartLineNumber(),
        })
        count++
      }
    }
  } catch (err) {
    console.warn(`Skipped unparseable file: ${filePath}`)
  }

  return count
}
