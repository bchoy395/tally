'use strict';
// Which code is running, so two computers can be compared: package.json version, plus a build number
// (commits on this branch, so newer is always bigger) and the commit hash. Also checks GitHub for newer commits.
const path = require('node:path');
const { execFile } = require('node:child_process');
const { version } = require('../package.json');

const ROOT = path.join(__dirname, '..');
// Never ask for a password: a check that can't log in quietly reports "couldn't check".
const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };

function git(args, timeout = 5000) {
  return new Promise((resolve) => {
    execFile('git', ['-C', ROOT, ...args], { timeout, windowsHide: true, env: GIT_ENV }, (err, out) => resolve(err ? null : out.trim()));
  });
}

async function current() {
  const [head, build, status] = await Promise.all([
    git(['log', '-1', '--format=%h%x00%cI%x00%s']),
    git(['rev-list', '--count', 'HEAD']),
    git(['status', '--porcelain', '--untracked-files=no']),
  ]);
  const [commit = null, date = null, subject = null] = head ? head.split('\0') : [];
  return { version, build: build ? Number(build) : null, commit, date, subject, changed_files: status ? status.split('\n').length : 0 };
}

// "1.0.0 · build 10 · 375642e"
function label(v) {
  return [v.version, v.build != null && `build ${v.build}`, v.commit].filter(Boolean).join(' · ');
}

// Fetches from GitHub and compares. behind = newer commits waiting for `git pull`; ahead = local commits not pushed yet.
async function checkForUpdates() {
  const checked_at = new Date().toISOString();
  if ((await git(['fetch', '--quiet'], 30000)) === null) return { ok: false, checked_at };
  const counts = await git(['rev-list', '--left-right', '--count', 'HEAD...@{u}']);
  if (!counts) return { ok: false, checked_at };
  const [ahead, behind] = counts.split(/\s+/).map(Number);
  const latest = await git(['log', '-1', '--format=%h', '@{u}']);
  const latest_build = await git(['rev-list', '--count', '@{u}']);
  return { ok: true, checked_at, ahead, behind, latest_commit: latest, latest_build: latest_build ? Number(latest_build) : null };
}

function describeUpdate(u) {
  if (!u) return 'Checking GitHub for updates…';
  if (!u.ok) return "Couldn't check GitHub for updates (offline, or not signed in to GitHub).";
  const parts = [];
  if (u.behind) parts.push(`Update available: build ${u.latest_build} (${u.latest_commit}) is on GitHub, ${u.behind} change${u.behind === 1 ? '' : 's'} newer. Close Tally, run git pull, and start it again.`);
  if (u.ahead) parts.push(`${u.ahead} local commit${u.ahead === 1 ? '' : 's'} not pushed to GitHub yet.`);
  return parts.join(' ') || 'Up to date with GitHub.';
}

module.exports = { current, label, checkForUpdates, describeUpdate };
