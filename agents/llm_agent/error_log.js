const fs = require('fs');
const path = require('path');

function runId() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function writableDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.accessSync(dir, fs.constants.W_OK);
  return dir;
}

// Every directory that already holds a run, plus this run's own folder.
function resolveResultDirs() {
  const dirs = new Set();
  const parents = [
    process.env.NPABENCH_RESULT_DIR,
    process.env.NPABENCH_OUTPUT_DIR,
    path.join(process.cwd(), 'results'),
  ].filter(Boolean);

  for (const parent of parents) {
    try {
      const root = writableDir(parent);
      dirs.add(root);
      for (const name of fs.readdirSync(root)) {
        const child = path.join(root, name);
        try {
          if (fs.statSync(child).isDirectory()) dirs.add(writableDir(child));
        } catch (_) {
          // Skip a result folder that cannot be written.
        }
      }
    } catch (_) {
      // This parent is missing or read-only (the sandbox mounts the agent read-only).
    }
  }

  const own = path.join(process.cwd(), 'results', runId());
  try {
    dirs.add(writableDir(own));
  } catch (_) {
    try {
      dirs.add(writableDir(path.join('/tmp', 'npabench-results', runId())));
    } catch (_) {
      // No writable result folder.
    }
  }
  return [...dirs];
}

function createErrorLog() {
  const dirs = resolveResultDirs();
  return {
    dirs,
    write(msg, extra = {}) {
      const line = JSON.stringify({
        t: new Date().toISOString(),
        level: 'error',
        msg,
        ...extra,
      }) + '\n';
      try { process.stderr.write(line); } catch (_) { /* stderr can close on shutdown */ }
      for (const dir of dirs) {
        try { fs.appendFileSync(path.join(dir, 'errors.log'), line); } catch (_) { /* keep going */ }
      }
    },
  };
}

module.exports = { createErrorLog, resolveResultDirs };
