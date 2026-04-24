import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

export type Scope = 'repo-wide' | 'feature';
export type Rfc2119Keyword = 'MUST' | 'MUST NOT' | 'SHOULD' | 'SHOULD NOT' | 'MAY';

export interface MachineZone {
  id: string;
  title: string;
  scope: Scope;
  owners: string[];
  paths?: string[];
  surfaces?: string[];
  dependencies?: string[];
}

export interface TestBinding {
  file: string;
  name: string;
}

export interface Clause {
  text: string;
  line: number;
  keywords: Rfc2119Keyword[];
  semantic: boolean;
  testBinding?: TestBinding;
}

export interface TnlFile {
  machine: MachineZone;
  intent: string;
  behaviors: Clause[];
  nonGoals: string[];
  rationale: string;
  sourcePath?: string;
}

export class TnlParseError extends Error {
  readonly line: number;
  constructor(line: number, message: string) {
    super(line > 0 ? `line ${line}: ${message}` : message);
    this.line = line;
    this.name = 'TnlParseError';
  }
}

const MACHINE_KEYS = new Set([
  'id',
  'title',
  'scope',
  'owners',
  'paths',
  'surfaces',
  'dependencies',
]);
const LIST_MACHINE_FIELDS = new Set(['paths', 'surfaces', 'owners', 'dependencies']);
const SECTION_KEYS = new Set(['intent', 'behaviors', 'non-goals', 'rationale']);

interface SourceLine {
  text: string;
  raw: string;
  number: number;
}

interface MachineRaw {
  value: string;
  /** Pre-parsed items, populated when the field was given as a YAML-style block list. */
  preparsed?: string[];
  line: number;
}

export function parseTnl(source: string, sourcePath?: string): TnlFile {
  const normalized = source.replace(/\r\n/g, '\n');
  const rawLines = normalized.split('\n');
  const lines: SourceLine[] = rawLines.map((raw, i) => ({
    text: stripComment(raw),
    raw,
    number: i + 1,
  }));

  const machineRaw: Record<string, MachineRaw> = {};
  const machineBlockList: Record<string, { items: string[]; line: number }> = {};
  const sections: Record<string, SourceLine[]> = {};
  let currentSection: string | null = null;
  let currentMachineBlockList: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.text.trim() === '') {
      if (currentSection) sections[currentSection]!.push(line);
      continue;
    }

    const isTopLevel = !/^\s/.test(line.text);
    if (isTopLevel) {
      currentMachineBlockList = null;
      const m = line.text.match(/^([a-zA-Z][a-zA-Z0-9-]*)\s*:\s*(.*)$/);
      if (!m) {
        throw new TnlParseError(line.number, `malformed line: '${line.raw}'`);
      }
      const key = m[1]!;
      let value = m[2]!.trim();

      // Multi-line bracket form: if the value opens a bracket-list but doesn't
      // close it on this line, consume subsequent lines (any indentation) until
      // the matching `]` is found. EOF without closure is a parse error.
      if (
        MACHINE_KEYS.has(key) &&
        LIST_MACHINE_FIELDS.has(key) &&
        value.startsWith('[') &&
        !value.includes(']')
      ) {
        const startLine = line.number;
        let closed = false;
        while (i + 1 < lines.length) {
          i += 1;
          const next = lines[i]!;
          value += ' ' + next.text.trim();
          if (next.text.includes(']')) {
            closed = true;
            break;
          }
        }
        if (!closed) {
          throw new TnlParseError(
            startLine,
            `machine-zone field '${key}' multi-line bracket list is not closed before end of file`,
          );
        }
        value = value.trim();
      }

      if (value === '') {
        if (SECTION_KEYS.has(key)) {
          if (sections[key]) {
            throw new TnlParseError(line.number, `duplicate section '${key}:'`);
          }
          sections[key] = [];
          currentSection = key;
        } else if (LIST_MACHINE_FIELDS.has(key)) {
          if (machineRaw[key] || machineBlockList[key]) {
            throw new TnlParseError(line.number, `duplicate machine-zone field '${key}'`);
          }
          machineBlockList[key] = { items: [], line: line.number };
          currentMachineBlockList = key;
          currentSection = null;
        } else {
          throw new TnlParseError(line.number, `unknown top-level section '${key}:'`);
        }
      } else {
        if (SECTION_KEYS.has(key)) {
          throw new TnlParseError(
            line.number,
            `section '${key}:' body must be indented on the next line, not inline after the colon`,
          );
        }
        if (!MACHINE_KEYS.has(key)) {
          throw new TnlParseError(line.number, `unknown machine-zone field '${key}'`);
        }
        if (machineRaw[key] || machineBlockList[key]) {
          throw new TnlParseError(line.number, `duplicate machine-zone field '${key}'`);
        }
        machineRaw[key] = { value, line: line.number };
        currentSection = null;
      }
    } else if (currentMachineBlockList) {
      const trimmed = line.text.trim();
      if (!trimmed.startsWith('- ')) {
        throw new TnlParseError(
          line.number,
          `machine-zone field '${currentMachineBlockList}' block-list expects '- item'; got '${line.raw}'`,
        );
      }
      machineBlockList[currentMachineBlockList]!.items.push(trimmed.slice(2).trim());
    } else if (currentSection) {
      sections[currentSection]!.push(line);
    } else {
      throw new TnlParseError(
        line.number,
        `indented content outside any section: '${line.raw}'`,
      );
    }
  }

  // Fold block-list machine fields into machineRaw with preparsed items.
  for (const [key, entry] of Object.entries(machineBlockList)) {
    machineRaw[key] = { value: '', preparsed: entry.items, line: entry.line };
  }

  const machine = validateMachineZone(machineRaw, sourcePath);

  if (!sections.intent) {
    throw new TnlParseError(0, 'missing required section: intent');
  }
  if (!sections.behaviors) {
    throw new TnlParseError(0, 'missing required section: behaviors');
  }

  const intent = extractProse(sections.intent);
  const behaviors = extractClauses(sections.behaviors);
  if (behaviors.length === 0) {
    throw new TnlParseError(0, 'section `behaviors` must have at least one clause');
  }
  const nonGoals = sections['non-goals'] ? extractBullets(sections['non-goals']) : [];
  const rationale = sections.rationale ? extractProse(sections.rationale) : '';

  return { machine, intent, behaviors, nonGoals, rationale, sourcePath };
}

