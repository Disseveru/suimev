import fs from 'node:fs';
import path from 'node:path';

interface PerformanceIssue {
  file: string;
  line: number;
  pattern: string;
  description: string;
}

const RISKY_PATTERNS = [
  {
    regex: /\.some\s*\(/g,
    description: 'Array.some() detected in code. Ensure this is not an O(n^2) membership check in a hot loop (prefer Set.has()).',
    hotPathsOnly: true,
  },
  {
    regex: /\.sort\s*\(/g,
    description: 'Array.sort() detected. Ensure this is not repeatedly sorting large collections on ticks (prefer PriorityQueue / Heap).',
    hotPathsOnly: true,
  },
  {
    regex: /new\s+Transaction\s*\(/g,
    description: 'new Transaction() instantiation detected. Avoid allocating Transaction objects repeatedly inside tight loops.',
    hotPathsOnly: true,
  },
  {
    regex: /JSON\.stringify\s*\([^,)]+,\s*Object\.getOwnPropertyNames/g,
    description: 'Heavy JSON.stringify error reflection detected on execution path. Use structured log fields instead.',
    hotPathsOnly: false,
  },
];

const HOT_FILES = ['searcher.ts', 'ptbBuilder.ts', 'executor.ts', 'router.ts', 'gasPriceCalibrator.ts'];

function scanDirectory(dir: string, issues: PerformanceIssue[]): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'dist' && entry.name !== '.agents') {
        scanDirectory(fullPath, issues);
      }
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.js'))) {
      const isHot = HOT_FILES.some((f) => entry.name.endsWith(f));
      const content = fs.readFileSync(fullPath, 'utf8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const lineText = lines[i];
        if (lineText.trim().startsWith('//') || lineText.trim().startsWith('*')) continue;

        for (const pattern of RISKY_PATTERNS) {
          if (pattern.hotPathsOnly && !isHot) continue;
          if (pattern.regex.test(lineText)) {
            issues.push({
              file: path.relative(process.cwd(), fullPath),
              line: i + 1,
              pattern: pattern.regex.source,
              description: pattern.description,
            });
          }
        }
      }
    }
  }
}

console.log('🔍 Running Static Performance Anti-Pattern Scanner...');
const issues: PerformanceIssue[] = [];
scanDirectory(path.resolve('./src'), issues);

if (issues.length > 0) {
  console.log(`⚠️  Detected ${issues.length} potential performance risk item(s):`);
  for (const issue of issues) {
    console.log(`   - [${issue.file}:${issue.line}] ${issue.description}`);
  }
  // Informational advisory or strict gate depending on mode
  if (process.env.STRICT_PERF_GATE === 'true') {
    console.error('❌ Static Performance Gate Failed due to STRICT_PERF_GATE=true');
    process.exit(1);
  } else {
    console.log('✅ Static Performance Scan Complete (Advisory Mode)');
  }
} else {
  console.log('✅ Zero performance anti-patterns detected in core hot paths.');
}
