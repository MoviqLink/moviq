/** A problem that must be fixed before the repository can be delivered. */
export interface Problem {
  readonly rule: string;
  readonly path: string;
  readonly line?: number;
  readonly detail: string;
}

const MAX_LINE = 120;
const LINE_CHECKED = /\.(ts|tsx|js|mjs|cjs|json|sql|ya?ml|css)$/;
// npm scripts cannot be wrapped, and the lockfile is generated.
const LINE_EXEMPT = new Set(['package.json', 'package-lock.json']);

// The brackets keep each pattern from matching its own source text, so this file passes too.
const LOCAL_PATH =
  /\/[U]sers\/|\/[V]olumes\/|[C]:[\\/][U]sers[\\/]|(?<![\w.])\/[h]ome\/[a-z_][a-z0-9_-]*\//;
const WORK_MARKER = /\b(?:T[O]DO|F[I]XME|X[X]X|H[A]CK)\b/;
const SECRET_PATTERNS: readonly (readonly [string, RegExp])[] = [
  ['private key', /-{5}BEGIN [A-Z ]*P[R]IVATE KEY-{5}/],
  ['OpenAI key', /\bsk-[A-Za-z0-9_-]{20,}/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
];
/** A credential is a variable whose name ends in one of these words; a limit like `…_TOKEN_BUDGET` is not. */
const ENV_ASSIGNMENT = /^\s*(?:export\s+)?[A-Z0-9_]*(?:SECRET|TOKEN|KEY|PASSWORD)\s*=\s*\S/;

/** Every folder with delivered files explains itself in a README.md. Hidden folders are exempt. */
export function checkReadmes(paths: readonly string[]): Problem[] {
  const files = new Set(paths);
  const folders = new Set<string>(['']);
  for (const path of paths) {
    const parts = path.split('/').slice(0, -1);
    if (parts.some((part) => part.startsWith('.'))) continue;
    for (let depth = 1; depth <= parts.length; depth += 1)
      folders.add(parts.slice(0, depth).join('/'));
  }
  return [...folders]
    .filter((folder) => !files.has(folder === '' ? 'README.md' : `${folder}/README.md`))
    .sort()
    .map((folder) => ({
      rule: 'readme',
      path: folder === '' ? '.' : folder,
      detail: 'missing README.md',
    }));
}

/** Local environment files hold real credentials and never belong in the repository. */
export function checkEnvFiles(paths: readonly string[]): Problem[] {
  return paths
    .filter((path) => {
      const name = path.split('/').at(-1) ?? '';
      return name.startsWith('.env') && name !== '.env.example';
    })
    .map((path) => ({ rule: 'env-file', path, detail: 'local environment file is tracked' }));
}

/** Captures of real answers: the root `tests/fixtures/`, any `fixtures/` folder or `fixtures-*` one. */
function isCapture(path: string): boolean {
  return path
    .split('/')
    .slice(0, -1)
    .some((folder) => folder === 'fixtures' || folder.startsWith('fixtures-'));
}

/** Text checks: no machine paths, no work-in-progress markers, no secrets, readable lines. */
export function checkContent(path: string, content: string): Problem[] {
  const problems: Problem[] = [];
  // Captures of real responses keep their exact bytes, however long their lines.
  const capture = isCapture(path);
  const lengthChecked =
    LINE_CHECKED.test(path) && !LINE_EXEMPT.has(path.split('/').at(-1) ?? '') && !capture;
  const envLike = /(^|\/)\.env\.example$/.test(path);
  // Captures hold providers' own text (a ship's destination may be a row of X), never our work.
  const markerChecked = !capture;
  content.split('\n').forEach((text, index) => {
    const line = index + 1;
    if (LOCAL_PATH.test(text))
      problems.push({ rule: 'local-path', path, line, detail: 'absolute path of a machine' });
    if (markerChecked && WORK_MARKER.test(text))
      problems.push({ rule: 'work-marker', path, line, detail: 'unfinished-work marker' });
    for (const [name, pattern] of SECRET_PATTERNS) {
      if (pattern.test(text)) problems.push({ rule: 'secret', path, line, detail: name });
    }
    if (envLike && ENV_ASSIGNMENT.test(text)) {
      problems.push({
        rule: 'secret',
        path,
        line,
        detail: 'credential with a value in the example file',
      });
    }
    if (lengthChecked && text.length > MAX_LINE) {
      problems.push({
        rule: 'line-length',
        path,
        line,
        detail: `${String(text.length)} characters (max ${String(MAX_LINE)})`,
      });
    }
  });
  return problems;
}