export function parseTnlFile(filePath: string): TnlFile {
  const content = readFileSync(filePath, 'utf8');
  return parseTnl(content, filePath);
}

function stripComment(line: string): string {
  const idx = line.indexOf('#');
  if (idx === -1) return line;
  return line.slice(0, idx).trimEnd();
}

function validateMachineZone(
  raw: Record<string, MachineRaw>,
  sourcePath?: string,
): MachineZone {
  const required = ['id', 'title', 'scope', 'owners'];
  for (const key of required) {
    if (!raw[key]) {
      throw new TnlParseError(0, `missing required machine-zone field: ${key}`);
    }
  }

  const idField = raw.id!;
  const id = idField.value;
  if (!/^[a-z][a-z0-9-]*$/.test(id)) {
    throw new TnlParseError(
      idField.line,
      `id '${id}' must be kebab-case (lowercase letters, digits, hyphens; starts with a letter)`,
    );
  }

  if (sourcePath !== undefined && sourcePath.endsWith('.tnl')) {
    const stem = basename(sourcePath).slice(0, -'.tnl'.length);
    if (stem !== id) {
      throw new TnlParseError(
        idField.line,
        `id '${id}' does not match filename stem '${stem}'`,
      );
    }
  }

  const titleField = raw.title!;
  const title = titleField.value;
  if (title === '') {
    throw new TnlParseError(titleField.line, 'title must be non-empty');
  }

  const scopeField = raw.scope!;
  const scopeValue = scopeField.value;
  if (scopeValue !== 'repo-wide' && scopeValue !== 'feature') {
    throw new TnlParseError(
      scopeField.line,
      `scope must be 'repo-wide' or 'feature'; got '${scopeValue}'`,
    );
  }
  const scope: Scope = scopeValue;

  const ownersField = raw.owners!;
  const owners = parseListValue(ownersField, 'owners');
  if (owners.length === 0) {
    throw new TnlParseError(ownersField.line, 'owners must be a non-empty list');
  }

  let paths: string[] | undefined;
  if (scope === 'feature') {
    if (!raw.paths) {
      throw new TnlParseError(0, "scope 'feature' requires a 'paths' field");
    }
    paths = parseListValue(raw.paths, 'paths');
    if (paths.length === 0) {
      throw new TnlParseError(
        raw.paths.line,
        "scope 'feature' requires non-empty 'paths' list",
      );
    }
  } else if (raw.paths) {
    throw new TnlParseError(raw.paths.line, "scope 'repo-wide' forbids 'paths' field");
  }

  const surfaces = raw.surfaces ? parseListValue(raw.surfaces, 'surfaces') : undefined;
  const dependencies = raw.dependencies
    ? parseListValue(raw.dependencies, 'dependencies')
    : undefined;

  const zone: MachineZone = { id, title, scope, owners };
  if (paths !== undefined) zone.paths = paths;
  if (surfaces !== undefined) zone.surfaces = surfaces;
  if (dependencies !== undefined) zone.dependencies = dependencies;
  return zone;
}

