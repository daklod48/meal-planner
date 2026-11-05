#!/usr/bin/env python3
"""The publish check (tools/make-share-copy.py --check-publish, 2026-11-05) on a temporary git repository: a clean
repository passes; each kind of leak, planted once, fails it, also when the leak sits only in an OLDER commit (a public
repository publishes its history); and the pre-push hook really refuses a push. Run from the repository root:
python3 tests/t_publish.py"""
import os
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.abspath('.')
# The planted leaks are built from pieces, so this file itself never holds one (the check reads it too when it is published).
TRIG = 'trig' + '_01ABCDEFGHIJKLMNOP'
SESS = 'session' + '_012z3WjQqREWuNX1dVB8'
PKEY = '"private' + '_key"'
MAIL_REAL = 'jana' + '@' + 'seznam.cz'
MAIL_AUTHOR = 'jana.private' + '@' + 'gmail.com'
passed, failed = 0, []


def ok(name, cond, extra=''):
    global passed
    if cond:
        passed += 1
    else:
        failed.append(name + (' :: ' + str(extra)[-400:] if extra else ''))


def sh(cwd, *args, check=True):
    r = subprocess.run(list(args), cwd=cwd, capture_output=True, text=True)
    if check and r.returncode != 0:
        raise SystemExit('%s failed: %s %s' % (args, r.stdout, r.stderr))
    return r


def fresh():
    d = tempfile.mkdtemp(prefix='mp-pub-')
    os.makedirs(os.path.join(d, 'tools'))
    shutil.copy(os.path.join(ROOT, 'tools', 'make-share-copy.py'), os.path.join(d, 'tools'))
    os.makedirs(os.path.join(d, 'data'))
    open(os.path.join(d, 'data', 'share-forbid.txt'), 'w', encoding='utf-8').write('# test words\nJana Nováková\nLAPTOP-77\n')
    open(os.path.join(d, '.gitignore'), 'w').write('data/\n')
    open(os.path.join(d, 'README.md'), 'w').write('Meal Planner test repo. Contact: someone@example.com\n')
    sh(d, 'git', 'init', '-q', '-b', 'main')
    sh(d, 'git', 'config', 'user.email', 'noreply@anthropic.com')
    sh(d, 'git', 'config', 'user.name', 'Test')
    sh(d, 'git', 'add', '-A')
    sh(d, 'git', 'commit', '-qm', 'clean start')
    return d


def check(d):
    r = sh(d, sys.executable, 'tools/make-share-copy.py', '--check-publish', check=False)
    return r.returncode, r.stdout


def commit(d, path, text, msg='add'):
    p = os.path.join(d, path)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    open(p, 'w', encoding='utf-8').write(text)
    sh(d, 'git', 'add', '-f', path)
    sh(d, 'git', 'commit', '-qm', msg)


d = fresh()
rc, out = check(d)
ok('a clean repository passes', rc == 0 and out.startswith('OK publish check'), out)

cases = [
    ('a forbidden name, typed without accents', 'notes.md', 'Owner: jana novakova\n', 'share-forbid'),
    ('a forbidden word in another letter case', 'cards/x.md', 'built on laptop-77\n', 'share-forbid'),
    ('a scheduled-task id', 'steps/x.md', 'task ' + TRIG + '\n', 'scheduled-task id'),
    ('a Claude session id', 'x.md', 'see ' + SESS + '\n', 'session id'),
    ('a private key', 'key.json', '{"type": "service_account", ' + PKEY + ': "x"}\n', 'private key'),
    ('a real-looking e-mail address', 'tests/x.py', 'EMAIL = ' + repr(MAIL_REAL) + '\n', 'e-mail address'),
    ('a _PAST-WORK file', '_PAST-WORK/PROJECT-MEMORY.md', 'notes\n', 'must stay local'),
    ('a data/ file', 'data/users/x/profile.json', '{}\n', 'must stay local'),
]
for name, path, text, expect in cases:
    d = fresh()
    commit(d, path, text)
    rc, out = check(d)
    ok('fails on ' + name, rc == 1 and expect in out, out)
    # remove it again in a newer commit: the leak is still in history, so the check must still fail
    sh(d, 'git', 'rm', '-q', '-r', '--cached', path)
    if os.path.exists(os.path.join(d, path)):
        os.remove(os.path.join(d, path))
    sh(d, 'git', 'commit', '-qm', 'remove it')
    rc, out = check(d)
    ok('still fails when ' + name + ' is only in an older commit', rc == 1 and expect in out, out)

d = fresh()
commit(d, 'x.md', 'ok\n', msg='written for Jana Nováková')
rc, out = check(d)
ok('fails on a forbidden name in a commit message', rc == 1 and 'author / message' in out, out)
d = fresh()
sh(d, 'git', 'config', 'user.email', MAIL_AUTHOR)
commit(d, 'x.md', 'ok\n')
rc, out = check(d)
ok('fails on a private e-mail as commit author', rc == 1 and MAIL_AUTHOR in out, out)

# the hook: a push of a clean repository goes through, a push with a leak is refused
d = fresh()
remote = tempfile.mkdtemp(prefix='mp-remote-')
sh(remote, 'git', 'init', '-q', '--bare')
sh(d, 'git', 'remote', 'add', 'origin', remote)
r = sh(d, sys.executable, 'tools/make-share-copy.py', '--install-hook')
ok('hook installed', os.path.exists(os.path.join(d, '.git', 'hooks', 'pre-push')), r.stdout)
r = sh(d, 'git', 'push', '-q', 'origin', 'main', check=False)
ok('hook: a clean push goes through', r.returncode == 0, r.stderr)
commit(d, 'leak.md', TRIG + '\n')
r = sh(d, 'git', 'push', '-q', 'origin', 'main', check=False)
heads = sh(remote, 'git', 'log', '--oneline', 'main').stdout.count('\n')
ok('hook: a push with a leak is refused and the remote keeps the clean commit only', r.returncode != 0 and heads == 1, r.stdout + r.stderr)

if failed:
    print('FAIL %d of %d\n  ' % (len(failed), passed + len(failed)) + '\n  '.join(failed))
    sys.exit(1)
print('PASS %d publish-check checks' % passed)