function parseListValue(raw: MachineRaw, fieldName: string): string[] {
  if (raw.preparsed !== undefined) {
    return raw.preparsed.filter((s) => s !== '');
  }
  const value = raw.value;
  if (!value.startsWith('[') || !value.endsWith(']')) {
    throw new TnlParseError(
      raw.line,
      `field '${fieldName}' must be a bracket list like [a, b, c] (or a block list with indented '- item' lines); got '${value}'`,
    );
  }
  const inside = value.slice(1, -1).trim();
  if (inside === '') return [];
  return inside
    .split(',')
    .map((s) => stripOuterQuotes(s.trim()))
    .filter((s) => s !== '');
}

function stripOuterQuotes(s: string): string {
  if (s.length < 2) return s;
  const first = s[0];
  const last = s[s.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return s.slice(1, -1);
  }
  return s;
}

function extractProse(lines: SourceLine[]): string {
  const texts = lines.map((l) => l.text);
  const indents = texts
    .filter((l) => l.trim() !== '')
    .map((l) => l.length - l.trimStart().length);
  const minIndent = indents.length > 0 ? Math.min(...indents) : 0;
  const stripped = texts.map((l) => (l.trim() === '' ? '' : l.slice(minIndent)));
  while (stripped.length > 0 && stripped[stripped.length - 1] === '') stripped.pop();
  while (stripped.length > 0 && stripped[0] === '') stripped.shift();
  return stripped.join('\n');
}

function extractBullets(lines: SourceLine[]): string[] {
  const bullets: string[] = [];
  let current: { parts: string[]; line: number } | null = null;
  for (const line of lines) {
    const trimmed = line.text.trim();
    if (trimmed === '') continue;
    if (trimmed.startsWith('- ')) {
      if (current) bullets.push(current.parts.join(' ').trim());
      current = { parts: [trimmed.slice(2)], line: line.number };
    } else if (current) {
      current.parts.push(trimmed);
    } else {
      throw new TnlParseError(line.number, `expected bullet starting with '- '; got '${line.raw}'`);
    }
  }
  if (current) bullets.push(current.parts.join(' ').trim());
  return bullets;
}

function extractClauses(lines: SourceLine[]): Clause[] {
  const clauses: Clause[] = [];
  let current: { parts: string[]; line: number } | null = null;
  for (const line of lines) {
    const trimmed = line.text.trim();
    if (trimmed === '') continue;
    if (trimmed.startsWith('- ')) {
      if (current) clauses.push(finalizeClause(current));
      current = { parts: [trimmed.slice(2)], line: line.number };
    } else if (current) {
      current.parts.push(trimmed);
    } else {
      throw new TnlParseError(
        line.number,
        `expected bullet starting with '- '; got '${line.raw}'`,
      );
    }
  }
  if (current) clauses.push(finalizeClause(current));
  return clauses;
}

const SEMANTIC_PREFIX = '[semantic]';

function finalizeClause(raw: { parts: string[]; line: number }): Clause {
  const joined = raw.parts.join(' ').trim();

  let remaining = joined;
  let semantic = false;
  let testBinding: TestBinding | undefined;

  while (true) {
    if (!semantic && remaining.startsWith(SEMANTIC_PREFIX)) {
      semantic = true;
      remaining = remaining.slice(SEMANTIC_PREFIX.length).trimStart();
      continue;
    }
    if (testBinding === undefined && remaining.startsWith('[test:')) {
      testBinding = extractTestBinding(remaining, raw.line);
      const closeIdx = remaining.indexOf(']');
      remaining = remaining.slice(closeIdx + 1).trimStart();
      continue;
    }
    break;
  }

  if (semantic && testBinding !== undefined) {
    throw new TnlParseError(
      raw.line,
      'clause cannot combine [semantic] and [test: ...]; split into two clauses',
    );
  }

  const keywords = extractKeywords(remaining);
  const clause: Clause = { text: joined, line: raw.line, keywords, semantic };
  if (testBinding !== undefined) clause.testBinding = testBinding;
  return clause;
}

function extractTestBinding(body: string, lineNumber: number): TestBinding {
  const closeIdx = body.indexOf(']');
  if (closeIdx === -1) {
    throw new TnlParseError(
      lineNumber,
      'malformed [test: ...] prefix: missing closing `]`',
    );
  }
  const inside = body.slice('[test:'.length, closeIdx).trim();
  const sepIdx = inside.indexOf('::');
  if (sepIdx === -1) {
    throw new TnlParseError(
      lineNumber,
      "malformed [test: ...] prefix: missing `::` separator between file and name",
    );
  }
  const file = inside.slice(0, sepIdx).trimEnd();
  const name = inside.slice(sepIdx + 2).trim();
  if (file.length === 0) {
    throw new TnlParseError(
      lineNumber,
      'malformed [test: ...] prefix: empty file before `::`',
    );
  }
  if (name.length === 0) {
    throw new TnlParseError(
      lineNumber,
      'malformed [test: ...] prefix: empty name after `::`',
    );
  }
  return { file, name };
}

function extractKeywords(body: string): Rfc2119Keyword[] {
  const matches: Array<{ keyword: Rfc2119Keyword; pos: number; end: number }> = [];

  for (const m of body.matchAll(/\bMUST NOT\b/g)) {
    const pos = m.index!;
    matches.push({ keyword: 'MUST NOT', pos, end: pos + m[0].length });
  }
  for (const m of body.matchAll(/\bSHOULD NOT\b/g)) {
    const pos = m.index!;
    matches.push({ keyword: 'SHOULD NOT', pos, end: pos + m[0].length });
  }

  const takenRanges = matches.map((x) => [x.pos, x.end] as [number, number]);
  const overlaps = (s: number, e: number) =>
    takenRanges.some(([ts, te]) => !(e <= ts || s >= te));

  for (const m of body.matchAll(/\bMUST\b/g)) {
    const pos = m.index!;
    const end = pos + m[0].length;
    if (!overlaps(pos, end)) matches.push({ keyword: 'MUST', pos, end });
  }
  for (const m of body.matchAll(/\bSHOULD\b/g)) {
    const pos = m.index!;
    const end = pos + m[0].length;
    if (!overlaps(pos, end)) matches.push({ keyword: 'SHOULD', pos, end });
  }
  for (const m of body.matchAll(/\bMAY\b/g)) {
    const pos = m.index!;
    matches.push({ keyword: 'MAY', pos, end: pos + m[0].length });
  }

  matches.sort((a, b) => a.pos - b.pos);

  const seen = new Set<Rfc2119Keyword>();
  const result: Rfc2119Keyword[] = [];
  for (const m of matches) {
    if (!seen.has(m.keyword)) {
      seen.add(m.keyword);
      result.push(m.keyword);
    }
  }
  return result;
}
